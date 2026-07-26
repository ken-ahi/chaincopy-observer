import type { Metadata } from "next";

import { AddressHeader } from "@/components/address-header";
import { DiscoveryClient } from "@/components/discovery-client";
import { requireAdminSession } from "@/lib/require-admin";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "アドレス自動探索",
};

export default async function DiscoveryPage() {
  const session = await requireAdminSession();
  return (
    <main className="min-h-screen">
      <AddressHeader email={session.user?.email ?? ""} />
      <DiscoveryClient />
    </main>
  );
}
