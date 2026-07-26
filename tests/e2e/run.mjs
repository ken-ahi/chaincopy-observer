import { spawn } from "node:child_process";
import { once } from "node:events";
import { createRequire } from "node:module";
import { resolve } from "node:path";

import { PrismaClient } from "@prisma/client";

const root = resolve(import.meta.dirname, "../..");
const workerRequire = createRequire(resolve(root, "apps/worker/package.json"));
const { Redis } = workerRequire("ioredis");
const databaseUrl =
  "postgresql://chaincopy:chaincopy@127.0.0.1:5432/chaincopy?schema=chaincopy_e2e";
const commonEnvironment = {
  ...process.env,
  DATABASE_URL: databaseUrl,
  INTERNAL_API_SECRET: "e2e-internal-secret-at-least-32-chars",
  LOG_LEVEL: "warn",
  NODE_ENV: "test",
  REDIS_URL: "redis://127.0.0.1:6379/15",
  TZ: "Asia/Tokyo",
};
const children = [];

function start(commandArguments, options = {}) {
  const child = spawn(process.execPath, commandArguments, {
    cwd: root,
    env: commonEnvironment,
    stdio: "inherit",
    ...options,
  });
  children.push(child);
  return child;
}

async function waitFor(url, child) {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    if (child.exitCode !== null) {
      throw new Error(`E2E server exited before ${url} became ready.`);
    }
    try {
      const response = await fetch(url);
      if (response.ok) {
        return;
      }
    } catch {
      // The server is still starting.
    }
    await new Promise((resolveDelay) => {
      setTimeout(resolveDelay, 250);
    });
  }
  throw new Error(`Timed out waiting for ${url}.`);
}

async function stop(child) {
  if (child.exitCode !== null) {
    return;
  }
  child.kill("SIGTERM");
  const exited = await Promise.race([
    once(child, "exit").then(() => true),
    new Promise((resolveTimeout) => {
      setTimeout(() => resolveTimeout(false), 5_000);
    }),
  ]);
  if (!exited && child.exitCode === null) {
    child.kill("SIGKILL");
    await once(child, "exit");
  }
}

async function resetTestRedis() {
  const redis = new Redis(commonEnvironment.REDIS_URL, { maxRetriesPerRequest: null });
  try {
    await redis.flushdb();
  } finally {
    await redis.quit();
  }
}

async function removeTestSchema() {
  const administration = new PrismaClient({
    datasources: {
      db: {
        url: "postgresql://chaincopy:chaincopy@127.0.0.1:5432/chaincopy?schema=public",
      },
    },
  });
  try {
    await administration.$executeRawUnsafe('DROP SCHEMA IF EXISTS "chaincopy_e2e" CASCADE');
  } finally {
    await administration.$disconnect();
  }
}

let exitCode = 1;
try {
  await resetTestRedis();
  const api = start(["--import", "tsx", "apps/api/src/server.ts"], {
    env: {
      ...commonEnvironment,
      API_HOST: "127.0.0.1",
      API_PORT: "3101",
    },
  });
  const web = start(
    [
      resolve(root, "apps/web/node_modules/next/dist/bin/next"),
      "start",
      "--hostname",
      "127.0.0.1",
      "--port",
      "3100",
    ],
    {
      cwd: resolve(root, "apps/web"),
      env: {
        ...commonEnvironment,
        ALLOWED_ADMIN_EMAIL: "owner@example.com",
        API_BASE_URL: "http://127.0.0.1:3101",
        APP_BASE_URL: "http://127.0.0.1:3100",
        AUTH_SECRET: "e2e-only-secret-value-at-least-32-characters",
        GOOGLE_CLIENT_ID: "e2e-client-id.apps.googleusercontent.com",
        GOOGLE_CLIENT_SECRET: "e2e-client-secret",
        NEXTAUTH_URL: "http://127.0.0.1:3100",
      },
    },
  );

  await Promise.all([
    waitFor("http://127.0.0.1:3101/health", api),
    waitFor("http://127.0.0.1:3100/login", web),
  ]);
  const playwright = start(
    [resolve(root, "node_modules/@playwright/test/cli.js"), "test", ...process.argv.slice(2)],
    {
      env: {
        ...commonEnvironment,
        E2E_MANAGED_SERVERS: "1",
      },
    },
  );
  const [playwrightExitCode] = await once(playwright, "exit");
  exitCode = typeof playwrightExitCode === "number" ? playwrightExitCode : 1;
} finally {
  await Promise.allSettled(children.map((child) => stop(child)));
  await Promise.all([removeTestSchema(), resetTestRedis()]);
}

process.exitCode = exitCode;
