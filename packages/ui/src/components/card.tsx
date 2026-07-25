import * as React from "react";

import { cn } from "../lib/utils.js";

export function Card({ className, ...props }: React.ComponentProps<"section">): React.JSX.Element {
  return (
    <section
      className={cn(
        "rounded-2xl border border-white/[0.08] bg-slate-950/55 shadow-[0_24px_80px_rgba(2,6,23,0.26)] backdrop-blur-xl",
        className,
      )}
      {...props}
    />
  );
}

export function CardHeader({
  className,
  ...props
}: React.ComponentProps<"header">): React.JSX.Element {
  return <header className={cn("flex flex-col gap-1.5 p-5", className)} {...props} />;
}

export function CardTitle({ className, ...props }: React.ComponentProps<"h2">): React.JSX.Element {
  return (
    <h2
      className={cn("text-sm font-semibold tracking-tight text-slate-100", className)}
      {...props}
    />
  );
}

export function CardDescription({
  className,
  ...props
}: React.ComponentProps<"p">): React.JSX.Element {
  return <p className={cn("text-xs leading-relaxed text-slate-500", className)} {...props} />;
}

export function CardContent({
  className,
  ...props
}: React.ComponentProps<"div">): React.JSX.Element {
  return <div className={cn("px-5 pb-5", className)} {...props} />;
}
