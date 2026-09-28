import { NextRequest, NextResponse } from "next/server";
import { connectDB } from "@/lib/mongodb/connection";
import { Setting } from "@/models/Setting";
import { getSession } from "@/lib/auth";

const DEFAULTS: Record<string, string> = {
  trial_duration_seconds: "600",
  price_monthly: "9.99",
  price_yearly: "99.99",
  currency: "INR",
};

const DESCRIPTIONS: Record<string, string> = {
  trial_duration_seconds: "Free trial duration in seconds",
  price_monthly: "Monthly subscription price",
  price_yearly: "Yearly subscription price (12 months for price of ~10)",
  currency: "Currency code (INR, USD, etc.)",
};

const VALIDATORS: Record<string, (v: string) => string | null> = {
  trial_duration_seconds: (v) => {
    const n = parseInt(v);
    if (isNaN(n) || n < 60) return "Must be at least 60 seconds (no maximum)";
    return null;
  },
  price_monthly: (v) => {
    const n = parseFloat(v);
    if (isNaN(n) || n <= 0) return "Must be a positive number";
    return null;
  },
  price_yearly: (v) => {
    const n = parseFloat(v);
    if (isNaN(n) || n <= 0) return "Must be a positive number";
    return null;
  },
  currency: (v) => {
    if (!/^[A-Z]{3}$/.test(v)) return "Must be 3-letter currency code (e.g. INR, USD)";
    return null;
  },
};

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  await connectDB();
  const settings: Record<string, string> = {};

  for (const [key, defaultVal] of Object.entries(DEFAULTS)) {
    let setting = await Setting.findOne({ key });
    if (!setting) {
      setting = await Setting.create({
        key,
        value: defaultVal,
        description: DESCRIPTIONS[key] || "",
      });
    }
    settings[key] = setting.value;
  }

  return NextResponse.json({ settings });
}

export async function PUT(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  await connectDB();
  const body = await req.json();
  const errors: Record<string, string> = {};

  for (const [key, value] of Object.entries(body)) {
    if (!(key in DEFAULTS)) {
      errors[key] = `Unknown setting key`;
      continue;
    }
    const validator = VALIDATORS[key];
    if (validator) {
      const err = validator(value as string);
      if (err) {
        errors[key] = err;
        continue;
      }
    }
    await Setting.findOneAndUpdate(
      { key },
      { value: String(value), description: DESCRIPTIONS[key] || "" },
      { upsert: true }
    );
  }

  if (Object.keys(errors).length > 0) {
    return NextResponse.json({ success: false, errors }, { status: 400 });
  }

  return NextResponse.json({ success: true });
}
