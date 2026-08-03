import { useState } from 'react';
import { X, Bug, ImagePlus, Loader2, Send, CheckCircle2 } from 'lucide-react';
import { API_BASE } from '@/services/api';

const MAX_IMAGE_BYTES = 2 * 1024 * 1024; // 2 MB

export default function ReportBugModal({ onClose }: { onClose: () => void }) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [image, setImage] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [sending, setSending] = useState(false);
  const [done, setDone] = useState(false);

  const handleImage = (file?: File) => {
    if (!file) return;
    if (file.size > MAX_IMAGE_BYTES) {
      setError('Screenshot must be under 2 MB');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => setImage(String(reader.result));
    reader.readAsDataURL(file);
  };

  const submit = async () => {
    if (!title.trim()) {
      setError('Please add a title');
      return;
    }
    setSending(true);
    setError('');
    try {
      // @ts-ignore
      const hwid = (await window.electronAPI?.getHardwareId?.()) || '';
      const payload: Record<string, unknown> = {
        title: title.trim(),
        description,
        image: image || '',
        hardware_id: hwid,
        app_version: window.navigator.userAgent || navigator.appVersion || '',
      };
      const res = await fetch(`${API_BASE}/bugs/`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d?.detail || 'Failed to submit bug report');
      }
      setDone(true);
    } catch (e: any) {
      setError(e.message || 'Failed to submit bug report');
    } finally {
      setSending(false);
    }
  };

  const inputCls =
    'w-full px-3 py-2 rounded-lg border border-border bg-muted/40 text-sm text-foreground placeholder:text-muted-foreground/60 focus:bg-card focus:border-ring focus:ring-2 focus:ring-ring/10 outline-none';
  const primaryCls =
    'inline-flex items-center justify-center gap-2 w-full px-4 py-2.5 rounded-lg bg-violet-600 hover:bg-violet-500 text-white text-sm font-medium transition-all disabled:opacity-50 disabled:cursor-not-allowed';

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md bg-card border border-border rounded-2xl shadow-2xl p-5 space-y-4 animate-in fade-in zoom-in-95 duration-200"
        onClick={(e) => e.stopPropagation()}
      >
        {done ? (
          <div className="py-6 space-y-3 text-center">
            <div className="w-12 h-12 mx-auto rounded-full bg-emerald-500/15 flex items-center justify-center text-emerald-500">
              <CheckCircle2 className="h-6 w-6" />
            </div>
            <h2 className="font-semibold text-foreground">Report submitted</h2>
            <p className="text-sm text-muted-foreground">Thanks! We'll take a look.</p>
            <button onClick={onClose} className={primaryCls}>
              Close
            </button>
          </div>
        ) : (
          <>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Bug className="h-5 w-5 text-violet-500" />
                <h2 className="font-semibold text-foreground">Report a Bug</h2>
              </div>
              <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="space-y-3">
              <input
                type="text"
                value={title}
                onChange={(e) => { setTitle(e.target.value); setError(''); }}
                placeholder="Short title"
                className={inputCls}
              />
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="What happened? (optional)"
                className={inputCls + ' h-20 resize-none'}
              />
            </div>

            <div>
              <label className="flex items-center gap-2 text-sm text-muted-foreground cursor-pointer">
                <ImagePlus className="h-4 w-4 text-violet-500" />
                <span>Add screenshot (max 2 MB)</span>
                <input
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => handleImage(e.target.files?.[0])}
                />
              </label>
              {image && (
                <img
                  src={image}
                  alt="screenshot"
                  onClick={() => setError('')}
                  className="mt-2 max-h-32 rounded-lg border border-border/60 object-cover"
                />
              )}
            </div>

            {error && <p className="text-xs text-destructive font-medium">{error}</p>}

            <button onClick={submit} disabled={sending} className={primaryCls}>
              {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              {sending ? 'Submitting…' : 'Submit'}
            </button>
          </>
        )}
      </div>
    </div>
  );
}