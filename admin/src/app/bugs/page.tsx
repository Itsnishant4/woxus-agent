"use client";

import { useEffect, useState } from "react";
import { Card, CardContent } from "@heroui/react";
import { TableSkeleton, EmptyState, Spinner } from "@/components/ui";
import { IconBug } from "@/components/icons";

interface BugItem {
  _id: string;
  title: string;
  description?: string;
  image?: string;
  hardwareId?: string;
  appVersion?: string;
  createdAt: string;
}

export default function BugsPage() {
  const [bugs, setBugs] = useState<BugItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [preview, setPreview] = useState<BugItem | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`/api/bugs?page=${page}&limit=20`)
      .then((r) => r.json())
      .then((d) => {
        setBugs(d.bugs || []);
        setTotal(d.total || 0);
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [page]);

  const pages = Math.ceil(total / 20);
  const fmt = (s: string) => (s ? new Date(s).toLocaleString() : "");

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-foreground">Bug Reports</h1>
        <p className="text-sm text-muted-foreground mt-1">{total} reports</p>
      </div>

      <Card className="border-border/60 shadow-sm">
        <CardContent className="p-0 overflow-x-auto">
          {loading ? (
            <TableSkeleton rows={5} cols={5} />
          ) : (
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-muted-foreground border-b border-border/60">
                <tr>
                  <th className="px-4 py-3">Title</th>
                  <th className="px-4 py-3">Description</th>
                  <th className="px-4 py-3">Screenshot</th>
                  <th className="px-4 py-3">Version</th>
                  <th className="px-4 py-3">Submitted</th>
                </tr>
              </thead>
              <tbody>
                {bugs.map((b) => (
                  <tr key={b._id} className="border-b border-border/40 align-top">
                    <td className="px-4 py-3 font-medium">{b.title}</td>
                    <td className="px-4 py-3 text-muted-foreground max-w-[280px] break-words">{b.description || "—"}</td>
                    <td className="px-4 py-3">
                      {b.image ? (
                        <button onClick={() => setPreview(b)} title="Click to enlarge" className="block">
                          <img
                            src={b.image}
                            alt={b.title}
                            className="h-14 w-20 object-cover rounded border border-border/60 cursor-zoom-in"
                          />
                        </button>
                      ) : (
                        <span className="text-xs text-muted-foreground/50">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-xs">{b.appVersion || "—"}</td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">{fmt(b.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {!loading && bugs.length === 0 && (
            <EmptyState icon={<IconBug />} title="No bug reports yet" sub="Reports from users will appear here." />
          )}
        </CardContent>
      </Card>

      {pages > 1 && (
        <div className="flex items-center gap-3 justify-end">
          <button
            disabled={page <= 1}
            onClick={() => { setLoading(true); setPage(page - 1); }}
            className="px-3 py-1.5 rounded-md text-sm bg-zinc-800 hover:bg-zinc-700 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Prev
          </button>
          <span className="flex items-center gap-2 text-sm text-muted-foreground">
            {page} / {pages}
            {loading && <Spinner className="h-3 w-3" />}
          </span>
          <button
            disabled={page >= pages}
            onClick={() => { setLoading(true); setPage(page + 1); }}
            className="px-3 py-1.5 rounded-md text-sm bg-zinc-800 hover:bg-zinc-700 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Next
          </button>
        </div>
      )}

      {preview && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-6"
          onClick={() => setPreview(null)}
        >
          <div
            className="relative max-w-4xl w-full bg-zinc-900 border border-zinc-700 rounded-xl p-4"
            onClick={(e) => e.stopPropagation()}
          >
            <img
              src={preview.image}
              alt={preview.title}
              className="w-full max-h-[80vh] object-contain rounded-lg"
            />
            <div className="mt-3 flex items-start justify-between gap-4">
              <div>
                <p className="text-white font-medium">{preview.title}</p>
                {preview.description && (
                  <p className="text-sm text-zinc-400 mt-1">{preview.description}</p>
                )}
              </div>
              <button
                onClick={() => setPreview(null)}
                className="shrink-0 w-8 h-8 rounded-full bg-white text-black font-bold"
              >
                ✕
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
