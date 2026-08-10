import { NextResponse } from "next/server";
import { connectDB } from "@/lib/mongodb/connection";
import { Setting } from "@/models/Setting";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await connectDB();
    const setting = await Setting.findOne({ key: "trial_duration_seconds" });
    
    return NextResponse.json({
      trial_duration_seconds: setting ? parseInt(setting.value) : 600
    });
  } catch (error) {
    console.error("Failed to fetch public config:", error);
    return NextResponse.json({ trial_duration_seconds: 600 });
  }
}
