import { NextRequest, NextResponse } from "next/server";
import { connectDB } from "@/lib/mongodb/connection";
import { License } from "@/models/License";
import { getSession } from "@/lib/auth";

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  await connectDB();
  const { key, revoked } = await req.json();

  const license = await License.findOneAndUpdate(
    { key },
    { revoked, revokedAt: revoked ? new Date() : null },
    { new: true }
  );

  if (!license) return NextResponse.json({ error: "License not found" }, { status: 404 });
  return NextResponse.json({ success: true, license });
}
