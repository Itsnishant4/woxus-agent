import { useState, useEffect } from 'react';
import { Download, Sparkles } from 'lucide-react';

interface ModelStatus {
  model_name: string;
  installed: boolean;
  downloading: boolean;
  progress: number;
  bytes_downloaded: number;
  total_bytes: number;
  status_text: string;
  error?: string | null;
}

interface Props {
  onComplete: () => void;
}

export default function ModelDownloadScreen({ onComplete }: Props) {
  const [status, setStatus] = useState<ModelStatus | null>(null);

  useEffect(() => {
    const checkAndDownload = async () => {
      try {
        const res = await window.fetch('/api/model/status');
        const data = await res.json();
        setStatus(data);

        if (data.installed) {
          onComplete();
          return;
        }

        if (!data.downloading) {
          await window.fetch('/api/model/download', { method: 'POST' });
        }
      } catch {
        /* ignore */
      }
    };

    checkAndDownload();
    const interval = setInterval(checkAndDownload, 1000);
    return () => clearInterval(interval);
  }, [onComplete]);

  const bytesDown = typeof status?.bytes_downloaded === 'number' ? status.bytes_downloaded : 0;
  const bytesTotal = typeof status?.total_bytes === 'number' ? status.total_bytes : 253 * 1024 * 1024;
  const mbDownloaded = (bytesDown / (1024 * 1024)).toFixed(1);
  const mbTotal = (bytesTotal / (1024 * 1024)).toFixed(1);
  const progress = typeof status?.progress === 'number' ? status.progress : 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-950 text-white selection:bg-indigo-500/20">
      <div className="w-full max-w-md p-8 rounded-2xl bg-zinc-900 border border-zinc-800 shadow-2xl space-y-6">
        <div className="flex flex-col items-center text-center space-y-3">
          <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-indigo-500 to-violet-600 flex items-center justify-center shadow-lg shadow-indigo-500/20">
            <Sparkles className="h-7 w-7 text-white" />
          </div>
          <div>
            <h1 className="text-xl font-bold tracking-tight">Initial Setup Required</h1>
            <p className="text-sm text-zinc-400 mt-1">
              Downloading <span className="text-white font-semibold">Local Mini Agent</span> model to power your device.
            </p>
          </div>
        </div>

        <div className="space-y-3 bg-zinc-950/60 p-4 rounded-xl border border-zinc-800/80">
          <div className="flex items-center justify-between text-xs">
            <span className="text-zinc-400 flex items-center gap-1.5 font-medium truncate">
              <Download className="h-3.5 w-3.5 text-indigo-400 animate-bounce shrink-0" />
              <span className="truncate">{status?.status_text || 'Preparing download...'}</span>
            </span>
            <span className="font-mono font-bold text-indigo-400 shrink-0 ml-2">{progress.toFixed(0)}%</span>
          </div>

          <div className="w-full bg-zinc-800 rounded-full h-2.5 overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-indigo-500 to-violet-500 rounded-full transition-all duration-500"
              style={{ width: `${progress}%` }}
            />
          </div>

          <div className="flex justify-between items-center text-[11px] text-zinc-500 font-mono">
            <span>{mbDownloaded} MB / {mbTotal} MB</span>
            <span>Local Mini Agent Model</span>
          </div>
        </div>

        <div className="p-3 rounded-lg bg-zinc-800/40 border border-zinc-800 text-center text-xs text-zinc-400">
          🔒 Woxus requires the Local Mini Agent installed before you can access the app.
        </div>
      </div>
    </div>
  );
}
