import { useEffect, useRef, useState } from 'react';
import { useVoiceStore } from '../store/voice';

export default function OrbPage() {
  const [level, setLevel] = useState(0);
  const [micOn, setMicOn] = useState(false);
  const rafRef = useRef<number>(0);
  const streamRef = useRef<MediaStream | null>(null);

  // Only open the mic when the main agent voice session is running
  const connected = useVoiceStore((s) => s.connected);

  useEffect(() => {
    let audioCtx: AudioContext | null = null;
    let analyser: AnalyserNode | null = null;

    const tick = () => {
      if (analyser) {
        const data = new Uint8Array(512);
        analyser.getByteTimeDomainData(data);
        let sum = 0;
        for (let i = 0; i < data.length; i++) {
          const v = (data[i] - 128) / 128;
          sum += v * v;
        }
        const rms = Math.sqrt(sum / data.length);
        const scaled = Math.min(1, rms * 8);
        setLevel((prev) => prev + (scaled - prev) * 0.35);
      }
      rafRef.current = requestAnimationFrame(tick);
    };

    if (!connected) {
      cancelAnimationFrame(rafRef.current);
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
      setMicOn(false);
      setLevel(0);
      return;
    }

    let cancelled = false;
    const setupMic = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        audioCtx = new AudioContext();
        const source = audioCtx.createMediaStreamSource(stream);
        analyser = audioCtx.createAnalyser();
        analyser.fftSize = 512;
        analyser.smoothingTimeConstant = 0.6;
        source.connect(analyser);
        setMicOn(true);
        tick();
      } catch {
        setMicOn(false);
      }
    };

    setupMic();
    return () => {
      cancelled = true;
      cancelAnimationFrame(rafRef.current);
      audioCtx?.close();
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
      setMicOn(false);
    };
  }, [connected]);

  const toggleMainWindow = () => {
    // @ts-ignore
    window.electronAPI?.toggleMainWindow?.();
  };

  const talking = level > 0.08;
  const scale = 0.7 + level * (talking ? 0.55 : 0.15);
  const glowOpacity = 0.45 + level * 0.55;

  return (
    <div
      onClick={toggleMainWindow}
      className="h-screen w-full rounded-full flex items-center justify-center cursor-pointer select-none"
      title={micOn ? 'Woxus — listening for your voice' : 'Woxus'}
    >
      <div
        className="relative w-12 h-12 rounded-full transition-transform duration-100 ease-out"
        style={{ transform: `scale(${scale})` }}
      >
        {/* Outer glow */}
        <div
          className="absolute  rounded-full  transition-opacity duration-200"
          style={{
            opacity: glowOpacity,
            background: talking
              ? 'radial-gradient(circle, rgba(168,85,247,0.75) 0%, rgba(99,102,241,0.35) 55%, transparent 75%)'
              : 'radial-gradient(circle, rgba(168,85,247,0.5) 0%, rgba(99,102,241,0.2) 55%, transparent 100%)',
          }}
        />
        {/* Halo ring */}
        <div
          className={`absolute inset-[-3px] rounded-full border transition-all duration-200 ${
            talking ? 'border-violet-400/80' : 'border-violet-300/25'
          }`}
          style={{ boxShadow: talking ? '0 0 18px rgba(168,85,247,0.6)' : '0 0 8px rgba(168,85,247,0.2)' }}
        />
        {/* Idle breathing */}
        <div className={`absolute inset-0 rounded-full ${talking ? '' : 'animate-pulse'}`} />
        {/* Sphere */}
        <div
          className="absolute inset-0 rounded-full transition-all duration-200"
          style={{
            background: talking
              ? 'radial-gradient(circle at 32% 28%, rgba(255,255,255,0.95) 0%, rgba(196,181,253,0.85) 18%, rgba(139,92,246,0.95) 52%, rgba(79,70,229,0.98) 78%, rgba(49,46,129,1) 100%)'
              : 'radial-gradient(circle at 32% 28%, rgba(255,255,255,0.9) 0%, rgba(167,139,250,0.8) 18%, rgba(124,58,237,0.95) 52%, rgba(79,70,229,0.98) 78%, rgba(49,46,129,1) 100%)',
            boxShadow: talking
              ? 'inset -6px -8px 14px rgba(0,0,0,0.55), inset 3px 4px 8px rgba(255,255,255,0.5), 0 0 20px rgba(139,92,246,0.7)'
              : 'inset -6px -8px 14px rgba(0,0,0,0.5), inset 3px 4px 8px rgba(255,255,255,0.45), 0 2px 10px rgba(0,0,0,0.35)',
          }}
        />
        {/* Specular highlight */}
        <div className="absolute rounded-full" style={{ top: '14%', left: '18%', width: '26%', height: '18%', background: 'rgba(255,255,255,0.55)', filter: 'blur(2px)' }} />
        {/* Center W */}
        <div className="absolute inset-0 flex items-center justify-center">
          <span
            className="text-[15px] font-bold text-white transition-opacity duration-200"
            style={{ textShadow: '0 1px 3px rgba(0,0,0,0.6)', opacity: talking ? 1 : 0.92 }}
          >
            W
          </span>
        </div>
      </div>
    </div>
  );
}
