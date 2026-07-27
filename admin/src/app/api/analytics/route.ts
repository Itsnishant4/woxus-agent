import { NextResponse } from "next/server";
import { connectDB } from "@/lib/mongodb/connection";
import { User } from "@/models/User";
import { License } from "@/models/License";
import { Feedback } from "@/models/Feedback";
import { Purchase } from "@/models/Purchase";
import { getSession } from "@/lib/auth";

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  await connectDB();

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const thisMonth = new Date(today.getFullYear(), today.getMonth(), 1);

  const [
    totalUsers,
    activeUsers,
    usersThisMonth,
    totalLicenses,
    activeLicenses,
    revokedLicenses,
    feedbackCounts,
    totalPurchases,
    completedPurchases,
    revenueResult,
    usersLast7Days,
    usersLast30Days,
  ] = await Promise.all([
    User.countDocuments(),
    User.countDocuments({ lastActiveAt: { $gte: new Date(Date.now() - 24 * 60 * 60 * 1000) } }),
    User.countDocuments({ createdAt: { $gte: thisMonth } }),
    License.countDocuments(),
    License.countDocuments({ revoked: false }),
    License.countDocuments({ revoked: true }),
    Feedback.aggregate([
      { $group: { _id: null, count: { $sum: 1 }, avg: { $avg: "$rating" } } },
    ]),
    Purchase.countDocuments(),
    Purchase.countDocuments({ status: "completed" }),
    Purchase.aggregate([
      { $match: { status: "completed" } },
      { $group: { _id: null, total: { $sum: "$amount" } } },
    ]),
    User.countDocuments({ createdAt: { $gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) } }),
    User.countDocuments({ createdAt: { $gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) } }),
  ]);

  const feedbackStats = feedbackCounts[0] || { count: 0, avg: 0 };
  const revenue = revenueResult[0]?.total || 0;

  return NextResponse.json({
    users: {
      total: totalUsers,
      active24h: activeUsers,
      newThisMonth: usersThisMonth,
      newLast7Days: usersLast7Days,
      newLast30Days: usersLast30Days,
    },
    licenses: {
      total: totalLicenses,
      active: activeLicenses,
      revoked: revokedLicenses,
    },
    feedback: {
      total: feedbackStats.count,
      avgRating: Math.round(feedbackStats.avg * 10) / 10,
    },
    purchases: {
      total: totalPurchases,
      completed: completedPurchases,
      revenue: Math.round(revenue * 100) / 100,
    },
  });
}
