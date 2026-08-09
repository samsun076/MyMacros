#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.10"
# dependencies = ["garminconnect>=0.2.25"]
# ///
"""Push Garmin Index scale weigh-ins into MyMacros (#20).

    uv run tools/sync-garmin.py login      # once, interactively
    uv run tools/sync-garmin.py            # thereafter, e.g. from launchd
    uv run tools/sync-garmin.py --dry-run --days 30

Run with `uv run`, which reads the inline dependency block above and builds a
throwaway environment — nothing is installed into the system Python.

── Credentials ────────────────────────────────────────────────────────────

`login` is the only step that ever sees a Garmin password. It hands it
straight to garth, which exchanges it for OAuth tokens and writes them to
GARTH_HOME (default ~/.garminconnect). Every later run resumes from those
tokens, so the password is never stored, never passed as a flag, and never
read from the environment by this script.

`python-garminconnect` is an unofficial client (PLAN.md accepts that for v1;
#27 is the official Suunto-style OAuth path). Garmin can change the endpoint
whenever it likes, which is why a failure here must be loud rather than
silent — a weigh-in that quietly stops arriving would leave the budget
tracking a stale trend for weeks.

── The unit trap ──────────────────────────────────────────────────────────

**Garmin reports weight in GRAMS.** A body-composition entry carries
`weight: 80200.0` for 80.2 kg. Divided wrongly this is off by 1000x, and
/api/sync's 20-400 kg sanity bounds would reject it outright — which is the
good case. The bad case is a plausible-looking number, so the conversion is
asserted below rather than assumed.
"""

import argparse
import json
import os
import sys
import urllib.error
import urllib.request
from datetime import date, timedelta

TOKEN_DIR = os.path.expanduser(os.environ.get("GARTH_HOME", "~/.garminconnect"))
API = os.environ.get("MYMACROS_API", "https://fuel.debrief.run").rstrip("/")

# Garmin's own units, named so the conversions below read as intentional.
G_PER_KG = 1000.0
# The same sanity window /api/sync enforces. Checked here too so a bad read is
# reported against the weigh-in that caused it, not as an opaque 400.
MIN_KG, MAX_KG = 20.0, 400.0


def do_login() -> int:
    """Interactive, once. Exchanges a password for tokens and stores those."""
    import getpass

    from garminconnect import Garmin

    print("Signing in to Garmin Connect. The password is exchanged for tokens")
    print(f"and is not stored; the tokens go to {TOKEN_DIR}.\n")

    email = input("Garmin email: ").strip()
    password = getpass.getpass("Garmin password: ")

    # return_on_mfa makes an MFA challenge a value rather than a blocking
    # prompt raised from inside the library — the same code then works under
    # launchd, where a prompt would hang forever instead of failing.
    garmin = Garmin(email=email, password=password, return_on_mfa=True)

    try:
        # login() returns ("needs_mfa", client_state) or (None, None), and
        # dumps to this path itself on a clean credential login.
        result = garmin.login(TOKEN_DIR)
    except Exception as err:  # noqa: BLE001 — every failure here is terminal
        # Garmin rate-limits login by IP, and it is the failure most likely to
        # be met on a first attempt. Worth naming, because "429" alone reads
        # like a bug in this script rather than a wait-and-retry.
        if "429" in str(err) or "too many" in str(err).lower():
            sys.exit(
                "Garmin is rate-limiting logins from this IP (429).\n"
                "It clears on its own — wait ~15-30 minutes and run this again.\n"
                "Repeated attempts extend the block, so don't retry in a loop."
            )
        sys.exit(f"Garmin login failed: {err}")

    if result and result[0] == "needs_mfa":
        code = input("MFA code: ").strip()
        garmin.resume_login(result[1], code)

    # Dump unconditionally rather than trusting login()'s own write: the MFA
    # branch above returns before login() reaches its dump, so the resumed
    # session would otherwise be lost the moment this process exits.
    os.makedirs(TOKEN_DIR, exist_ok=True)
    garmin.client.dump(TOKEN_DIR)

    # Prove it rather than announce it — a token directory that exists but is
    # empty would send every later run back to the password path.
    if not os.listdir(TOKEN_DIR):
        sys.exit(f"Login reported success but wrote no tokens to {TOKEN_DIR}.")

    print(f"\nTokens written to {TOKEN_DIR}. Future runs need no password.")
    return 0


