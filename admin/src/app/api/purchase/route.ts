import { NextRequest, NextResponse } from "next/server";
import { connectDB } from "@/lib/mongodb/connection";
import { Purchase } from "@/models/Purchase";
import { License } from "@/models/License";
import crypto from "crypto";

function generateKey(): string {
  const seg1 = crypto.randomBytes(4).toString("hex").toUpperCase();
  const seg2 = crypto.randomBytes(4).toString("hex").toUpperCase();
  const seg3 = crypto.randomBytes(4).toString("hex").toUpperCase();
  return `WOX-${seg1}-${seg2}-${seg3}`;
}

export async function GET() {
  await connectDB();
  const purchases = await Purchase.find().sort({ createdAt: -1 }).limit(50).lean();
  return NextResponse.json({ purchases });
}

export async function POST(req: NextRequest) {
  await connectDB();
  const body = await req.json();
  const { email, hardwareId, amount, currency } = body;

  if (!email || !amount) {
    return NextResponse.json({ error: "email and amount required" }, { status: 400 });
  }

  const licenseKey = generateKey();
  await License.create({
    key: licenseKey,
    hardwareId: hardwareId || null,
    hardwareIds: hardwareId ? [hardwareId] : [],
    expiry: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
    features: ["all"],
    maxActivations: 3,
  });

  const purchase = await Purchase.create({
    email,
    hardwareId,
    licenseKey,
    amount,
    currency: currency || "INR",
    provider: "razorpay",
    status: "completed",
  });

  return NextResponse.json({ success: true, purchase, licenseKey });
}
