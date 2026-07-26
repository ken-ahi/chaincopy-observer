import type { Metadata } from "next";

import { AddressHeader } from "@/components/address-header";
import { DiscoveryDetailClient } from "@/components/discovery-detail-client";
import { requireAdminSession } from "@/lib/require-admin";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "探索候補詳細",
};

export default async function DiscoveryDetailPage({
  params,
}: {
  readonly params: Promise<{ readonly address: string }>;
}) {
  const [session, routeParams] = await Promise.all([requireAdminSession(), params]);
  return (
    <main className="min-h-screen">
      <AddressHeader email={session.user?.email ?? ""} />
      <DiscoveryDetailClient address={routeParams.address} />
    </main>
  );
}
