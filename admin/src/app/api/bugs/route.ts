import { NextRequest, NextResponse } from "next/server";
import { connectDB } from "@/lib/mongodb/connection";
import { BugReport } from "@/models/BugReport";
import { getSession } from "@/lib/auth";

// Open intake endpoint: the desktop app posts bug reports here (no admin
// session available in the packaged app). Listing stays admin-only.
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    if (!body?.title || !String(body.title).trim()) {
      return NextResponse.json({ error: "title required" }, { status: 400 });
    }
    await connectDB();
    const doc = await BugReport.create({
      title: String(body.title).trim(),
      description: body.description || "",
      image: body.image || "",
      hardwareId: body.hardware_id || body.hardwareId || "",
      appVersion: body.app_version || body.appVersion || "",
    });
    return NextResponse.json({ status: "submitted", id: String(doc._id) });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  await connectDB();
  const { searchParams } = new URL(req.url);
  const page = parseInt(searchParams.get("page") || "1");
  const limit = parseInt(searchParams.get("limit") || "20");
  const skip = (page - 1) * limit;

  const [bugs, total] = await Promise.all([
    BugReport.find({}).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
    BugReport.countDocuments({}),
  ]);

  return NextResponse.json({ bugs, total, page, pages: Math.ceil(total / limit) });
}
