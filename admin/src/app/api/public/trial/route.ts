import { NextRequest, NextResponse } from "next/server";
import { connectDB } from "@/lib/mongodb/connection";
import { User } from "@/models/User";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    await connectDB();
    const { hardwareId, email, deviceInfo, trialDurationSeconds } = await req.json();

    if (!hardwareId) {
      return NextResponse.json({ error: "hardwareId required" }, { status: 400 });
    }

    let existing = await User.findOne({ hardwareId });
    if (!existing && email) {
      existing = await User.findOne({ email });
    }

    if (existing) {
      return NextResponse.json({
        exists: true,
        active: existing.trialActive || false,
        total_seconds: existing.trialDurationSeconds || 600,
        trial_started_at: existing.trialStartedAt || null,
        email: existing.email || "",
      });
    }

    // Upsert
    await User.findOneAndUpdate(
      { hardwareId },
      {
        $set: {
          hardwareId,
          email: email || "",
          deviceInfo: deviceInfo || "",
          trialActive: true,
          trialStartedAt: new Date().toISOString(),
          trialDurationSeconds: trialDurationSeconds || 600,
          lastActiveAt: new Date().toISOString(),
        }
      },
      { upsert: true, new: true }
    );

    return NextResponse.json({
      exists: false,
      active: true,
      total_seconds: trialDurationSeconds || 600,
      email: email || "",
    });
  } catch (error) {
    console.error("Trial public API error:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
