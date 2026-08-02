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
  api: _api,
  status,
  web: _web,
}: {
  readonly api: ServiceBuildInfo | null;
  readonly status: SystemVersionState["status"];
  readonly web: ServiceBuildInfo;
}) {
  if (status === "loading" || status === "connected") {
    return null;
  }

  return (
    <p aria-live="polite" className="max-w-64 text-xs leading-relaxed text-amber-200" role="alert">
      最新データを取得できません。表示内容が古い可能性があります。
    </p>
  );
}
