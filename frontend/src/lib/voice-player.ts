/**
 * VoicePlayer — turn-aware streaming playback for Gemini voice replies.
 *
 * Owns one AudioContext + one pcm-player AudioWorkletNode. Binary WS frames
 * carry an 8-byte big-endian header (turn, seq) followed by 24kHz Int16 PCM.
 * Old-turn frames are discarded inside the worklet; interrupt() cuts audio
 * immediately. Speaking state is derived from actual buffered audio, not
 * timers on message arrival.
 */

export class VoicePlayer {
  private ctx: AudioContext | null = null;
  private node: AudioWorkletNode | null = null;
  private ready: Promise<void> | null = null;
  private lastActiveAt = 0;
  private onActive: (() => void) | null = null;
  private statsTimer: ReturnType<typeof setInterval> | null = null;
  lastStats: { played: number; dropped: number; underrunBlocks: number; bufferedMs: number } | null = null;

  constructor(onActive?: () => void) {
    this.onActive = onActive || null;
  }

  /** Must be called from a user gesture at least once (unlocks audio). */
  ensure(): Promise<void> {
    if (this.ready) return this.ready;
    this.ready = (async () => {
      if (!this.ctx) {
        this.ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
      }
      if (this.ctx.state === 'suspended') {
        await this.ctx.resume();
      }
      // Worklet served from the app root in dev (/pcm-player-worklet.js) and
      // next to index.html in packaged builds.
      const url = new URL('pcm-player-worklet.js', document.baseURI).href;
      await this.ctx.audioWorklet.addModule(url);
      this.node = new AudioWorkletNode(this.ctx, 'pcm-player');
      this.node.connect(this.ctx.destination);
      this.node.port.onmessage = (e) => {
        const m = e.data;
        if (m && m.type === 'stats') {
          this.lastStats = m;
          if ((window as any).localStorage?.getItem('woxus_audio_debug')) {
            console.log('[voice player stats]', m);
          }
        }
      };
      this.statsTimer = setInterval(() => {
        try {
          this.node?.port.postMessage({ type: 'stats' });
        } catch {
          /* ignore */
        }
      }, 5000);
    })();
    // A failed load must not wedge every later call: allow one retry.
    this.ready.catch(() => {
      this.ready = null;
    });
    return this.ready;
  }

  /** Play one framed WS payload: 8-byte header (turn, seq BE) + Int16 PCM. */
  playFrame(data: ArrayBuffer) {
    if (!this.node || data.byteLength < 8) return;
    const view = new DataView(data);
    const turn = view.getUint32(0, false);
    const pcm = data.slice(8);
    if (pcm.byteLength === 0) return;
    try {
      this.node.port.postMessage({ type: 'frame', turn, pcm }, [pcm]);
    } catch (e) {
      console.error('[voice player] postMessage failed:', e);
      return;
    }
    this.lastActiveAt = Date.now();
    this.onActive?.();
  }

  /** Cut current audio immediately (barge-in / new submit). Without a turn
   * it only clears buffered audio; the server ack adopts the new turn. */
  interrupt(turn?: number) {
    try {
      this.node?.port.postMessage(
        typeof turn === 'number' ? { type: 'interrupt', turn } : { type: 'interrupt' }
      );
    } catch {
      /* ignore */
    }
  }

  /** True while audio arrived recently (UI "speaking" indicator). */
  get active(): boolean {
    return Date.now() - this.lastActiveAt < 1500;
  }

  destroy() {
    if (this.statsTimer) clearInterval(this.statsTimer);
    try {
      this.node?.disconnect();
    } catch {
      /* ignore */
    }
    this.node = null;
    if (this.ctx) {
      this.ctx.close().catch(() => {});
      this.ctx = null;
    }
    this.ready = null;
  }
}
