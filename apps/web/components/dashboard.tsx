import { Badge, Card, CardContent, CardDescription, CardHeader, CardTitle } from "@chaincopy/ui";
import {
  Activity,
  BarChart3,
  BellRing,
  Bot,
  ChevronRight,
  Database,
  LayoutDashboard,
  Radar,
  ServerCog,
  ShieldCheck,
  Sparkles,
  Telescope,
  UsersRound,
  UserRoundSearch,
  WalletCards,
  Wifi,
} from "lucide-react";

import { SignOutButton } from "./sign-out-button";
import { SystemVersion } from "./system-version";

interface DashboardProps {
  readonly email: string;
  readonly name: string;
}

const navigation = [
  { active: true, href: "/dashboard", icon: LayoutDashboard, label: "ホーム" },
  {
    href: "/dashboard/addresses",
    icon: UserRoundSearch,
    label: "監視中のアドレス",
  },
  { href: "/dashboard/discovery", icon: Telescope, label: "優良アドレスを探す" },
  { href: "/dashboard/selection", icon: UsersRound, label: "参考アドレス" },
  { href: "#planned-sections", icon: BarChart3, label: "ランキング" },
  { href: "#planned-sections", icon: BellRing, label: "売買シグナル" },
  { href: "#planned-sections", icon: Bot, label: "デモトレード" },
  { href: "#planned-sections", icon: ServerCog, label: "システム状態" },
];

const systemComponents = [
  { icon: Wifi, label: "API", note: "GET /ready" },
  { icon: Database, label: "PostgreSQL", note: "API readiness で確認" },
  { icon: Activity, label: "Redis", note: "API readiness で確認" },
  { icon: ServerCog, label: "Worker", note: "GET :3002/health" },
];

