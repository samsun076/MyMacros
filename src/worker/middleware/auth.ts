import { createMiddleware } from "hono/factory";
import { createAuth } from "../auth";
import { createDb } from "../db";
import type { AppEnv } from "../types";

/** Rejects anything without a live session, and puts the user, a Kysely
 *  instance, and the auth instance on the context.
 *
 *  Routes must take the user id from `c.var.user` and never from the request
 *  — a body field or query param named `userId` is an authorization bug, not
 *  a convenience (PLAN.md: per-user data isolation from day one). */
export const requireAuth = createMiddleware<AppEnv>(async (c, next) => {
  const auth = createAuth(c.env);
  const session = await auth.api.getSession({ headers: c.req.raw.headers });

  if (!session) {
    return c.json({ error: "unauthorized" }, 401);
  }

  c.set("auth", auth);
  c.set("db", createDb(c.env));
  c.set("user", session.user);
  c.set("session", session.session);

  await next();
});
