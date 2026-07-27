import { NextResponse } from "next/server";
import { connectDB } from "@/lib/mongodb/connection";
import { Setting } from "@/models/Setting";

const DEFAULTS: Record<string, string> = {
  price_monthly: "9.99",
  price_yearly: "99.99",
  currency: "INR",
};

export async function GET() {
  await connectDB();
  const pricing: Record<string, string> = {};

  for (const [key, defaultVal] of Object.entries(DEFAULTS)) {
    const setting = await Setting.findOne({ key });
    pricing[key] = setting?.value || defaultVal;
  }

  return NextResponse.json({ pricing, plans: [
    { id: "monthly", label: "Monthly", price: parseFloat(pricing.price_monthly), currency: pricing.currency, period: "month" },
    { id: "yearly", label: "Yearly", price: parseFloat(pricing.price_yearly), currency: pricing.currency, period: "year", popular: true },
  ]});
}
