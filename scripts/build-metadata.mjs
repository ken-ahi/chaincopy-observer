import { readFileSync } from "node:fs";

const semanticVersionPattern =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-(?:0|[1-9]\d*|[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|[A-Za-z-][0-9A-Za-z-]*))*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;
const shortCommitPattern = /^[0-9a-f]{7}$/;
const isoTimestampPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

const rootPackage = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));

if (typeof rootPackage.version !== "string" || !semanticVersionPattern.test(rootPackage.version)) {
  throw new Error("The root package.json version must be a Semantic Version.");
}

export function resolveBuildMetadata(environment = process.env) {
  return Object.freeze({
    version: isSemanticVersion(environment.APP_VERSION)
      ? environment.APP_VERSION
      : rootPackage.version,
    commit: isShortCommit(environment.BUILD_COMMIT) ? environment.BUILD_COMMIT : "unknown",
    builtAt: isIsoTimestamp(environment.BUILD_TIME) ? environment.BUILD_TIME : "unknown",
  });
}

function isSemanticVersion(value) {
  return typeof value === "string" && semanticVersionPattern.test(value);
}

function isShortCommit(value) {
  return typeof value === "string" && shortCommitPattern.test(value);
}

function isIsoTimestamp(value) {
  return (
    typeof value === "string" &&
    isoTimestampPattern.test(value) &&
    !Number.isNaN(Date.parse(value)) &&
    new Date(value).toISOString() === value
  );
}
