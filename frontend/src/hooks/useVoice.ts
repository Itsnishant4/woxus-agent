/**
 * useVoice — React hook for Gemini Live voice integration.
 *
 * Wraps the voice service with live state from the Zustand store.
 */

import { useVoiceStore } from '../store/voice';
import {
  startVoiceSession,
  stopVoiceSession,
  sendTextMessage,
  type TranscriptionHandler,
} from '../services/voice';

export function useVoice() {
  const {
    connected,
    isListening,
    micActive,
    transcripts,
    clearTranscripts,
  } = useVoiceStore();

  return {
    connected,
    isListening,
    micActive,
    transcripts,
    startSession: (onTranscription?: TranscriptionHandler) =>
      startVoiceSession(onTranscription),
    stopSession: stopVoiceSession,
    sendText: sendTextMessage,
    clearTranscripts,
  };
}
