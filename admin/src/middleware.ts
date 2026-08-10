import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

// Public pages + APIs the standalone site (woxus.app) calls cross-origin.
const publicPaths = ["/login", "/buy", "/api/auth/login", "/api/seed", "/api/verify-key", "/api/pricing", "/api/purchase/razorpay-order", "/api/purchase/razorpay-verify", "/api/gemini-keys", "/api/bugs", "/api/public"];

// Allowed CORS origin for the public buy/site app. Configure via SITE_ORIGIN.
const siteOrigin = process.env.SITE_ORIGIN || "https://woxus.vercel.app";

function corsHeaders(): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": siteOrigin,
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Hardware-Id, X-License-Key",
    "Access-Control-Max-Age": "86400",
  };
}

function applyCors(res: NextResponse): NextResponse {
  Object.entries(corsHeaders()).forEach(([k, v]) => res.headers.set(k, v));
  return res;
}

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // Preflight — respond immediately with CORS headers.
  if (req.method === "OPTIONS") {
    return applyCors(new NextResponse(null, { status: 204 }));
  }

  // Public API routes (pricing + purchase) need CORS so the site can call them.
  const isPublicApi = publicPaths.some((p) => pathname.startsWith(p));
  if (isPublicApi) {
    return applyCors(NextResponse.next());
  }

  if (pathname.startsWith("/api/")) {
    const token = req.cookies.get("woxus_admin_token")?.value;
    if (!token) {
      return applyCors(NextResponse.json({ error: "Unauthorized" }, { status: 401 }));
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
