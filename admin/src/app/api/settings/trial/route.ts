import { NextRequest, NextResponse } from "next/server";
import { connectDB } from "@/lib/mongodb/connection";
import { Setting } from "@/models/Setting";
import { getSession } from "@/lib/auth";

const TRIAL_KEY = "trial_duration_seconds";

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  await connectDB();
  let setting = await Setting.findOne({ key: TRIAL_KEY });
  if (!setting) {
    setting = await Setting.create({
      key: TRIAL_KEY,
      value: "600",
      description: "Free trial duration in seconds. Admin-configurable.",
    });
  }

  return NextResponse.json({
    trialDurationSeconds: parseInt(setting.value),
    description: setting.description,
  });
}

export async function PUT(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  await connectDB();
  const { trialDurationSeconds } = await req.json();

  if (!trialDurationSeconds || trialDurationSeconds < 60 || trialDurationSeconds > 86400) {
    return NextResponse.json(
      { error: "Duration must be between 60 and 86400 seconds" },
      { status: 400 }
    );
  }

  await Setting.findOneAndUpdate(
    { key: TRIAL_KEY },
    { value: String(trialDurationSeconds) },
    { upsert: true }
  );

  return NextResponse.json({ success: true, trialDurationSeconds });
}
