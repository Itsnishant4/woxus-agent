import { useState, useRef, useEffect, useCallback } from 'react';
import { GeminiClient } from '../lib/gemini-client';
import { VoicePlayer } from '../lib/voice-player';

// Shared text → Gemini main voice agent session (no mic).
// Used by the overlay popup AND the permanent Chat screen.

export interface VoiceChatMessage {
  role: 'user' | 'assistant';
  content: string;
  source?: 'local' | 'voice';
}

// Silence after the last received chunk before the turn counts as spoken.
const SPEAK_IDLE_MS = 4000;

/** Human-friendly labels for in-flight tool work (loading indicator). */
export function toolWorkLabel(name: string, label: string): string {
  if (label) return label.length > 80 ? `${label.slice(0, 77)}…` : label;
  switch (name) {
    case 'delegate_task_to_mini_agent':
    case 'delegate_tasks_to_mini_agent':
      return 'Working on your task…';
    case 'whatsapp_send':
      return 'Sending WhatsApp message…';
    case 'whatsapp_read':
    case 'whatsapp_search':
    case 'whatsapp_recent':
      return 'Reading WhatsApp…';
    case 'memory_create':
      return 'Saving memory…';
    case 'memory_list':
      return 'Recalling memories…';
    case 'terminal_exec':
      return 'Running command…';
    default:
      return 'Working…';
  }
}

