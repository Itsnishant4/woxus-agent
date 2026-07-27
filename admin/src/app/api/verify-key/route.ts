import { NextRequest, NextResponse } from "next/server";
import { connectDB } from "@/lib/mongodb/connection";
import { License } from "@/models/License";
import { User } from "@/models/User";

export async function POST(req: NextRequest) {
  try {
    const { license_key, hardware_id } = await req.json();
    if (!license_key || !hardware_id) {
      return NextResponse.json(
        { valid: false, reason: "Missing license_key or hardware_id" },
        { status: 400 }
      );
    }

    await connectDB();
    const license = await License.findOne({ key: license_key });

    if (!license) {
      return NextResponse.json({ valid: false, reason: "Invalid license key" });
    }

    if (license.revoked) {
      return NextResponse.json({ valid: false, reason: "License key revoked" });
    }

    if (license.expiry && new Date(license.expiry) < new Date()) {
      return NextResponse.json({ valid: false, reason: "License key expired" });
    }

    if (!license.hardwareIds.includes(hardware_id)) {
      license.hardwareIds.push(hardware_id);
      license.activationCount = license.hardwareIds.length;
      await license.save();
    }

    await User.findOneAndUpdate(
      { hardwareId: hardware_id },
      { licenseKey: license_key, lastActiveAt: new Date() },
      { upsert: true }
    );

    return NextResponse.json({
      valid: true,
      expiry: license.expiry?.toISOString() || null,
      features: license.features,
    });
  } catch {
    return NextResponse.json({ valid: false, reason: "Invalid request" }, { status: 400 });
  }
}
