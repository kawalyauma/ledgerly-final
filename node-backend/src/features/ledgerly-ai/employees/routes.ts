import { Hono } from "hono";
import type { AppEnv } from "../../../http/types.js";
import type { LedgerlyAiEmployeeRegistry } from "./registry.js";

function publicEmployee(employee: Awaited<ReturnType<LedgerlyAiEmployeeRegistry["get"]>>) {
  return {
    id: employee.id,
    key: employee.key,
    name: employee.name,
    role: employee.role,
    description: employee.description,
    icon: employee.icon,
    avatar: employee.avatar,
    capabilities: employee.capabilities,
    memoryScope: employee.memoryScope,
    status: employee.status,
  };
}

export function createLedgerlyAiEmployeeRoutes(registry: LedgerlyAiEmployeeRegistry) {
  const routes = new Hono<AppEnv>();

  routes.get("/", async (c) => {
    const employees = await registry.list(c.get("principal"));
    return c.json({ data: employees.map(publicEmployee) });
  });

  routes.get("/:id", async (c) => {
    const employee = await registry.get(c.get("principal"), c.req.param("id"));
    return c.json({ data: publicEmployee(employee) });
  });

  return routes;
}

export function createLedgerlyAiEmployeeAdminRoutes(registry: LedgerlyAiEmployeeRegistry) {
  const routes = new Hono<AppEnv>();

  routes.get("/", async (c) => {
    return c.json({ data: await registry.adminList(c.get("principal")) });
  });

  return routes;
}
