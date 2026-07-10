import { NextResponse, type NextRequest } from "next/server";
import { FEED_KEY_COOKIE } from "@/server/auth";

export async function POST(request: NextRequest): Promise<NextResponse> {
  const response = NextResponse.redirect(new URL("/login", request.url));
  response.cookies.delete(FEED_KEY_COOKIE);
  return response;
}
