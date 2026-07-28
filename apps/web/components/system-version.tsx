"use client";

import * as React from "react";
import { useEffect, useState } from "react";

import {
  compareBuildInfo,
  type BuildMatchStatus,
  type ServiceBuildInfo,
  WEB_BUILD_INFO,
} from "../lib/build-info";
import { getApiBuildInfoOnce } from "../lib/system-version-client";

type SystemVersionState =
  | { readonly status: "loading"; readonly api: null }
  | { readonly status: "unavailable"; readonly api: null }
  | {
      readonly status: BuildMatchStatus;
      readonly api: ServiceBuildInfo;
    };

export function SystemVersion() {
  const [state, setState] = useState<SystemVersionState>({
    status: "loading",
    api: null,
  });

  useEffect(() => {
    let mounted = true;

    void getApiBuildInfoOnce()
      .then((api) => {
        if (mounted) {
          setState({
            status: compareBuildInfo(WEB_BUILD_INFO, api),
            api,
          });
        }
      })
      .catch(() => {
        if (mounted) {
          setState({ status: "unavailable", api: null });
        }
      });

    return () => {
      mounted = false;
    };
  }, []);

  return <SystemVersionView api={state.api} status={state.status} web={WEB_BUILD_INFO} />;
}

export function SystemVersionView({
  api,
  status,
  web,
}: {
  readonly api: ServiceBuildInfo | null;
  readonly status: SystemVersionState["status"];
  readonly web: ServiceBuildInfo;
}) {
  const statusStyle =
    status === "connected"
      ? "text-emerald-300"
      : status === "mismatch"
        ? "text-amber-300"
        : status === "unavailable"
          ? "text-rose-300"
          : "text-slate-500";

  return (
    <div
      aria-label="稼働バージョン"
      aria-live="polite"
      className="min-w-fit text-[10px] leading-4 text-slate-400"
    >
      <p title={`Web builtAt: ${web.builtAt}`}>
        Web v{web.version}
        <span className="hidden md:inline"> {web.commit}</span>
      </p>
      {api ? (
        <p title={`API builtAt: ${api.builtAt}`}>
          API v{api.version}
          <span className="hidden md:inline"> {api.commit}</span>
          <span className={`hidden md:inline ${statusStyle}`}>
            {status === "connected" ? " 接続済み" : ""}
          </span>
        </p>
      ) : status === "unavailable" ? (
        <p className={statusStyle}>APIバージョン取得失敗</p>
      ) : (
        <p className={statusStyle}>API確認中</p>
      )}
      {status === "mismatch" ? (
        <p className={`hidden lg:block ${statusStyle}`}>Web/APIのビルドが一致していません</p>
      ) : null}
    </div>
  );
}
