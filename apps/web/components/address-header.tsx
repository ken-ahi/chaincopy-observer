import { Badge } from "@chaincopy/ui";
import { Activity, ArrowLeft, Radar, Telescope } from "lucide-react";
import Link from "next/link";

import { SignOutButton } from "./sign-out-button";

export function AddressHeader({ email }: { readonly email: string }) {
  return (
    <header className="sticky top-0 z-20 border-b border-white/[0.07] bg-[#07111e]/90 backdrop-blur-xl">
      <div className="mx-auto flex h-[4.5rem] max-w-[96rem] items-center justify-between px-4 sm:px-7">
        <div className="flex items-center gap-5">
          <Link className="flex items-center gap-3" href="/dashboard">
            <span className="flex size-9 items-center justify-center rounded-xl border border-cyan-300/20 bg-cyan-300/10 text-cyan-200">
              <Radar aria-hidden="true" className="size-[1.1rem]" />
            </span>
            <div className="hidden sm:block">
              <p className="text-sm font-semibold tracking-tight text-white">ChainCopy</p>
              <p className="text-[9px] uppercase tracking-[0.24em] text-slate-700">Observer</p>
            </div>
          </Link>
          <nav className="flex items-center gap-3" aria-label="Dashboard">
            <Link
              className="flex items-center gap-1.5 text-xs text-slate-500 transition hover:text-slate-200"
              href="/dashboard"
            >
              <ArrowLeft aria-hidden="true" className="size-3.5" />
              概要
            </Link>
            <Link
              className="hidden items-center gap-1.5 text-xs text-slate-500 transition hover:text-cyan-200 md:flex"
              href="/dashboard/addresses"
            >
              <Activity aria-hidden="true" className="size-3.5" />
              監視
            </Link>
            <Link
              className="hidden items-center gap-1.5 text-xs text-slate-500 transition hover:text-cyan-200 md:flex"
              href="/dashboard/discovery"
            >
              <Telescope aria-hidden="true" className="size-3.5" />
              探索
            </Link>
          </nav>
        </div>
        <div className="flex items-center gap-3">
          <Badge variant="info">Phase 3 · Discovery</Badge>
          <span className="hidden max-w-48 truncate text-xs text-slate-500 sm:block">{email}</span>
          <SignOutButton />
        </div>
      </div>
    </header>
  );
}
