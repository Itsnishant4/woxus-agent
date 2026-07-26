import { NextRequest, NextResponse } from "next/server";

interface VerifyRequest {
  license_key: string;
  hardware_id: string;
}

interface LicenseRecord {
  key: string;
  expiry: string | null;
  features: string[];
  hardware_ids: string[];
  revoked: boolean;
}

// In-memory store for scaffold — replace with DB in Phase 7
const LICENSES: LicenseRecord[] = [];

export async function POST(req: NextRequest) {
  try {
    const body: VerifyRequest = await req.json();
    const { license_key, hardware_id } = body;

    if (!license_key || !hardware_id) {
      return NextResponse.json(
        { valid: false, reason: "Missing license_key or hardware_id" },
        { status: 400 }
      );
    }

    const license = LICENSES.find((l) => l.key === license_key);

    if (!license) {
      return NextResponse.json({ valid: false, reason: "Invalid license key" });
    }

    if (license.revoked) {
      return NextResponse.json({ valid: false, reason: "License key revoked" });
    }

    if (license.expiry && new Date(license.expiry) < new Date()) {
      return NextResponse.json({ valid: false, reason: "License key expired" });
    }

    if (!license.hardware_ids.includes(hardware_id)) {
      license.hardware_ids.push(hardware_id);
    }

    return NextResponse.json({
      valid: true,
      expiry: license.expiry,
      features: license.features,
    });
  } catch {
    return NextResponse.json(
      { valid: false, reason: "Invalid request" },
      { status: 400 }
    );
  }
}
