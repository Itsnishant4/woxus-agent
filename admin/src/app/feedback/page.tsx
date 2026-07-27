"use client";

import { useEffect, useState } from "react";
import { Card, CardContent } from "@heroui/react";

interface FeedbackItem {
  _id: string;
  rating: number;
  text?: string;
  hardwareId?: string;
  createdAt: string;
}

export default function FeedbackPage() {
  const [feedback, setFeedback] = useState<FeedbackItem[]>([]);
  const [total, setTotal] = useState(0);
  const [avgRating, setAvgRating] = useState(0);
  const [distribution, setDistribution] = useState<Record<number, number>>({ 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 });
  const [page, setPage] = useState(1);
  const [minRating, setMinRating] = useState("0");

  useEffect(() => {
    const params = new URLSearchParams({ page: String(page), limit: "20" });
    if (minRating !== "0") params.set("minRating", minRating);
    fetch(`/api/feedback?${params}`)
      .then((r) => r.json())
      .then((data) => {
        setFeedback(data.feedback);
        setTotal(data.total);
        setAvgRating(data.avgRating);
        setDistribution(data.distribution);
      })
      .catch(console.error);
  }, [page, minRating]);

  const pages = Math.ceil(total / 20);

  const stars = (n: number) => "★".repeat(n) + "☆".repeat(5 - n);

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-foreground">Feedback</h1>
        <p className="text-sm text-muted-foreground mt-1">{total} submissions · Avg {avgRating}/5</p>
      </div>

      <div className="grid grid-cols-5 gap-2">
        {[1, 2, 3, 4, 5].map((r) => (
          <Card key={r} className={`border-border/60 shadow-sm ${minRating === String(r) ? "ring-2 ring-violet-500" : ""}`}>
            <CardContent className="py-3 text-center cursor-pointer" onClick={() => setMinRating(minRating === String(r) ? "0" : String(r))}>
              <p className="text-lg">{stars(r)}</p>
              <p className="text-xs text-muted-foreground mt-1">{distribution[r] || 0}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card className="border-border/60 shadow-sm">
        <CardContent className="p-0 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs text-muted-foreground">
                <th className="px-4 py-3 font-medium">RATING</th>
                <th className="px-4 py-3 font-medium">TEXT</th>
                <th className="px-4 py-3 font-medium">HARDWARE ID</th>
                <th className="px-4 py-3 font-medium">DATE</th>
              </tr>
            </thead>
            <tbody>
              {feedback.length === 0 && (
                <tr><td colSpan={4} className="px-4 py-10 text-center text-muted-foreground">No feedback</td></tr>
              )}
              {feedback.map((f) => (
                <tr key={f._id} className="border-b border-border/50 hover:bg-accent/30">
                  <td className="px-4 py-3 text-amber-500">{stars(f.rating)}</td>
                  <td className="px-4 py-3 text-xs text-foreground max-w-xs">{f.text || "—"}</td>
                  <td className="px-4 py-3 text-xs text-muted-foreground"><code>{f.hardwareId?.slice(0, 16) || "—"}</code></td>
                  <td className="px-4 py-3 text-xs text-muted-foreground">{new Date(f.createdAt).toLocaleDateString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>

      {pages > 1 && (
        <div className="flex gap-2 items-center text-sm text-muted-foreground">
          <button disabled={page <= 1} onClick={() => setPage((p) => p - 1)} className="px-3 py-1 rounded-md bg-accent/50 hover:bg-accent disabled:opacity-40">Prev</button>
          <span>Page {page} of {pages}</span>
          <button disabled={page >= pages} onClick={() => setPage((p) => p + 1)} className="px-3 py-1 rounded-md bg-accent/50 hover:bg-accent disabled:opacity-40">Next</button>
        </div>
      )}
    </div>
  );
}
