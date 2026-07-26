import { useState, useEffect } from 'react';
import { Card, CardContent } from '@heroui/react';
import { Brain, Search, Trash2, Star } from 'lucide-react';

interface Memory {
  id: string;
  category: string;
  content: string;
  importance: number;
  created_at: string;
}

const API = '/api';

export default function MemoryPage() {
  const [memories, setMemories] = useState<Memory[]>([]);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchMemories();
  }, []);

  async function fetchMemories() {
    try {
      const res = await fetch(`${API}/memory/`);
      const data = await res.json();
      setMemories(Array.isArray(data) ? data : []);
    } catch (e) {
      console.error('Failed to fetch memories', e);
    } finally {
      setLoading(false);
    }
  }

  async function searchMemories(q: string) {
    setQuery(q);
    if (!q.trim()) {
      fetchMemories();
      return;
    }
    try {
      const res = await fetch(`${API}/memory/search?q=${encodeURIComponent(q)}`);
      const data = await res.json();
      setMemories(Array.isArray(data) ? data : []);
    } catch (e) {
      console.error('Search failed', e);
    }
  }

  async function deleteMemory(id: string) {
    try {
      await fetch(`${API}/memory/${id}`, { method: 'DELETE' });
      setMemories(memories.filter(m => m.id !== id));
    } catch (e) {
      console.error('Delete failed', e);
    }
  }

  function starCount(imp: number) {
    const n = Math.round(imp * 5);
    return Array.from({ length: n }, (_, i) => i);
  }

  return (
    <div className="max-w-2xl mx-auto px-6 py-8 space-y-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Memory</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Facts Woxus remembers about you
        </p>
      </div>

      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <input
          type="text"
          value={query}
          onChange={e => searchMemories(e.target.value)}
          placeholder="Search memories..."
          className="w-full h-9 pl-9 pr-3 rounded-lg border border-border bg-background text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-primary/20"
        />
      </div>

      {loading ? (
        <p className="text-sm text-muted-foreground text-center py-10">Loading...</p>
      ) : memories.length === 0 ? (
        <div className="text-center py-16">
          <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center mx-auto mb-4">
            <Brain className="h-6 w-6 text-muted-foreground" />
          </div>
          <p className="text-sm text-muted-foreground">No memories yet</p>
          <p className="text-xs text-muted-foreground/60 mt-1">
            Woxus saves facts from your conversations automatically
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          <p className="text-xs text-muted-foreground/60 font-medium">
            {memories.length} memory{memories.length !== 1 ? 'ies' : 'y'} stored
          </p>
          {memories.map(m => (
            <Card key={m.id} className="border-border/60 shadow-sm">
              <CardContent className="p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-foreground">{m.content}</p>
                    <div className="flex items-center gap-2 mt-1.5">
                      <span className="text-[11px] text-muted-foreground/60 bg-muted px-1.5 py-0.5 rounded">
                        {m.category}
                      </span>
                      <div className="flex gap-0.5">
                        {starCount(m.importance).map(i => (
                          <Star key={i} className="h-3 w-3 fill-amber-400 text-amber-400" />
                        ))}
                      </div>
                    </div>
                  </div>
                  <button
                    onClick={() => deleteMemory(m.id)}
                    className="shrink-0 p-1 rounded hover:bg-accent text-muted-foreground hover:text-destructive transition-colors"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
