import type { Hono } from "hono";

export type AuthRole = "owner" | "admin" | "accountant" | "manager" | "viewer" | "integration";

export type AuthPrincipal = {
  userId: string;
  organizationId: string;
  role: AuthRole;
  scopes: string[];
  mobileDeviceId?: string;
};

export type AppEnv = {
  Variables: {
    requestId: string;
    principal: AuthPrincipal;
  };
};

export type NodeApp = Hono<AppEnv>;
