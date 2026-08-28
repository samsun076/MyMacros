import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/** #127's preflight is only a guard if it actually runs (#140).
 *
 *  `tools/preflight-deploy.mjs` refuses a deploy that would replace somebody
 *  else's instance — the failure where a second instance keeps the Worker name,
 *  `wrangler deploy` exits 0, and instance one's owner opens the app and is
 *  served instance two's database.
 *
 *  **Nothing in `npm test` executes that script.** It shells out to `npx
 *  wrangler` and needs a Cloudflare session, so its behaviour is verified by
 *  hand (measured 2026-08-28: same-database → continue, absent Worker → continue,
 *  name collision with a different `database_id` → exit 1, and `npm run deploy`
 *  exits non-zero). What a test CAN hold is the two structural facts that make
 *  those measurements matter — that the script is still wired into both paths a
 *  deploy can take.
 *
 *  Both would be a one-line deletion, neither would fail any other test, and the
 *  symptom is silence: deploys keep working, right up until the one that
 *  overwrites somebody. That is the same shape as `tools/sheet-drag.test.mjs` —
 *  a structural oracle for a layer with no behavioural one.
 *
 *  #140 was originally about the preflight being unable to read a
 *  `wrangler.<name>.jsonc`. That gap closed when the second-config model was
 *  dropped: there is one config per fork now, and it is the one the script reads.
 */
describe("the deploy preflight stays wired in", () => {
  const pkg = JSON.parse(readFileSync("package.json", "utf8"));
  const workflow = readFileSync(".github/workflows/deploy.yml", "utf8");

  it("npm run deploy runs the preflight before building or deploying", () => {
    const deploy = pkg.scripts.deploy;
    expect(deploy, "package.json has no `deploy` script").toBeTruthy();
    expect(deploy).toContain("preflight");
    // Order is the point: a preflight after `wrangler deploy` guards nothing.
    expect(
      deploy.indexOf("preflight"),
      "`preflight` must come before `wrangler deploy` in the chain",
    ).toBeLessThan(deploy.indexOf("wrangler deploy"));
    // `&&` rather than `;` — with `;` a refusal is printed and ignored.
    expect(deploy, "the chain must short-circuit on failure").toContain("&&");
  });

  it("the preflight script points at the file that does the refusing", () => {
    expect(pkg.scripts.preflight).toContain("tools/preflight-deploy.mjs");
  });

  it("every deploy job in the workflow runs it", () => {
    // Jobs are two-space-indented keys; `gate` is the test job and deploys
    // nothing, so it is exempt. Anything that reaches `wrangler deploy` is not.
    const jobs = workflow.split(/\n(?=  [a-z][a-z0-9_-]*:\n)/).slice(1);
    const deploying = jobs.filter((j) => j.includes("wrangler deploy"));
    expect(
      deploying.length,
      "found no job that runs `wrangler deploy` — this check would pass over nothing",
    ).toBeGreaterThan(0);
    for (const job of deploying) {
      const name = job.trim().split(":")[0];
      expect(job, `job \`${name}\` deploys without running the preflight`).toContain(
        "npm run preflight",
      );
    }
  });
});
