import { NextResponse } from "next/server";
import { connectDB } from "@/lib/mongodb/connection";
import { Admin } from "@/models/Admin";
import { Setting } from "@/models/Setting";
import { hashPassword } from "@/lib/auth";

export async function POST() {
  await connectDB();

  const existing = await Admin.findOne({ username: "admin" });
  if (!existing) {
    await Admin.create({
      username: "admin",
      passwordHash: hashPassword(process.env.ADMIN_PASSWORD || "admin"),
      role: "superadmin",
    });
  }

  const existingSetting = await Setting.findOne({ key: "trial_duration_seconds" });
  if (!existingSetting) {
    await Setting.create({
      key: "trial_duration_seconds",
      value: "600",
      description: "Free trial duration in seconds. Admin-configurable.",
    });
  }

  return NextResponse.json({
    success: true,
    message: "Admin user and default settings seeded",
  });
}
