"use client";

import * as React from "react";

import {
  type PerformanceWarningModel,
  type UserWarning,
  type WarningRunSource,
} from "./performance-warnings";

export function PerformanceWarningSummary({
  model,
}: {
  readonly model: PerformanceWarningModel;
}): React.JSX.Element | null {
  const [expanded, setExpanded] = React.useState(false);
  const regionId = `${React.useId()}-additional-warnings`;
  if (model.visible.length === 0 && model.hidden.length === 0) {
    return null;
  }

  return (
    <section
      aria-labelledby={`${regionId}-title`}
      className="rounded-xl border border-amber-300/20 bg-amber-300/[0.05] p-4"
    >
      <h3 className="text-xs font-semibold text-amber-100" id={`${regionId}-title`}>
        注意
      </h3>
      <WarningList warnings={model.visible} />
      {model.hidden.length > 0 ? (
        <>
          <button
            aria-controls={regionId}
            aria-expanded={expanded}
            aria-label={`ほか${String(model.hidden.length)}件の注意事項を${expanded ? "閉じる" : "開く"}`}
            className="mt-3 min-h-11 rounded-lg border border-amber-200/20 px-3 py-2 text-left text-xs font-medium text-amber-100 hover:bg-amber-200/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-200"
            onClick={() => setExpanded((open) => !open)}
            type="button"
          >
            ほか{String(model.hidden.length)}件の注意事項
          </button>
          <div className="mt-3 grid gap-3" hidden={!expanded} id={regionId}>
            {(["latest", "successful"] as const).map((source) => {
              const warnings = model.hidden.filter((warning) => warning.source === source);
              return warnings.length > 0 ? (
                <div key={source}>
                  <h4 className="text-[11px] font-medium text-slate-300">{sourceLabel(source)}</h4>
                  <WarningList warnings={warnings} />
                </div>
              ) : null;
            })}
          </div>
        </>
      ) : null}
    </section>
  );
}

function WarningList({ warnings }: { readonly warnings: ReadonlyArray<UserWarning> }) {
  return (
    <ul className="mt-2 grid gap-2 text-xs leading-relaxed text-amber-50">
      {warnings.map((warning) => (
        <li data-warning-key={warning.meaningKey} key={`${warning.source}-${warning.meaningKey}`}>
          <span aria-hidden="true" className="mr-2">
            !
          </span>
          {warning.message}
        </li>
      ))}
    </ul>
  );
}

function sourceLabel(source: WarningRunSource): string {
  return source === "latest" ? "最新の計算試行" : "表示中の正常結果";
}
