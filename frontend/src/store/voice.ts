import { create } from 'zustand';

interface VoiceState {
  connected: boolean;
  isListening: boolean;
  micActive: boolean;
  sttStatus: 'idle' | 'downloading' | 'ready';
  transcripts: Array<{ role: string; text: string }>;
  setConnected: (v: boolean) => void;
  setListening: (v: boolean) => void;
  setMicActive: (v: boolean) => void;
  setSttStatus: (v: 'idle' | 'downloading' | 'ready') => void;
  addTranscript: (role: string, text: string, append?: boolean) => void;
  clearTranscripts: () => void;
}

export const useVoiceStore = create<VoiceState>((set) => ({
  connected: false,
  isListening: false,
  micActive: false,
  sttStatus: 'idle',
  transcripts: [],
  setConnected: (v) => set({ connected: v }),
  setListening: (v) => set({ isListening: v }),
  setMicActive: (v) => set({ micActive: v }),
  setSttStatus: (v) => set({ sttStatus: v }),
  addTranscript: (role, text, append) =>
    set((s) => {
      if (append && s.transcripts.length > 0 && s.transcripts[s.transcripts.length - 1].role === role) {
        const updated = [...s.transcripts];
        const prev = updated[updated.length - 1].text;
        const sep = prev && !prev.endsWith(" ") && !text.startsWith(" ") ? " " : "";
        updated[updated.length - 1] = { role, text: prev + sep + text };
        return { transcripts: updated };
      }
      return { transcripts: [...s.transcripts, { role, text }] };
    }),
  clearTranscripts: () => set({ transcripts: [] }),
}));
