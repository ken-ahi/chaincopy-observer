import { Badge, Card, CardContent } from "@chaincopy/ui";
import { Activity, Database, LockKeyhole, Radar } from "lucide-react";
import type { Metadata } from "next";

import { LoginButton } from "@/components/login-button";

export const metadata: Metadata = {
  title: "ログイン",
};

const assurances = [
  { icon: LockKeyhole, label: "許可メール1件のみ" },
  { icon: Database, label: "公開データの読み取り専用" },
  { icon: Activity, label: "実注文・ウォレット署名なし" },
];

export default function LoginPage() {
  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden px-5 py-12">
      <div
        aria-hidden="true"
        className="absolute left-1/2 top-1/2 h-[36rem] w-[36rem] -translate-x-1/2 -translate-y-1/2 rounded-full border border-cyan-300/[0.06]"
      />
      <div
        aria-hidden="true"
        className="absolute left-1/2 top-1/2 h-[24rem] w-[24rem] -translate-x-1/2 -translate-y-1/2 rounded-full border border-cyan-300/[0.08]"
      />

      <div className="relative grid w-full max-w-5xl overflow-hidden rounded-[2rem] border border-white/[0.08] bg-slate-950/60 shadow-[0_40px_120px_rgba(0,0,0,0.42)] backdrop-blur-2xl lg:grid-cols-[1.2fr_0.8fr]">
        <section className="flex min-h-[32rem] flex-col justify-between p-8 sm:p-12">
          <div>
            <div className="mb-12 flex items-center gap-3">
              <span className="flex size-10 items-center justify-center rounded-xl border border-cyan-300/20 bg-cyan-300/10 text-cyan-200">
                <Radar aria-hidden="true" className="size-5" />
              </span>
              <div>
                <p className="text-sm font-semibold tracking-tight text-white">
                  ChainCopy Observer
                </p>
                <p className="text-[11px] uppercase tracking-[0.22em] text-slate-600">
                  Private intelligence
                </p>
              </div>
            </div>

            <Badge variant="info">Phase 1 · 開発基盤</Badge>
            <h1 className="mt-5 max-w-xl text-4xl font-semibold leading-[1.08] tracking-[-0.04em] text-white sm:text-5xl">
              オンチェーンの動きを、
              <span className="block bg-gradient-to-r from-cyan-200 to-emerald-300 bg-clip-text text-transparent">
                静かに見極める。
              </span>
            </h1>
            <p className="mt-5 max-w-lg text-sm leading-7 text-slate-400">
              HyperliquidとSui/Cetusの公開データを観測し、優れた戦略を検証するための個人専用ワークスペースです。
            </p>
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            {assurances.map(({ icon: Icon, label }) => (
              <div
                className="rounded-xl border border-white/[0.06] bg-white/[0.025] p-3"
                key={label}
              >
                <Icon aria-hidden="true" className="mb-2 size-4 text-slate-500" />
                <p className="text-[11px] leading-5 text-slate-400">{label}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="flex items-center border-t border-white/[0.07] bg-white/[0.025] p-6 sm:p-10 lg:border-l lg:border-t-0">
          <Card className="w-full bg-slate-950/70">
            <CardContent className="p-6 sm:p-7">
              <div className="mb-7">
                <p className="text-lg font-semibold tracking-tight text-white">所有者ログイン</p>
                <p className="mt-2 text-xs leading-5 text-slate-500">
                  許可されたGoogleアカウントだけがダッシュボードへ進めます。
                </p>
              </div>
              <LoginButton />
              <div className="my-6 h-px bg-white/[0.07]" />
              <p className="text-center text-[11px] leading-5 text-slate-600">
                本アプリは分析・通知専用です。実際の売買注文やウォレット署名は行いません。
              </p>
            </CardContent>
          </Card>
        </section>
      </div>
    </main>
  );
}
