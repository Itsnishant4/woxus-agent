import { NextRequest, NextResponse } from "next/server";
import { connectDB } from "@/lib/mongodb/connection";
import { Feedback } from "@/models/Feedback";
import { getSession } from "@/lib/auth";

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  await connectDB();
  const { searchParams } = new URL(req.url);
  const page = parseInt(searchParams.get("page") || "1");
  const limit = parseInt(searchParams.get("limit") || "20");
  const skip = (page - 1) * limit;
  const minRating = parseInt(searchParams.get("minRating") || "0");

  const filter: Record<string, unknown> = {};
  if (minRating > 0) filter.rating = { $gte: minRating };

  const [feedback, total, ratingDist] = await Promise.all([
    Feedback.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
    Feedback.countDocuments(filter),
    Feedback.aggregate([
      { $group: { _id: "$rating", count: { $sum: 1 } } },
      { $sort: { _id: 1 } },
    ]),
  ]);

  const distribution: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  ratingDist.forEach((r: { _id: number; count: number }) => {
    distribution[r._id] = r.count;
  });

  const avgRating = feedback.length
    ? feedback.reduce((s: number, f: Record<string, unknown>) => s + (f.rating as number), 0) / feedback.length
    : 0;

  return NextResponse.json({
    feedback,
    total,
    page,
    pages: Math.ceil(total / limit),
    avgRating: Math.round(avgRating * 10) / 10,
    distribution,
  });
}
