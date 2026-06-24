import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { SESSION_COOKIE, verifySessionToken } from "@/lib/auth/session";

export function proxy(request: NextRequest) {
  const secret = process.env.AUTH_SESSION_SECRET ?? "";
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  const session = secret.length >= 32 ? verifySessionToken(token, secret) : null;
  if (!session) return NextResponse.redirect(new URL("/login", request.url));
  if (
    request.nextUrl.pathname.startsWith("/operator") &&
    session.role !== "operator"
  ) {
    return NextResponse.redirect(new URL("/", request.url));
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/", "/variance/:path*", "/operator/:path*"],
};
