import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const publicPaths = ["/login", "/buy", "/api/auth/login", "/api/seed", "/api/verify-key", "/api/pricing", "/api/purchase/razorpay-order", "/api/purchase/razorpay-verify"];

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  if (publicPaths.some((p) => pathname.startsWith(p))) return NextResponse.next();

  if (pathname.startsWith("/api/")) {
    const token = req.cookies.get("woxus_admin_token")?.value;
    if (!token) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.next();
  }

  const token = req.cookies.get("woxus_admin_token")?.value;
  if (!token) {
    return NextResponse.redirect(new URL("/login", req.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
