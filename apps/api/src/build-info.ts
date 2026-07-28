import rootPackage from "../../../package.json" with { type: "json" };

declare const __APP_VERSION__: string;
declare const __BUILD_COMMIT__: string;
declare const __BUILD_TIME__: string;

export interface ApiBuildInfo {
  readonly service: "api";
  readonly version: string;
  readonly commit: string;
  readonly builtAt: string;
}

export const API_BUILD_INFO: ApiBuildInfo = Object.freeze({
  service: "api",
  version: typeof __APP_VERSION__ === "string" ? __APP_VERSION__ : rootPackage.version,
  commit: typeof __BUILD_COMMIT__ === "string" ? __BUILD_COMMIT__ : "unknown",
  builtAt: typeof __BUILD_TIME__ === "string" ? __BUILD_TIME__ : "unknown",
});
