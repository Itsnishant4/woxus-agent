import { NextRequest, NextResponse } from "next/server";
import { connectDB } from "@/lib/mongodb/connection";
import { Setting } from "@/models/Setting";
import { License } from "@/models/License";
import { getSession } from "@/lib/auth";

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
 *  - Otherwise it is LICENSE-GATED: only a device with a valid, non-revoked,
 *    non-expired license whose hardwareId is registered may read the pool.
 */
export async function GET(req: NextRequest) {
  await connectDB();

  const session = await getSession();
  if (session) {
    return NextResponse.json({ keys: await readKeyList() });
  }

  const license_key = req.nextUrl.searchParams.get("license_key");
  const hardware_id = req.nextUrl.searchParams.get("hardware_id");
  if (!license_key || !hardware_id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 401 });
  }

  const license = await License.findOne({ key: license_key });
  const valid =
    license &&
    !license.revoked &&
    (!license.expiry || new Date(license.expiry) >= new Date()) &&
    license.hardwareIds.includes(hardware_id);

  if (!valid) {
    return NextResponse.json({ error: "Forbidden" }, { status: 401 });
  }

  return NextResponse.json({ keys: await readKeyList() });
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