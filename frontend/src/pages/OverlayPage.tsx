import { useState, useRef, useEffect } from 'react';
import { Mic, Search, Loader2, Square } from 'lucide-react';
const API = 'http://127.0.0.1:8000/api';

export default function OverlayPage() {
  const [query, setQuery] = useState('');
  const [isRecording, setIsRecording] = useState(false);
  const [loading, setLoading] = useState(false);
  const [submittedQuery, setSubmittedQuery] = useState<string | null>(null);
  const [clarification, setClarification] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<BlobPart[]>([]);

  // Close overlay on Escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        // @ts-ignore
        if (window.electronAPI?.hideOverlay) {
          // @ts-ignore
          window.electronAPI.hideOverlay();
        }
      }
    };
    
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        setQuery('');
        setSubmittedQuery(null);
        setClarification(null);
        setLoading(false);
      } else {
        setTimeout(() => inputRef.current?.focus(), 100);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    document.addEventListener('visibilitychange', handleVisibilityChange);
    
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, []);

  useEffect(() => {
    // Focus the input when the component mounts
    inputRef.current?.focus();
  }, []);

  const submitQuery = async (text?: string, audioBase64?: string) => {
    if (!text?.trim() && !audioBase64) return;
    
    setSubmittedQuery(text?.trim() || "Audio input");
    setQuery('');
    setLoading(true);
    setClarification(null);
    try {
      const licenseKey = localStorage.getItem('woxus_license_key') || '';
      const hwid = await (window as any).electronAPI?.getHardwareId?.() || 'unknown';

      const res = await fetch(`${API}/overlay/clarify`, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'X-License-Key': licenseKey,
          'X-Hardware-Id': hwid
        },
        body: JSON.stringify({ content: text, audio: audioBase64 }),
      });
      const data = await res.json();
      if (!res.ok) {
        setClarification(data.detail || 'License or trial expired. Please check your Woxus license.');
      } else {
        setClarification(data.clarification);
      }
    } catch (err) {
      console.error(err);
      setClarification('Failed to generate a clarifying question.');
    } finally {
      setLoading(false);
    }
  };

  const toggleRecording = async () => {
    if (isRecording) {
      setIsRecording(false);
      mediaRecorderRef.current?.stop();
      return;
    }
    
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream, { mimeType: 'audio/webm' });
      mediaRecorderRef.current = mediaRecorder;
      audioChunksRef.current = [];

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      mediaRecorder.onstop = () => {
        stream.getTracks().forEach(track => track.stop());
        const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
        
        // Convert Blob to Base64
        const reader = new FileReader();
        reader.readAsDataURL(audioBlob);
        reader.onloadend = () => {
          const base64data = (reader.result as string).split(',')[1];
          submitQuery(undefined, base64data);
        };
      };

      mediaRecorder.start();
      setIsRecording(true);
    } catch (err) {
      console.error("Microphone access denied or error:", err);
      alert("Microphone access denied. Please check your system permissions.");
    }
  };

  return (
    <div className="flex flex-col items-center justify-start pt-8 p-4 h-full bg-transparent overflow-hidden pointer-events-none">
      <div className="w-full max-w-2xl bg-card/95 backdrop-blur-xl border border-border/50 rounded-2xl shadow-2xl overflow-hidden flex flex-col pointer-events-auto ring-1 ring-white/5">
        
        {/* Search Bar */}
        <div className="flex items-center gap-3 px-5 py-4">
          <Search className="h-5 w-5 text-violet-500/70 shrink-0" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') submitQuery(query);
            }}
            placeholder="Ask Woxus anything..."
            className="flex-1 bg-transparent text-lg text-foreground placeholder:text-muted-foreground/40 focus:outline-none"
          />
          <button
            onClick={toggleRecording}
            className={`p-2.5 rounded-full transition-all duration-200 ${
              isRecording 
                ? 'bg-red-500/20 text-red-500 animate-pulse ring-2 ring-red-500/50 ring-offset-1 ring-offset-transparent' 
                : 'hover:bg-accent text-muted-foreground hover:text-foreground'
            }`}
          >
            {isRecording ? <Square className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
          </button>
        </div>

        {/* Clarification Output Area */}
        {(loading || clarification || submittedQuery) && (
          <div className="px-5 py-4 bg-accent/20 text-sm border-t border-border/30 animate-in slide-in-from-top-1 fade-in duration-300">
            {submittedQuery && (
              <div className="flex items-center justify-end mb-3">
                <div className="bg-muted/40 text-muted-foreground px-3 py-1.5 rounded-lg text-xs max-w-[85%] truncate border border-border/30 shadow-sm">
                  {submittedQuery}
                </div>
              </div>
            )}
            
            {loading ? (
              <div className="flex items-center gap-3 text-muted-foreground font-medium">
                <Loader2 className="h-4 w-4 animate-spin text-violet-500" />
                <span>Woxus is thinking...</span>
              </div>
            ) : clarification ? (
              <div className="flex items-start gap-3 text-foreground/90 leading-relaxed">
                <div className="w-6 h-6 rounded-full bg-gradient-to-br from-violet-500 to-indigo-600 flex items-center justify-center shrink-0 shadow-sm mt-0.5">
                  <span className="text-[10px] font-bold text-white">W</span>
                </div>
                <div className="flex-1">{clarification}</div>
              </div>
            ) : null}
          </div>
        )}

      </div>
    </div>
  );
}