def connect():
    from garminconnect import Garmin

    if not os.path.isdir(TOKEN_DIR):
        sys.exit(f"No Garmin tokens at {TOKEN_DIR}. Run: uv run tools/sync-garmin.py login")

    garmin = Garmin()
    try:
        garmin.login(TOKEN_DIR)
    except Exception as err:  # noqa: BLE001 — any failure here is terminal
        if "429" in str(err) or "too many" in str(err).lower():
            sys.exit("Garmin is rate-limiting this IP (429). Try again in ~15-30 minutes.")
        sys.exit(f"Garmin tokens rejected ({err}). Re-run: uv run tools/sync-garmin.py login")
    return garmin


def weigh_ins(garmin, days: int) -> list[dict]:
    end = date.today()
    start = end - timedelta(days=days)
    data = garmin.get_body_composition(start.isoformat(), end.isoformat())

    out = []
    for entry in data.get("dateWeightList", []) or []:
        grams = entry.get("weight")
        if grams is None:
            continue

        kg = round(float(grams) / G_PER_KG, 1)
        # Loud, not silent: a unit change upstream should stop the sync, not
        # quietly post a number that moves someone's calorie target.
        if not (MIN_KG <= kg <= MAX_KG):
            print(
                f"  REFUSED {entry.get('calendarDate')}: {grams} → {kg} kg is outside "
                f"{MIN_KG}-{MAX_KG}. Has Garmin changed units?",
                file=sys.stderr,
            )
            continue

        # `calendarDate` is the local day Garmin filed it under, which is the
        # same thing MyMacros means by measured_on (#44). Preferred over the
        # epoch `date` field precisely because it is already local.
        measured_on = entry.get("calendarDate")
        if not measured_on:
            continue

        item = {"measured_on": measured_on, "weight_kg": kg}
        bf = entry.get("bodyFat")
        if bf is not None:
            item["body_fat_pct"] = round(float(bf), 1)
        out.append(item)

    # newest last, and one entry per day — Garmin can return several for a day
    # and /api/sync upserts, so the last one written would win arbitrarily
    by_day: dict[str, dict] = {}
    for item in sorted(out, key=lambda i: i["measured_on"]):
        by_day[item["measured_on"]] = item
    return list(by_day.values())


def push(weights: list[dict], token: str) -> int:
    req = urllib.request.Request(
        f"{API}/api/sync",
        data=json.dumps({"weights": weights}).encode(),
        headers={
            "content-type": "application/json",
            "authorization": f"Bearer {token}",
            # Cloudflare sits in front of the Worker and blocks requests by
            # browser signature. urllib's default announces itself as
            # "Python-urllib/3.x", which it refuses with 403 and its own error
            # code 1010 — a Cloudflare page, not anything our Worker said, so
            # the token and the payload are never even looked at. The Node
            # sync passes only because fetch() sends an ordinary UA.
            "user-agent": "MyMacros-sync/0.1 (https://fuel.debrief.run)",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as res:
            body = json.load(res)
    except urllib.error.HTTPError as err:
        detail = err.read().decode()[:300]
        print(f"sync failed: {err.code} {detail}", file=sys.stderr)
        return 1
    except urllib.error.URLError as err:
        print(f"sync unreachable: {err}", file=sys.stderr)
        return 1

    print(f"synced {body.get('weights')} weigh-in(s)")
    if body.get("target_kcal"):
        print(f"target is now {body['target_kcal']} kcal")
    if body.get("rejected"):
        print(f"REJECTED {len(body['rejected'])}: {', '.join(body['rejected'])}", file=sys.stderr)
        return 1
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", nargs="?", choices=["login", "sync"], default="sync")
    parser.add_argument("--days", type=int, default=30)
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    if args.command == "login":
        return do_login()

    token = os.environ.get("MYMACROS_SYNC_TOKEN")
    if not token and not args.dry_run:
        sys.exit("MYMACROS_SYNC_TOKEN is not set. Issue one in Settings → Sync.")

    weights = weigh_ins(connect(), args.days)
    print(f"{len(weights)} weigh-in(s) in the last {args.days} days")
    for w in weights[-5:]:
        bf = f"  {w['body_fat_pct']}% fat" if "body_fat_pct" in w else ""
        print(f"  {w['measured_on']}  {w['weight_kg']} kg{bf}")

    if args.dry_run:
        print("\n--dry-run: nothing sent.")
        return 0
    if not weights:
        print("Nothing to send.")
        return 0

    return push(weights, token)


if __name__ == "__main__":
    sys.exit(main())
