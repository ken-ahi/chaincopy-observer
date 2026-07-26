import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const rootEnvironmentPath = resolve(process.cwd(), ".env");
const rootEnvironment = existsSync(rootEnvironmentPath)
  ? readFileSync(rootEnvironmentPath, "utf8")
  : "";
const configuredAdminEmail = rootEnvironment
  .split(/\r?\n/u)
  .find((line) => line.startsWith("ALLOWED_ADMIN_EMAIL="))
  ?.slice("ALLOWED_ADMIN_EMAIL=".length);

export const e2eAdminEmail =
  process.env.ALLOWED_ADMIN_EMAIL ?? configuredAdminEmail ?? "owner@example.com";
export const e2eAddress = "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee000001";
export const e2eSessionToken = "phase2-e2e-session-token";
