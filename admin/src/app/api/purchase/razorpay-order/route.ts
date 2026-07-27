import { NextRequest, NextResponse } from "next/server";
import Razorpay from "razorpay";
import { connectDB } from "@/lib/mongodb/connection";
import { Purchase } from "@/models/Purchase";

const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID || "",
  key_secret: process.env.RAZORPAY_KEY_SECRET || "",
});

export async function POST(req: NextRequest) {
  const { email, hardwareId, amountInPaise } = await req.json();

  if (!email || !amountInPaise) {
    return NextResponse.json({ error: "email and amountInPaise required" }, { status: 400 });
  }

  await connectDB();

  const order = await razorpay.orders.create({
    amount: amountInPaise,
    currency: "INR",
    receipt: `wox_${Date.now()}`,
    notes: { email, hardwareId: hardwareId || "" },
  });

  await Purchase.create({
    email,
    hardwareId: hardwareId || null,
    amount: amountInPaise / 100,
    currency: "INR",
    provider: "razorpay",
    razorpayOrderId: order.id,
    status: "pending",
  });

  return NextResponse.json({
    orderId: order.id,
    amount: order.amount,
    currency: order.currency,
    keyId: process.env.RAZORPAY_KEY_ID,
  });
}
