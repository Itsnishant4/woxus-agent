import { NextRequest, NextResponse } from "next/server";
import { connectDB } from "@/lib/mongodb/connection";
import { User } from "@/models/User";
import { getSession } from "@/lib/auth";

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  await connectDB();
  const { searchParams } = new URL(req.url);
  const q = searchParams.get("q") || "";
  const page = parseInt(searchParams.get("page") || "1");
  const limit = parseInt(searchParams.get("limit") || "20");
  const skip = (page - 1) * limit;

  const filter: Record<string, unknown> = {};
  if (q) {
    filter.$or = [
      { hardwareId: { $regex: q, $options: "i" } },
      { deviceInfo: { $regex: q, $options: "i" } },
      { licenseKey: { $regex: q, $options: "i" } },
      { email: { $regex: q, $options: "i" } },
    ];
  }

  const [users, total] = await Promise.all([
    User.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
    User.countDocuments(filter),
  ]);

  return NextResponse.json({ users, total, page, pages: Math.ceil(total / limit) });
}

export async function PATCH(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  await connectDB();
  const { hardwareId, blocked, resetTrial } = await req.json();

  if (resetTrial) {
    // Restart trial clock with the CURRENT global duration so admin
    // setting changes apply to existing users too.
    const { Setting } = await import("@/models/Setting");
    const setting = await Setting.findOne({ key: "trial_duration_seconds" });
    const duration = setting ? parseInt(setting.value) : 600;
    const user = await User.findOneAndUpdate(
      { hardwareId },
      {
        trialActive: true,
        trialStartedAt: new Date(),
        trialDurationSeconds: duration,
        lastActiveAt: new Date(),
      },
      { new: true }
    );
    if (!user) return NextResponse.json({ error: "User not found" }, { status: 404 });
    return NextResponse.json({ success: true, user });
  }

  const user = await User.findOneAndUpdate(
    { hardwareId },
    { blocked, blockedAt: blocked ? new Date() : null },
    { new: true }
  );

  if (!user) return NextResponse.json({ error: "User not found" }, { status: 404 });
  return NextResponse.json({ success: true, user });
}
