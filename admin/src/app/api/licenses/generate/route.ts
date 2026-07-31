import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { connectDB } from "@/lib/mongodb/connection";
import { License } from "@/models/License";
import { getSession } from "@/lib/auth";

function generateKey(): string {
  const seg1 = crypto.randomBytes(4).toString("hex").toUpperCase();
  const seg2 = crypto.randomBytes(4).toString("hex").toUpperCase();
  const seg3 = crypto.randomBytes(4).toString("hex").toUpperCase();
  return `WOX-${seg1}-${seg2}-${seg3}`;
}

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  await connectDB();

  const body = await req.json().catch(() => ({}));
  const expiryDays = body.expiryDays ?? 365;
  const features = body.features ?? ["all"];
  const maxActivations = 1;

  const key = generateKey();
  const expiry = expiryDays > 0
    ? new Date(Date.now() + expiryDays * 24 * 60 * 60 * 1000)
    : null;

  const license = await License.create({
    key,
    expiry,
    features,
    maxActivations,
    hardwareIds: [],
    activationCount: 0,
    revoked: false,
  });

  return NextResponse.json({ success: true, license });
}
