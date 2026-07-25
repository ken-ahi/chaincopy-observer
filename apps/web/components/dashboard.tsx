import {
  Badge,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Progress,
} from "@chaincopy/ui";
import {
  Activity,
  ArrowDownRight,
  ArrowUpRight,
  BarChart3,
  BellRing,
  Bot,
  BriefcaseBusiness,
  ChevronRight,
  CircleDollarSign,
  Database,
  Gauge,
  LayoutDashboard,
  ListFilter,
  Radar,
  ServerCog,
  ShieldCheck,
  Sparkles,
  UserRoundSearch,
  WalletCards,
  Wifi,
} from "lucide-react";

import { SignOutButton } from "./sign-out-button";

interface DashboardProps {
  readonly email: string;
  readonly name: string;
}

const navigation = [
  { active: true, icon: LayoutDashboard, label: "概要" },
  { icon: UserRoundSearch, label: "監視アドレス" },
  { icon: BarChart3, label: "ランキング" },
  { icon: BellRing, label: "売買シグナル" },
  { icon: Bot, label: "デモトレード" },
  { icon: ServerCog, label: "システム状態" },
];

const equityBars = [
  "28%",
  "34%",
  "31%",
  "40%",
  "43%",
  "39%",
  "46%",
  "51%",
  "48%",
  "56%",
  "53%",
  "61%",
  "64%",
  "60%",
  "67%",
  "72%",
  "69%",
  "76%",
  "81%",
  "78%",
  "85%",
  "88%",
  "84%",
  "91%",
];

const systemComponents = [
  { icon: Wifi, label: "API", note: "/ready", status: "確認可能" },
  { icon: Database, label: "PostgreSQL", note: "Prisma", status: "接続待ち" },
  { icon: Activity, label: "Redis", note: "BullMQ", status: "接続待ち" },
  { icon: ServerCog, label: "Worker", note: "sample job", status: "接続待ち" },
];

