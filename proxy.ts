import { NextResponse, type NextRequest } from "next/server";

// Must match FEED_KEY_COOKIE in src/server/auth.ts. Not imported from there:
// that module also imports node:crypto, which the Edge proxy bundle
// cannot resolve.
const FEED_KEY_COOKIE = "mdf_key";

// Edge runtime has no node:crypto, so the cookie is hashed with Web Crypto.
async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

export async function proxy(request: NextRequest): Promise<NextResponse> {
  const expectedHash = process.env.MODEL_FEED_API_KEY_SHA256;
  if (!expectedHash) return NextResponse.next();

  const cookie = request.cookies.get(FEED_KEY_COOKIE)?.value;
  if (cookie) {
    // Comparing digests with === (rather than a timing-safe comparison) is
    // acceptable here: an attacker cannot choose the digest bytes, only the
    // cookie value that gets hashed, so there is no useful timing side channel.
    const actualHash = await sha256Hex(cookie);
    if (actualHash === expectedHash.toLowerCase()) {
      return NextResponse.next();
    }
  }

  const loginUrl = new URL("/login", request.url);
  loginUrl.searchParams.set("from", `${request.nextUrl.pathname}${request.nextUrl.search}`);
  return NextResponse.redirect(loginUrl, 307);
}

export const config = {
  matcher: ["/((?!v1|_next/static|_next/image|login|icon|favicon.ico).*)"]
};
