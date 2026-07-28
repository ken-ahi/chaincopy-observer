const semanticVersionPattern =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-(?:0|[1-9]\d*|[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|[A-Za-z-][0-9A-Za-z-]*))*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;
const shortCommitPattern = /^(?:[0-9a-f]{7}|unknown)$/;
const isoTimestampPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

export interface ServiceBuildInfo {
  readonly service: "api" | "web";
  readonly version: string;
  readonly commit: string;
  readonly builtAt: string;
}

export type BuildMatchStatus = "connected" | "mismatch";

export const WEB_BUILD_INFO: ServiceBuildInfo = Object.freeze({
  service: "web",
  version: isSemanticVersion(process.env.NEXT_PUBLIC_BUILD_VERSION)
    ? process.env.NEXT_PUBLIC_BUILD_VERSION
    : "0.0.0",
  commit: isShortCommit(process.env.NEXT_PUBLIC_BUILD_COMMIT)
    ? process.env.NEXT_PUBLIC_BUILD_COMMIT
    : "unknown",
  builtAt: isBuildTime(process.env.NEXT_PUBLIC_BUILD_TIME)
    ? process.env.NEXT_PUBLIC_BUILD_TIME
    : "unknown",
});

export function parseServiceBuildInfo(
  input: unknown,
  expectedService: ServiceBuildInfo["service"],
): ServiceBuildInfo | null {
  if (!isRecord(input)) {
    return null;
  }

  const { service, version, commit, builtAt } = input;
  if (
    service !== expectedService ||
    !isSemanticVersion(version) ||
    !isShortCommit(commit) ||
    !isBuildTime(builtAt)
  ) {
    return null;
  }

  return { service: expectedService, version, commit, builtAt };
}

export function compareBuildInfo(web: ServiceBuildInfo, api: ServiceBuildInfo): BuildMatchStatus {
  return web.version === api.version && web.commit === api.commit ? "connected" : "mismatch";
}

function isSemanticVersion(value: unknown): value is string {
  return typeof value === "string" && semanticVersionPattern.test(value);
}

function isShortCommit(value: unknown): value is string {
  return typeof value === "string" && shortCommitPattern.test(value);
}

function isBuildTime(value: unknown): value is string {
  return (
    value === "unknown" ||
    (typeof value === "string" &&
      isoTimestampPattern.test(value) &&
      !Number.isNaN(Date.parse(value)) &&
      new Date(value).toISOString() === value)
  );
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null;
}