export function Dashboard({ email, name }: DashboardProps) {
  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[15.5rem_1fr]">
      <aside className="hidden border-r border-white/[0.07] bg-slate-950/45 px-4 py-5 backdrop-blur-xl lg:flex lg:flex-col">
        <Brand />
        <nav aria-label="メインナビゲーション" className="mt-9 space-y-1">
          {navigation.map(({ active, icon: Icon, label }) => (
            <a
              className={
                active
                  ? "flex items-center gap-3 rounded-xl border border-cyan-300/10 bg-cyan-300/[0.08] px-3 py-2.5 text-sm text-cyan-100"
                  : "flex items-center gap-3 rounded-xl border border-transparent px-3 py-2.5 text-sm text-slate-500 transition hover:bg-white/[0.04] hover:text-slate-200"
              }
              href={active ? "/dashboard" : "#planned-sections"}
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
          <div className="hidden lg:block">
            <p className="text-xs text-slate-600">2026年7月25日 · Asia/Tokyo</p>
            <p className="mt-0.5 text-sm font-medium text-slate-200">おかえりなさい、{name}</p>
          </div>
          <div className="flex items-center gap-3">
            <Badge variant="success">
              <span className="size-1.5 rounded-full bg-emerald-300" />
              Phase 1 ready
            </Badge>
            <div className="hidden text-right sm:block">
              <p className="max-w-48 truncate text-xs text-slate-300">{email}</p>
              <p className="text-[10px] text-slate-600">許可済み所有者</p>
            </div>
            <SignOutButton />
          </div>
        </header>

        <div className="mx-auto max-w-[96rem] px-4 py-6 sm:px-7 sm:py-8">
          <section className="mb-7 flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
            <div>
              <div className="mb-2 flex items-center gap-2 text-xs text-cyan-300/80">
                <Sparkles aria-hidden="true" className="size-3.5" />
                ローカル開発基盤
              </div>
              <h1 className="text-2xl font-semibold tracking-[-0.025em] text-white sm:text-3xl">
                Observation deck
              </h1>
              <p className="mt-2 text-xs leading-5 text-slate-500 sm:text-sm">
                データ取得前のモック表示です。各領域は後続Phaseで実データへ接続します。
              </p>
            </div>
            <div className="flex items-center gap-2 text-[11px] text-slate-600">
              <span className="size-1.5 rounded-full bg-cyan-300" />
              最終更新: just now
            </div>
          </section>

          <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <MetricCard
              detail="初期デモ資金"
              icon={CircleDollarSign}
              label="デモ資産"
              value="$10,000.00"
            />
            <MetricCard
              detail="実取引データ未接続"
              icon={ArrowUpRight}
              label="累積損益"
              tone="positive"
              value="+0.00%"
            />
            <MetricCard detail="最大100件 / strategy" icon={Radar} label="監視アドレス" value="0" />
            <MetricCard
              detail="API · DB · Redis · Worker"
              icon={Gauge}
              label="基盤コンポーネント"
              value="4"
            />
          </section>

          <section className="mt-4 grid gap-4 xl:grid-cols-[1.55fr_0.75fr]">
            <Card>
              <CardHeader className="flex-row items-start justify-between">
                <div>
                  <CardTitle>資産推移</CardTitle>
                  <CardDescription>デモポートフォリオ · 30日</CardDescription>
                </div>
                <Badge>MOCK</Badge>
              </CardHeader>
              <CardContent>
                <div className="mb-6 flex items-baseline gap-3">
                  <span className="text-3xl font-semibold tracking-[-0.03em] text-white">
                    $10,000.00
                  </span>
                  <span className="flex items-center text-xs text-emerald-300">
                    <ArrowUpRight aria-hidden="true" className="size-3.5" />
                    0.00%
                  </span>
                </div>
                <div
                  aria-label="資産推移モックチャート"
                  className="relative flex h-48 items-end gap-1 overflow-hidden rounded-xl border border-white/[0.05] bg-[linear-gradient(rgba(255,255,255,0.025)_1px,transparent_1px)] bg-[size:100%_25%] px-3 pt-3"
                  role="img"
                >
                  <div className="absolute inset-x-3 bottom-[45%] h-px bg-cyan-300/15" />
                  {equityBars.map((height, index) => (
                    <div
                      className="min-w-0 flex-1 rounded-t-sm bg-gradient-to-t from-cyan-400/15 to-cyan-300/75 opacity-80"
                      key={`${height}-${index}`}
                      style={{ height }}
                    />
                  ))}
                </div>
                <div className="mt-3 flex justify-between text-[10px] text-slate-700">
                  <span>30日前</span>
                  <span>現在</span>
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
                {systemComponents.map(({ icon: Icon, label, note, status }) => (
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
                    <span className="text-[10px] text-amber-200/70">{status}</span>
                  </div>
                ))}
              </CardContent>
            </Card>
          </section>

          <section className="mt-4 grid gap-4 lg:grid-cols-2 xl:grid-cols-3" id="planned-sections">
            <RankingCard
              icon={ArrowDownRight}
              rows={[
                ["候補アドレス", "収集前"],
                ["判定ルール", "Phase 4"],
                ["最大表示", "100件"],
              ]}
              title="DCAランキング"
            />
            <RankingCard
              icon={BriefcaseBusiness}
              rows={[
                ["候補アドレス", "収集前"],
                ["実効レバレッジ", "Decimal"],
                ["最大表示", "100件"],
              ]}
              title="レバレッジランキング"
            />
            <Card className="lg:col-span-2 xl:col-span-1">
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle>直近シグナル</CardTitle>
                    <CardDescription>リスクフィルター通過イベント</CardDescription>
                  </div>
                  <BellRing aria-hidden="true" className="size-4 text-slate-600" />
                </div>
              </CardHeader>
              <CardContent>
                <div className="flex min-h-36 flex-col items-center justify-center rounded-xl border border-dashed border-white/[0.08] text-center">
                  <ListFilter aria-hidden="true" className="mb-3 size-5 text-slate-700" />
                  <p className="text-xs text-slate-400">シグナルはまだありません</p>
                  <p className="mt-1 text-[10px] text-slate-700">Phase 5で有効になります</p>
                </div>
              </CardContent>
            </Card>
          </section>

          <section className="mt-4 grid gap-4 lg:grid-cols-[1fr_1fr]">
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
                      <p className="text-xs text-slate-300">データソース接続後に表示</p>
                      <p className="mt-1 text-[10px] text-slate-700">Phase 2 · Phase 3</p>
                    </div>
                  </div>
                  <ChevronRight aria-hidden="true" className="size-4 text-slate-700" />
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>デモトレード</CardTitle>
                <CardDescription>Risk Adjusted Mode · 初期資金 10,000 USDC</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="mb-3 flex items-center justify-between text-[11px]">
                  <span className="text-slate-500">実装進行</span>
                  <span className="text-slate-400">基盤完了</span>
                </div>
                <Progress value={18} />
                <p className="mt-4 text-[10px] leading-5 text-slate-700">
                  実際の資金や注文APIには一切接続しません。Phase 6で仮想約定のみを実装します。
                </p>
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

function MetricCard({
  detail,
  icon: Icon,
  label,
  tone = "neutral",
  value,
}: {
  readonly detail: string;
  readonly icon: typeof Activity;
  readonly label: string;
  readonly tone?: "neutral" | "positive";
  readonly value: string;
}) {
  return (
    <Card className="group transition hover:border-white/[0.12]">
      <CardContent className="p-5">
        <div className="mb-5 flex items-center justify-between">
          <span className="text-xs text-slate-500">{label}</span>
          <Icon
            aria-hidden="true"
            className={tone === "positive" ? "size-4 text-emerald-300" : "size-4 text-slate-600"}
          />
        </div>
        <p className="text-2xl font-semibold tracking-[-0.025em] text-white">{value}</p>
        <p className="mt-2 text-[10px] text-slate-700">{detail}</p>
      </CardContent>
    </Card>
  );
}

function RankingCard({
  icon: Icon,
  rows,
  title,
}: {
  readonly icon: typeof Activity;
  readonly rows: ReadonlyArray<readonly [string, string]>;
  readonly title: string;
}) {
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle>{title}</CardTitle>
            <CardDescription>データ取得後に自動更新</CardDescription>
          </div>
          <Icon aria-hidden="true" className="size-4 text-slate-600" />
        </div>
      </CardHeader>
      <CardContent className="space-y-2">
        {rows.map(([label, value]) => (
          <div
            className="flex items-center justify-between border-b border-white/[0.045] py-2.5 last:border-0"
            key={label}
          >
            <span className="text-[11px] text-slate-600">{label}</span>
            <span className="text-[11px] font-medium text-slate-300">{value}</span>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
