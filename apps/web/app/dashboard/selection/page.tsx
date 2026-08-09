import type { Metadata } from "next";

import { AddressHeader } from "@/components/address-header";
import { SelectionClient } from "@/components/selection-client";
import { requireAdminSession } from "@/lib/require-admin";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "参考にするアドレス" };

export default async function SelectionPage() {
  const session = await requireAdminSession();
  return (
    <main className="min-h-screen">
      <AddressHeader email={session.user?.email ?? ""} />
      <SelectionClient />
    </main>
  );
}
