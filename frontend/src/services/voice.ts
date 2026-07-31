/**
 * Woxus Voice Service — Gemini Live API integration.
 *
 * Wires together MediaHandler (audio capture/playback) and
 * GeminiClient (WebSocket) into a single voice session.
 *
 * The Gemini Live API handles STT, TTS, interruption, and
 * emotional voice — all through one WebSocket connection.
 *
 * Pipeline:
 *   Mic → 16kHz PCM → GeminiClient → Backend → Gemini Live API
 *   Gemini Live API → Backend → GeminiClient → 24kHz PCM → Speaker
 */

import { MediaHandler } from '../lib/media-handler';
import { GeminiClient } from '../lib/gemini-client';
import { useVoiceStore } from '../store/voice';
import { toast } from 'react-hot-toast';

const mediaHandler = new MediaHandler();

let geminiClient: GeminiClient | null = null;
let _connectingLock = false;
let _retryLock = false;
let _serverError = false;

export type TranscriptionHandler = (role: string, text: string) => void;

/**
 * Start a voice session with Gemini Live.
 * Opens WebSocket, starts mic capture, handles audio playback.
 */
export async function startVoiceSession(
  onTranscription?: TranscriptionHandler
): Promise<void> {
  if (_connectingLock) return;
  _connectingLock = true;

  const store = useVoiceStore.getState();
  store.setSttStatus('idle');

  // Initialize audio context (must be from user gesture)
  await mediaHandler.initializeAudio();

  return new Promise((resolve, reject) => {
    // Clean up any previous session
    stopVoiceSession();

    geminiClient = new GeminiClient({
      onOpen: async () => {
        store.setConnected(true);
        store.setListening(true);
        console.log('Gemini Live connected');

        // Start mic capture
        try {
          await mediaHandler.startAudio((audioData: ArrayBuffer) => {
            if (geminiClient?.isConnected()) {
              geminiClient.send(audioData);
            }
          });
          store.setMicActive(true);
          resolve();
        } catch (e) {
          _connectingLock = false;
          reject(e);
        }
      },

      onMessage: (event) => {
        if (typeof event.data === 'string') {
          // JSON message (transcription, interrupt, etc.)
          try {
            const msg = JSON.parse(event.data);
            handleJsonMessage(msg, onTranscription);
          } catch (e) {
            console.error('Parse error:', e);
          }
        } else {
          // Audio response from Gemini — play it
          mediaHandler.playAudio(event.data);
        }
      },

      onClose: (event) => {
        console.log('Gemini Live disconnected', event?.code);
        _connectingLock = false;
        store.setConnected(false);
        store.setListening(false);
        mediaHandler.stopAudio();
        store.setMicActive(false);

        // Backend already retried with history replay; only reconnect once on
        // abnormal drops, and never after a server-reported error.
        const abnormal =
          event?.code != null &&
          event.code !== 1000 &&
          event.code !== 1001 &&
          !_serverError;
        if (abnormal && !_retryLock) {
          _retryLock = true;
          toast('Voice session dropped — reconnecting…');
          setTimeout(async () => {
            _retryLock = false;
            try {
              await startVoiceSession(onTranscription);
            } catch (e) {
              console.error('Voice reconnect failed:', e);
            }
          }, 2000);
        }
      },

      onError: (e) => {
        console.error('Gemini Live error:', e);
        _connectingLock = false;
        store.setConnected(false);
      },
    });

    geminiClient.connect();
  });
}

/**
 * Stop the voice session and clean up.
 */
export function stopVoiceSession(): void {
  mediaHandler.stopAudio();
  mediaHandler.stopAudioPlayback();
  geminiClient?.disconnect();
  geminiClient = null;
  _serverError = false;
  useVoiceStore.getState().setConnected(false);
  useVoiceStore.getState().setListening(false);
  useVoiceStore.getState().setMicActive(false);
}

/**
 * Send a text message (not audio) to Gemini.
 */
export function sendTextMessage(text: string): void {
  geminiClient?.sendText(text);
}

/**
 * Handle JSON messages from the Gemini Live WebSocket.
 * Matches the reference main.js handleJsonMessage pattern.
 */
function handleJsonMessage(
  msg: any,
  onTranscription?: TranscriptionHandler
): void {
  const store = useVoiceStore.getState();

  switch (msg.type) {
    case 'interrupted':
      // User interrupted Gemini — stop playback
      mediaHandler.stopAudioPlayback();
      break;

    case 'turn_complete':
      // Current turn finished
      break;

    case 'user':
      // User speech transcription
      store.addTranscript('user', msg.text);
      onTranscription?.('user', msg.text);
      break;

    case 'gemini':
      // Gemini sends incremental transcription updates.
      // Replace last gemini entry instead of stacking words.
      store.addTranscript('gemini', msg.text, true);
      onTranscription?.('gemini', msg.text);
      break;

    case 'latency_log':
      console.log(`⏱️ [LATENCY LOG] User spoke/sent: "${msg.user_text}" | Woxus response time: ${msg.latency_sec}s (${msg.latency_ms}ms)`);
      break;

    case 'stt_downloading':
      store.setSttStatus('downloading');
      toast(msg.message || 'Downloading speech recognition model…');
      break;

    case 'stt_ready':
      store.setSttStatus('ready');
      break;

    case 'error':
      console.error('Gemini Live error:', msg.message);
      _serverError = true;
      toast.error(String(msg.message || 'Voice session failed'));
      break;

    default:
      console.debug('Unknown message type:', msg.type);
  }
}
