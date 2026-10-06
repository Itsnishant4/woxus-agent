/**
 * PCM voice playback worklet — ring-buffer streamer for 24kHz Int16 mono.
 *
 * The main thread posts { type:'frame', turn, seq, pcm } messages. Frames
 * play strictly in order; frames from a superseded turn are discarded, so a
 * new reply can never talk over an old one and no timing heuristics are
 * needed on the main thread.
 */
class PcmPlayer extends AudioWorkletProcessor {
  constructor() {
    super();
    // Source audio is 24kHz mono; the context runs at its own rate
    // (usually 44100/48000). step rescales so pitch/speed stay correct.
    this.step = 24000 / sampleRate;
    this.capacity = 24000 * 5; // 5s ring buffer (source samples)
    this.buf = new Float32Array(this.capacity);
    this.w = 0;
    this.r = 0;
    this.frac = 0;
    this.count = 0;
    this.expectedTurn = 0;
    this.played = 0;
    this.dropped = 0;
    this.underrunBlocks = 0;
    this.port.onmessage = (e) => this.onmsg(e.data);
  }

  reset() {
    this.r = this.w;
    this.frac = 0;
    this.count = 0;
  }

  onmsg(m) {
    if (!m || typeof m.type !== 'string') return;
    if (m.type === 'frame') {
      if (m.turn < this.expectedTurn) {
        this.dropped++;
        return;
      }
      if (m.turn > this.expectedTurn) {
        // New turn takes over: drop anything still buffered from the old one.
        this.expectedTurn = m.turn;
        this.reset();
      }
      const pcm = new Int16Array(m.pcm);
      // Overrun: drop oldest to stay live (bounded ring, never grows).
      if (this.count + pcm.length > this.capacity) {
        const excess = this.count + pcm.length - this.capacity;
        this.r = (this.r + excess) % this.capacity;
        this.count -= excess;
        this.dropped++;
      }
      for (let i = 0; i < pcm.length; i++) {
        this.buf[this.w] = pcm[i] / 32768;
        this.w = (this.w + 1) % this.capacity;
      }
      this.count += pcm.length;
    } else if (m.type === 'interrupt') {
      // Immediate cut: silence now. With a numeric turn, adopt it (server
      // ack); without one, just clear and keep the current turn so future
      // frames are never poisoned by a guessed turn id.
      if (typeof m.turn === 'number') {
        if (m.turn >= this.expectedTurn) {
          this.expectedTurn = m.turn;
        }
      }
      this.r = this.w;
      this.count = 0;
      this.frac = 0;
    } else if (m.type === 'stats') {
      this.port.postMessage({
        type: 'stats',
        played: this.played,
        dropped: this.dropped,
        underrunBlocks: this.underrunBlocks,
        bufferedMs: Math.round((this.count / 24000) * 1000),
      });
    }
  }

  process(_inputs, outputs) {
    // Resample 24kHz source to the context rate with linear interpolation,
    // and write to EVERY output channel (dual-mono, never one-eared).
    const chans = outputs[0];
    const n = chans[0].length;
    let underrun = false;
    for (let i = 0; i < n; i++) {
      let s = 0;
      if (this.count > 1) {
        const i0 = this.r;
        const i1 = (this.r + 1) % this.capacity;
        s = this.buf[i0] * (1 - this.frac) + this.buf[i1] * this.frac;
        this.frac += this.step;
        while (this.frac >= 1) {
          this.frac -= 1;
          this.r = (this.r + 1) % this.capacity;
          this.count--;
        }
        this.played++;
      } else {
        underrun = true;
      }
      for (let c = 0; c < chans.length; c++) {
        chans[c][i] = s;
      }
    }
    if (underrun) this.underrunBlocks++;
    return true;
  }
}

registerProcessor('pcm-player', PcmPlayer);
