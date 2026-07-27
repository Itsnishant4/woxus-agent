import { NextRequest, NextResponse } from "next/server";
import { connectDB } from "@/lib/mongodb/connection";
import { License } from "@/models/License";
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
      { key: { $regex: q, $options: "i" } },
      { hardwareId: { $regex: q, $options: "i" } },
    ];
  }

  const [licenses, total] = await Promise.all([
    License.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
    License.countDocuments(filter),
  ]);

  return NextResponse.json({ licenses, total, page, pages: Math.ceil(total / limit) });
}
