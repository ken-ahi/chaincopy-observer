import * as React from "react";

import { cn } from "../lib/utils.js";

interface ProgressProps extends React.ComponentProps<"div"> {
  readonly value: number;
}

export function Progress({ value, className, ...props }: ProgressProps): React.JSX.Element {
  const boundedValue = Math.max(0, Math.min(100, value));

  return (
    <div
      aria-label={`進捗 ${boundedValue}%`}
      aria-valuemax={100}
      aria-valuemin={0}
      aria-valuenow={boundedValue}
      className={cn("h-1.5 overflow-hidden rounded-full bg-white/[0.06]", className)}
      role="progressbar"
      {...props}
    >
      <div
        className="h-full rounded-full bg-gradient-to-r from-cyan-400 to-emerald-300 transition-all"
        style={{ width: `${boundedValue}%` }}
      />
    </div>
  );
}
