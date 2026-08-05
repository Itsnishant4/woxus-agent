import { NextRequest, NextResponse } from "next/server";
import { connectDB } from "@/lib/mongodb/connection";
import { Setting } from "@/models/Setting";
import { License } from "@/models/License";
import { getSession } from "@/lib/auth";

import { User } from "@/models/User";

async function readKeyList() {
  const setting = await Setting.findOne({ key: "gemini_api_keys" });
  return (String(setting?.value ?? "")
    .split("\n")
    .map((k: string) => k.trim())
    .filter(Boolean));
}

/**
 * GET /api/gemini-keys
 * Returns the admin-managed Gemini key pool (rotation list).
 *  - An authenticated admin session can always read it (dashboard UI).
 *  - Devices with a valid license key or non-blocked hardware ID can read the pool.
 */
export async function GET(req: NextRequest) {
  await connectDB();

  const session = await getSession();
  if (session) {
    return NextResponse.json({ keys: await readKeyList() });
  }

  const license_key = req.nextUrl.searchParams.get("license_key")?.trim() || "";
  const hardware_id = req.nextUrl.searchParams.get("hardware_id")?.trim() || "";

  if (!license_key && !hardware_id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 401 });
  }

  if (license_key) {
    const license = await License.findOne({ key: license_key });
    const isValidLicense =
      license &&
      !license.revoked &&
      (!license.expiry || new Date(license.expiry) >= new Date());

    if (isValidLicense) {
      if (hardware_id && !license.hardwareIds.includes(hardware_id)) {
        license.hardwareIds.push(hardware_id);
        license.activationCount = license.hardwareIds.length;
        await license.save();
      }
      return NextResponse.json({ keys: await readKeyList() });
    }
  }

  if (hardware_id) {
    const user = await User.findOne({ hardwareId: hardware_id });
    if (user && user.blocked) {
      return NextResponse.json({ error: "Forbidden" }, { status: 401 });
    }
    return NextResponse.json({ keys: await readKeyList() });
  }

  return NextResponse.json({ error: "Forbidden" }, { status: 401 });
}

/**
 * POST /api/gemini-keys
 * Admin only. Replaces the whole key pool with the given keys (one per item).
 * Set to an empty array to clear the pool (app then falls back to baked-in keys).
 */
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const raw = body.keys;
  if (!Array.isArray(raw)) {
    return NextResponse.json({ error: "`keys` must be an array" }, { status: 400 });
  }

  const clean = raw.map((k) => String(k).trim()).filter(Boolean);
  await connectDB();
  await Setting.findOneAndUpdate(
    { key: "gemini_api_keys" },
    {
      value: clean.join("\n"),
      description: "Gemini Live API keys — one per line, used as the rotation pool",
    },
    { upsert: true }
  );

  return NextResponse.json({ success: true, count: clean.length });
}