"use client";

import { Button } from "@chaincopy/ui";
import { ArrowRight, LoaderCircle } from "lucide-react";
import { signIn } from "next-auth/react";
import { useState } from "react";

export function LoginButton() {
  const [pending, setPending] = useState(false);

  return (
    <Button
      className="w-full"
      disabled={pending}
      onClick={() => {
        setPending(true);
        void signIn("google", { callbackUrl: "/dashboard" });
      }}
      size="lg"
      type="button"
    >
      {pending ? (
        <>
          <LoaderCircle aria-hidden="true" className="size-4 animate-spin" />
          Googleへ接続中
        </>
      ) : (
        <>
          Googleでログイン
          <ArrowRight aria-hidden="true" className="size-4" />
        </>
      )}
    </Button>
  );
}
