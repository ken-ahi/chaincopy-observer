import type { Metadata } from "next";

import { AddressDetailClient } from "@/components/address-detail-client";
import { AddressHeader } from "@/components/address-header";
import { requireAdminSession } from "@/lib/require-admin";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "アドレス詳細",
};

export default async function AddressDetailPage({
  params,
}: {
  readonly params: Promise<{ readonly address: string }>;
}) {
  const [session, routeParams] = await Promise.all([requireAdminSession(), params]);
  return (
    <main className="min-h-screen">
      <AddressHeader email={session.user?.email ?? ""} />
      <AddressDetailClient address={routeParams.address} />
    </main>
  );
}
