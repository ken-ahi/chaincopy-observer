import { PrismaAdapter } from "@next-auth/prisma-adapter";
import { loadRootEnvironment, readWebEnv } from "@chaincopy/config";
import { prisma } from "@chaincopy/database";
import { type NextAuthOptions } from "next-auth";
import GoogleProvider from "next-auth/providers/google";

import { isAllowedAdminEmail } from "./authorization";

loadRootEnvironment();

const env = readWebEnv();

export const authOptions: NextAuthOptions = {
  adapter: PrismaAdapter(prisma),
  callbacks: {
    async signIn({ account, user }) {
      return (
        account?.provider === "google" && isAllowedAdminEmail(user.email, env.ALLOWED_ADMIN_EMAIL)
      );
    },
    async session({ session, user }) {
      if (session.user) {
        session.user.id = user.id;
      }
      return session;
    },
  },
  pages: {
    error: "/login",
    signIn: "/login",
  },
  providers: [
    GoogleProvider({
      clientId: env.GOOGLE_CLIENT_ID,
      clientSecret: env.GOOGLE_CLIENT_SECRET,
    }),
  ],
  secret: env.AUTH_SECRET,
  session: {
    strategy: "database",
  },
};
