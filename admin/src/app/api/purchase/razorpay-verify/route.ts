import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { connectDB } from "@/lib/mongodb/connection";
import { Purchase } from "@/models/Purchase";
import { License } from "@/models/License";

function generateKey(): string {
  const seg1 = crypto.randomBytes(4).toString("hex").toUpperCase();
  const seg2 = crypto.randomBytes(4).toString("hex").toUpperCase();
  const seg3 = crypto.randomBytes(4).toString("hex").toUpperCase();
  return `WOX-${seg1}-${seg2}-${seg3}`;
}

export async function POST(req: NextRequest) {
  const { razorpay_order_id, razorpay_payment_id, razorpay_signature, email, hardwareId } = await req.json();

  const body = razorpay_order_id + "|" + razorpay_payment_id;
  const expectedSig = crypto
    .createHmac("sha256", process.env.RAZORPAY_KEY_SECRET || "")
    .update(body)
    .digest("hex");

  if (expectedSig !== razorpay_signature) {
    return NextResponse.json({ success: false, error: "Invalid signature" }, { status: 400 });
  }

  await connectDB();

  const licenseKey = generateKey();
  await License.create({
    key: licenseKey,
    hardwareId: hardwareId || null,
    hardwareIds: hardwareId ? [hardwareId] : [],
    expiry: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
    features: ["all"],
    maxActivations: 3,
  });

  await Purchase.findOneAndUpdate(
    { razorpayOrderId: razorpay_order_id },
    {
      status: "completed",
      providerTxId: razorpay_payment_id,
      licenseKey,
    }
  );

  return NextResponse.json({ success: true, licenseKey });
}
