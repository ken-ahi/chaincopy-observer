import { cva, type VariantProps } from "class-variance-authority";
import * as React from "react";

import { cn } from "../lib/utils.js";

const badgeVariants = cva(
  "inline-flex w-fit items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium tracking-wide",
  {
    variants: {
      variant: {
        neutral: "border-white/10 bg-white/[0.05] text-slate-400",
        success: "border-emerald-400/20 bg-emerald-400/10 text-emerald-300",
        warning: "border-amber-300/20 bg-amber-300/10 text-amber-200",
        info: "border-cyan-300/20 bg-cyan-300/10 text-cyan-200",
      },
    },
    defaultVariants: {
      variant: "neutral",
    },
  },
);

export interface BadgeProps
  extends React.ComponentProps<"span">, VariantProps<typeof badgeVariants> {}

export function Badge({ className, variant, ...props }: BadgeProps): React.JSX.Element {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}