export function Dashboard({ email, name }: DashboardProps) {
  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[15.5rem_1fr]">
      <aside className="hidden border-r border-white/[0.07] bg-slate-950/45 px-4 py-5 backdrop-blur-xl lg:flex lg:flex-col">
        <Brand />
        <nav aria-label="メインナビゲーション" className="mt-9 space-y-1">
          {navigation.map(({ active, href, icon: Icon, label }) => (
            <a
              className={
                active
                  ? "flex items-center gap-3 rounded-xl border border-cyan-300/10 bg-cyan-300/[0.08] px-3 py-2.5 text-sm text-cyan-100"
                  : "flex items-center gap-3 rounded-xl border border-transparent px-3 py-2.5 text-sm text-slate-500 transition hover:bg-white/[0.04] hover:text-slate-200"
              }
              href={href}
              key={label}
            >
              <Icon aria-hidden="true" className="size-4" />
              {label}
            </a>
          ))}
        </nav>

        <div className="mt-auto rounded-2xl border border-white/[0.07] bg-white/[0.025] p-4">
          <div className="mb-3 flex items-center gap-2 text-xs font-medium text-slate-300">
            <ShieldCheck aria-hidden="true" className="size-4 text-emerald-300" />
            Read-only policy
          </div>
          <p className="text-[11px] leading-5 text-slate-600">
            実注文・ウォレット接続・秘密鍵の取扱いはコードベース全体で禁止されています。
          </p>
        </div>
      </aside>

      <main className="min-w-0">
        <header className="sticky top-0 z-20 flex h-[4.5rem] items-center justify-between border-b border-white/[0.07] bg-[#07111e]/80 px-4 backdrop-blur-xl sm:px-7">
          <div className="lg:hidden">
            <Brand />
          </div>
          <p className="hidden text-sm font-medium text-slate-200 lg:block">
            おかえりなさい、{name}
          </p>
          <div className="flex items-center gap-3">
            <SystemVersion />
            <div className="hidden text-right sm:block">
              <p className="max-w-48 truncate text-xs text-slate-300">{email}</p>
              <p className="text-[10px] text-slate-600">許可済み所有者</p>
            </div>
            <SignOutButton />
          </div>
        </header>

        <div className="mx-auto max-w-[96rem] px-4 py-6 sm:px-7 sm:py-8">
          <section className="mb-7">
            <div>
              <div className="mb-2 flex items-center gap-2 text-xs text-cyan-300/80">
                <Sparkles aria-hidden="true" className="size-3.5" />
                ローカル開発基盤
              </div>
              <h1 className="text-2xl font-semibold tracking-[-0.025em] text-white sm:text-3xl">
                Observation deck
              </h1>
              <p className="mt-2 text-xs leading-5 text-slate-500 sm:text-sm">
                Hyperliquid監視と市場ストリームからの候補自動探索が実データに接続済みです。
              </p>
            </div>
          </section>

          <section className="mt-4 grid gap-4 xl:grid-cols-[1.55fr_0.75fr]">
            <Card>
              <CardHeader>
                <CardTitle>Hyperliquid 公開データ</CardTitle>
                <CardDescription>Phase 2 で利用できる実データ機能</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="rounded-xl border border-white/[0.05] bg-white/[0.025] p-4">
                  <p className="text-xs font-medium text-slate-300">履歴同期と監視</p>
                  <p className="mt-2 text-[11px] leading-5 text-slate-600">
                    Fill、Funding、Ledger、Position、Order、Portfolio、Sync Cursor、Data
                    Qualityを公開APIから取得します。
                  </p>
                </div>
                <div className="flex items-center justify-between rounded-xl border border-cyan-300/10 bg-cyan-300/[0.04] p-4">
                  <div>
                    <p className="text-xs font-medium text-cyan-100">監視アドレスを開く</p>
                    <p className="mt-1 text-[10px] text-slate-600">
                      登録、watch ON/OFF、手動同期、履歴確認
                    </p>
                  </div>
                  <a
                    className="flex items-center gap-1 text-xs text-cyan-200 hover:underline"
                    href="/dashboard/addresses"
                  >
                    開く
                    <ChevronRight aria-hidden="true" className="size-4" />
                  </a>
                </div>
                <div className="flex items-center justify-between rounded-xl border border-emerald-300/10 bg-emerald-300/[0.04] p-4">
                  <div>
                    <p className="text-xs font-medium text-emerald-100">自動探索を開く</p>
                    <p className="mt-1 text-[10px] text-slate-600">
                      市場trades、候補統計、詳細分析、監視対象に追加
                    </p>
                  </div>
                  <a
                    className="flex items-center gap-1 text-xs text-emerald-200 hover:underline"
                    href="/dashboard/discovery"
                  >
                    開く
                    <ChevronRight aria-hidden="true" className="size-4" />
                  </a>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle>システム状態</CardTitle>
                    <CardDescription>Phase 1 connectivity</CardDescription>
                  </div>
                  <Badge variant="info">HEALTH</Badge>
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                {systemComponents.map(({ icon: Icon, label, note }) => (
                  <div
                    className="flex items-center justify-between rounded-xl border border-white/[0.05] bg-white/[0.025] p-3"
                    key={label}
                  >
                    <div className="flex items-center gap-3">
                      <span className="flex size-8 items-center justify-center rounded-lg bg-white/[0.04] text-slate-500">
                        <Icon aria-hidden="true" className="size-4" />
                      </span>
                      <div>
                        <p className="text-xs font-medium text-slate-300">{label}</p>
                        <p className="mt-0.5 text-[10px] text-slate-700">{note}</p>
                      </div>
                    </div>
                    <span className="text-[10px] text-slate-700">health endpoint</span>
                  </div>
                ))}
              </CardContent>
            </Card>
          </section>

          <section className="mt-4" id="planned-sections">
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle>後続 Phase の機能</CardTitle>
                    <CardDescription>現在は利用できません</CardDescription>
                  </div>
                  <Badge>未実装</Badge>
                </div>
              </CardHeader>
              <CardContent>
                <div className="grid gap-3 sm:grid-cols-3">
                  {[
                    { icon: BarChart3, label: "ランキング・分析" },
                    { icon: BellRing, label: "売買シグナル" },
                    { icon: Bot, label: "デモトレード" },
                  ].map(({ icon: Icon, label }) => (
                    <div
                      className="flex items-center gap-3 rounded-xl border border-white/[0.05] bg-white/[0.02] p-4"
                      key={label}
                    >
                      <Icon aria-hidden="true" className="size-4 text-slate-600" />
                      <span className="text-xs text-slate-500">{label}</span>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </section>

          <section className="mt-4">
            <Card>
              <CardHeader>
                <CardTitle>監視アドレス</CardTitle>
                <CardDescription>Hyperliquid · Sui/Cetus</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="flex items-center justify-between rounded-xl border border-white/[0.05] bg-white/[0.02] p-4">
                  <div className="flex items-center gap-3">
                    <WalletCards aria-hidden="true" className="size-5 text-cyan-300/70" />
                    <div>
                      <a
                        className="text-xs text-cyan-200 hover:underline"
                        href="/dashboard/addresses"
                      >
                        Hyperliquid監視を開く
                      </a>
                      <p className="mt-1 text-[10px] text-slate-700">Phase 2 · 公開データのみ</p>
                    </div>
                  </div>
                  <ChevronRight aria-hidden="true" className="size-4 text-slate-700" />
                </div>
              </CardContent>
            </Card>
          </section>
        </div>
      </main>
    </div>
  );
}

function Brand() {
  return (
    <a className="flex items-center gap-3" href="/dashboard">
      <span className="flex size-9 items-center justify-center rounded-xl border border-cyan-300/20 bg-cyan-300/10 text-cyan-200">
        <Radar aria-hidden="true" className="size-[1.1rem]" />
      </span>
      <div>
        <p className="text-sm font-semibold tracking-tight text-white">ChainCopy</p>
        <p className="text-[9px] uppercase tracking-[0.24em] text-slate-700">Observer</p>
      </div>
    </a>
  );
}
