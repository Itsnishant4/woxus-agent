import { useState, useEffect } from 'react';
import { API_BASE } from '@/services/api';

const MODEL_STATUS_URL = `${API_BASE}/model/status`;
const MODEL_DOWNLOAD_URL = `${API_BASE}/model/download`;

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
        const res = await window.fetch(MODEL_STATUS_URL);
        const data = await res.json();
        setStatus(data);

        if (data.installed) {
          onComplete();
          return;
        }

        if (!data.downloading) {
          await window.fetch(MODEL_DOWNLOAD_URL, { method: 'POST' });
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-950 text-white">
      <div className="w-full max-w-sm px-6 space-y-8 text-center">

        <div className="space-y-1">
          <h1 className="text-base font-medium tracking-tight">Setting up your Mini Agent</h1>
          <p className="text-xs text-zinc-500">One-time download. Runs fully on your device.</p>
        </div>

        <div className="space-y-2.5">
          <div className="w-full h-1 bg-zinc-800 rounded-full overflow-hidden">
            <div
              className="h-full bg-zinc-100 rounded-full transition-all duration-500"
              style={{ width: `${progress}%` }}
            />
          </div>
          <div className="flex justify-between text-[11px]  text-zinc-500">
            <span>{mbDownloaded} / {mbTotal} MB</span>
            <span>{progress.toFixed(0)}%</span>
          </div>
        </div>

        <p className="text-[11px] text-zinc-600 truncate">{status?.status_text || 'Preparing download…'}</p>
      </div>
    </div>
  );
}
