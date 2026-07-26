import { loadRootEnvironment, readWebEnv } from "@chaincopy/config";
import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";

import { authOptions } from "./auth";
import { isAllowedAdminEmail } from "./authorization";

export async function requireAdminSession() {
  loadRootEnvironment();
  const env = readWebEnv();
  const session = await getServerSession(authOptions);

  if (!session?.user?.email) {
    redirect("/login");
  }
  if (!isAllowedAdminEmail(session.user.email, env.ALLOWED_ADMIN_EMAIL)) {
    redirect("/login?error=AccessDenied");
  }
  return session;
}