export function useVoiceChat() {
  const [connecting, setConnecting] = useState(false);
  const [connected, setConnected] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [messages, setMessages] = useState<VoiceChatMessage[]>([]);
  const [working, setWorking] = useState<{ name: string; label: string } | null>(null);
  const clientRef = useRef<GeminiClient | null>(null);
  const playerRef = useRef<VoicePlayer | null>(null);
  const connectPromiseRef = useRef<Promise<void> | null>(null);
  const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Set when a new user message is sent: the next voice chunk must open a
  // FRESH assistant bubble instead of extending the previous turn's one.
  const freshTurnRef = useRef(false);
  // Dedupe: identical text re-sent within this window is a double-click /
  // key-repeat, not a new message.
  const lastSendRef = useRef<{ text: string; at: number } | null>(null);
  // Blackout: right after a new submit, trailing audio/text chunks from the
  // previous turn may still arrive — drop them so two replies never overlap.
  const blackoutUntilRef = useRef(0);
  const inBlackout = () => Date.now() < blackoutUntilRef.current;

  const markActive = useCallback(() => {
    setSpeaking(true);
    if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
    idleTimerRef.current = setTimeout(() => setSpeaking(false), SPEAK_IDLE_MS);
  }, []);

  const appendVoiceText = useCallback((chunk: string) => {
    if (!chunk.trim()) return;
    const freshTurn = freshTurnRef.current;
    freshTurnRef.current = false;
    setMessages((prev) => {
      // New turn → always a separate bubble, never merged into an old one.
      if (freshTurn) {
        return [...prev, { role: 'assistant', content: chunk, source: 'voice' as const }];
      }
      const next = [...prev];
      let idx = next.length - 1;
      while (idx >= 0 && next[idx].role !== 'assistant') idx--;
      if (idx < 0 || next[idx].content.endsWith('…failed')) {
        return [...next, { role: 'assistant', content: chunk, source: 'voice' as const }];
      }
      const cur = next[idx].content;
      next[idx] = {
        role: 'assistant',
        source: 'voice' as const,
        content: chunk.startsWith(cur) ? chunk : cur + (cur.endsWith(' ') || chunk.startsWith(' ') ? '' : ' ') + chunk,
      };
      return next;
    });
  }, []);

  const pushUser = useCallback((text: string) => {
    playerRef.current?.interrupt();
    setWorking(null);
    setMessages((prev) => [...prev, { role: 'user', content: text }]);
  }, []);

  const pushAssistant = useCallback((text: string, source?: 'local' | 'voice') => {
    setMessages((prev) => [...prev, { role: 'assistant', content: text, source }]);
  }, []);

  const handleJsonMessage = useCallback((msg: any) => {
    switch (msg.type) {
      case 'tool_start':
        // A tool started working — show a loading state until it finishes.
        setWorking({ name: String(msg.name || ''), label: String(msg.label || '') });
        markActive();
        break;
      case 'gemini':
        if (inBlackout()) break; // stale tail of the previous turn — drop it
        setWorking(null);
        appendVoiceText(String(msg.text || ''));
        markActive();
        break;
      case 'interrupted':
        // Server ack (carries the new turn id): cut local audio at once.
        playerRef.current?.interrupt(typeof msg.turn === 'number' ? msg.turn : undefined);
        break;
      case 'latency_log':
        console.log(`[voice chat] "${msg.user_text}" → ${msg.latency_sec}s`);
        break;
      case 'tool_result': {
        setWorking(null);
        const toolResult = msg.result || {};
        if (toolResult.action === 'paste' && toolResult.text) {
          // @ts-ignore
          const pastePromise = (window as any).electronAPI?.agentPaste?.(toolResult.text);
          if (pastePromise?.then) {
            pastePromise.then((res: any) => {
              pushAssistant(
                res?.ok
                  ? '✓ Pasted into your app.'
                  : 'Paste failed — prompt is on your clipboard. Press Cmd+V in your app.',
                'voice'
              );
            }).catch(() => {
              pushAssistant('Paste failed.', 'voice');
            });
          }
        } else {
          const summary = toolResult.message || toolResult.mini_agent_output || toolResult.error || 'done';
          pushAssistant(`✓ ${msg.name}: ${String(summary).slice(0, 200)}`, 'voice');
        }
        markActive();
        break;
      }
      case 'error':
        console.error('Voice chat error:', msg.message);
        setWorking(null);
        pushAssistant(`Voice error: ${String(msg.message || 'session failed')}…failed`, 'voice');
        setSpeaking(false);
        break;
      default:
        break;
    }
  }, [appendVoiceText, markActive, pushAssistant]);

  const ensureVoiceSession = useCallback((): Promise<void> => {
    if (clientRef.current?.isConnected()) return Promise.resolve();
    if (connectPromiseRef.current) return connectPromiseRef.current;

    setConnecting(true);
    connectPromiseRef.current = (async () => {
      if (!playerRef.current) {
        playerRef.current = new VoicePlayer(() => markActive());
      }
      // User gesture (submit click/Enter) unlocks audio playback.
      await playerRef.current.ensure();

      let licenseKey = localStorage.getItem('woxus_license_key') || '';
      let hardwareId = 'unknown';
      try {
        const [status, hwid] = await Promise.all([
          (window as any).electronAPI?.getLicenseStatus?.(),
          (window as any).electronAPI?.getHardwareId?.(),
        ]);
        if (status?.licenseKey) {
          licenseKey = status.licenseKey;
          localStorage.setItem('woxus_license_key', licenseKey);
        }
        if (hwid) hardwareId = hwid;
      } catch {
        /* offline — backend falls back to saved license info */
      }

      await new Promise<void>((resolve, reject) => {
        const client = new GeminiClient({
          onOpen: () => {
            setConnected(true);
            setConnecting(false);
            resolve();
          },
          onMessage: (event) => {
            if (typeof event.data === 'string') {
              try {
                handleJsonMessage(JSON.parse(event.data));
              } catch (e) {
                console.error('Voice chat parse error:', e);
              }
            } else {
              // Framed voice reply audio → worklet streamer (turn-aware,
              // old turns discarded inside the worklet).
              playerRef.current?.playFrame(event.data);
            }
          },
          onClose: () => {
            setConnected(false);
            setConnecting(false);
            clientRef.current = null;
            connectPromiseRef.current = null;
          },
          onError: (e) => {
            console.error('Voice chat error:', e);
            setConnecting(false);
            connectPromiseRef.current = null;
            reject(e);
          },
        });
        clientRef.current = client;
        client.connect({ licenseKey, hardwareId });
      });
    })();

    connectPromiseRef.current.catch(() => {
      connectPromiseRef.current = null;
    });
    return connectPromiseRef.current;
  }, [handleJsonMessage, markActive]);

  const sendVoiceText = useCallback(async (trimmed: string) => {
    // Identical text re-sent within 1.5s is a double-click / key repeat.
    const now = Date.now();
    const last = lastSendRef.current;
    if (last && last.text === trimmed && now - last.at < 1500) return false;
    lastSendRef.current = { text: trimmed, at: now };
    pushUser(trimmed);
    freshTurnRef.current = true;
    // Mute the previous turn's in-flight tail so it can't talk over the reply.
    blackoutUntilRef.current = now + 800;
    setSpeaking(true);
    try {
      await ensureVoiceSession();
      // Barge-in first: tells the backend to drain the previous reply's
      // queued audio at the source, then the new message follows in order.
      clientRef.current?.send(JSON.stringify({ type: 'interrupt' }));
      clientRef.current?.sendText(trimmed);
      return true;
    } catch (err) {
      console.error(err);
      pushAssistant('Could not reach the voice agent. Try again.…failed', 'voice');
      setSpeaking(false);
      return false;
    }
  }, [ensureVoiceSession, pushAssistant, pushUser]);

  useEffect(() => {
    return () => {
      if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
      clientRef.current?.disconnect();
      clientRef.current = null;
      playerRef.current?.destroy();
      playerRef.current = null;
    };
  }, []);

  return {
    messages,
    connecting,
    connected,
    speaking,
    working,
    sendVoiceText,
    pushUser,
    pushAssistant,
    setMessages,
  };
}
