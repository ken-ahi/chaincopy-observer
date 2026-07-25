import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";

import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "ChainCopy Observer",
    template: "%s · ChainCopy Observer",
  },
  description: "HyperliquidとSui/Cetusの公開取引データを分析する、単一ユーザー向け監視基盤。",
  robots: {
    follow: false,
    index: false,
  },
};

export const viewport: Viewport = {
  colorScheme: "dark",
  themeColor: "#07111e",
};

export default function RootLayout({ children }: { readonly children: ReactNode }) {
  return (
    <html lang="ja">
      <body>{children}</body>
    </html>
  );
}
