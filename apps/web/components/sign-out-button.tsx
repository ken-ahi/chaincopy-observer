"use client";

import { Button } from "@chaincopy/ui";
import { LogOut } from "lucide-react";
import { signOut } from "next-auth/react";

export function SignOutButton() {
  return (
    <Button
      aria-label="ログアウト"
      onClick={() => void signOut({ callbackUrl: "/login" })}
      size="icon"
      type="button"
      variant="ghost"
    >
      <LogOut aria-hidden="true" className="size-4" />
    </Button>
  );
}
