import { useState, useEffect } from 'react';
import { Download } from 'lucide-react';
import { API_BASE } from '@/services/api';

interface ModelStatus {
  model_name: string;
  installed: boolean;
  downloading: boolean;
  progress: number;
  bytes_downloaded: number;
  total_bytes: number;
  status_text: string;
}

export default function ModelDownloadBanner() {
  const [status, setStatus] = useState<ModelStatus | null>(null);

  useEffect(() => {
    const fetchStatus = async () => {
      try {
        const res = await window.fetch(`${API_BASE}/model/status`);
        const data = await res.json();
        setStatus(data);

        // Auto-trigger download if not installed and not downloading
        if (!data.installed && !data.downloading) {
          await window.fetch(`${API_BASE}/model/download`, { method: 'POST' });
        }
        if (data.installed) {
          clearInterval(interval);
        }
      } catch {
        /* ignore */
      }
    };

    fetchStatus();
    const interval = setInterval(fetchStatus, 3000);
    return () => clearInterval(interval);
  }, []);

  if (!status) return null;

  if (status.downloading) {
    const mbDownloaded = ((status.bytes_downloaded || 0) / (1024 * 1024)).toFixed(1);
    const mbTotal = ((status.total_bytes || 253 * 1024 * 1024) / (1024 * 1024)).toFixed(1);

    return (
      <div className="mx-6 mt-4 p-4 rounded-xl bg-white border border-zinc-200/90 shadow-sm animate-fade-in">
        <div className="flex items-center justify-between gap-3 mb-2">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-indigo-50 border border-indigo-100 flex items-center justify-center text-indigo-600 shrink-0">
              <Download className="h-4 w-4 animate-bounce" />
            </div>
            <div>
              <h3 className="text-xs font-semibold text-zinc-900 flex items-center gap-1.5">
                <span>Downloading Local Mini Agent</span>
              </h3>
              <p className="text-[11px] text-zinc-500 font-medium">
                {mbDownloaded} MB / {mbTotal} MB ({(status.progress || 0).toFixed(0)}%)
              </p>
            </div>
          </div>
          <span className="text-xs font-mono font-bold text-indigo-600">
            {(status.progress || 0).toFixed(0)}%
          </span>
        </div>

        <div className="w-full bg-zinc-100 rounded-full h-2 overflow-hidden border border-zinc-200/60">
          <div
            className="h-full bg-gradient-to-r from-indigo-500 to-violet-600 rounded-full transition-all duration-500"
            style={{ width: `${status.progress || 0}%` }}
          />
        </div>
      </div>
    );
  }

  if (status.installed) {
    return null;
  }

  return null;
}
