"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { FEED_KEY_COOKIE, verifyFeedApiKey } from "@/server/auth";

export type LoginState = { error?: string };

export async function login(_prevState: LoginState, formData: FormData): Promise<LoginState> {
  const key = String(formData.get("key") ?? "");
  const from = String(formData.get("from") ?? "/");

  const hash = process.env.MODEL_FEED_API_KEY_SHA256;
  if (!hash) {
    redirect("/");
  }

  if (!verifyFeedApiKey(key, hash)) {
    return { error: "That key was not accepted." };
  }

  (await cookies()).set(FEED_KEY_COOKIE, key, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/"
  });

  redirect(resolveSafeRedirect(from));
}

function resolveSafeRedirect(from: string): string {
  try {
    const resolved = new URL(from, "http://internal.invalid");
    return resolved.origin === "http://internal.invalid" ? `${resolved.pathname}${resolved.search}` : "/";
  } catch {
    return "/";
  }
}
