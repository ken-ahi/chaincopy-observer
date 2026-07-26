import type { Metadata } from "next";

import { AddressHeader } from "@/components/address-header";
import { AddressesClient } from "@/components/addresses-client";
import { requireAdminSession } from "@/lib/require-admin";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "監視アドレス",
};

export default async function AddressesPage() {
  const session = await requireAdminSession();
  return (
    <main className="min-h-screen">
      <AddressHeader email={session.user?.email ?? ""} />
      <AddressesClient />
    </main>
  );
}
