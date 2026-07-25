import { loadRootEnvironment, readWebEnv } from "@chaincopy/config";
import { getServerSession } from "next-auth";
import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { Dashboard } from "@/components/dashboard";
import { isAllowedAdminEmail } from "@/lib/authorization";
import { authOptions } from "@/lib/auth";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "ダッシュボード",
};

export default async function DashboardPage() {
  loadRootEnvironment();
  const env = readWebEnv();
  const session = await getServerSession(authOptions);

  if (!session?.user?.email) {
    redirect("/login");
  }
  if (!isAllowedAdminEmail(session.user.email, env.ALLOWED_ADMIN_EMAIL)) {
    redirect("/login?error=AccessDenied");
  }

  return <Dashboard email={session.user.email} name={session.user.name ?? "Owner"} />;
}
