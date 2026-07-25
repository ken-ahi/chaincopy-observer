import { Button } from "@chaincopy/ui";
import Link from "next/link";

export default function NotFound() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center px-6 text-center">
      <p className="text-xs uppercase tracking-[0.3em] text-cyan-300">404</p>
      <h1 className="mt-4 text-3xl font-semibold text-white">ページが見つかりません</h1>
      <p className="mt-3 text-sm text-slate-500">指定された観測画面はまだ存在しません。</p>
      <Button asChild className="mt-7">
        <Link href="/dashboard">ダッシュボードへ戻る</Link>
      </Button>
    </main>
  );
}
