import { Hono } from "hono";
import type { AppVariables, Env } from "../../../src/types";
import { requireScope } from "../../../src/lib/auth";
import { executeApprovedAction } from "./executor";

export const agenticExecutionRoutes = new Hono<{ Bindings: Env; Variables: AppVariables }>();

agenticExecutionRoutes.post("/approvals/:id/execute", requireScope("school:write"), async c => {
  const principal = c.get("principal");
  const data = await executeApprovedAction(c.env, principal, c.req.param("id"));
  return c.json({ data });
});
