import { create } from 'zustand';

interface VoiceState {
  connected: boolean;
  isListening: boolean;
  micActive: boolean;
  transcripts: Array<{ role: string; text: string }>;
  setConnected: (v: boolean) => void;
  setListening: (v: boolean) => void;
  setMicActive: (v: boolean) => void;
  addTranscript: (role: string, text: string) => void;
  clearTranscripts: () => void;
}

export const useVoiceStore = create<VoiceState>((set) => ({
  connected: false,
  isListening: false,
  micActive: false,
  transcripts: [],
  setConnected: (v) => set({ connected: v }),
  setListening: (v) => set({ isListening: v }),
  setMicActive: (v) => set({ micActive: v }),
  addTranscript: (role, text) =>
    set((s) => ({
      transcripts: [...s.transcripts, { role, text }],
    })),
  clearTranscripts: () => set({ transcripts: [] }),
}));
