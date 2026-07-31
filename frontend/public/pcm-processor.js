/**
 * PCMProcessor — AudioWorklet for capturing microphone audio.
 *
 * Collects Float32 PCM samples in a buffer and posts completed
 * buffers to the main thread for downsampling + sending to Gemini.
 *
 * Mirrors the working reference from gemini-live-api-examples.
 */
class PCMProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.bufferSize = 512;
    this.buffer = new Float32Array(this.bufferSize);
    this.bufferIndex = 0;
  }

  process(inputs, outputs, parameters) {
    const input = inputs[0];
    if (!input || !input.length) return true;

    const channelData = input[0];

    for (let i = 0; i < channelData.length; i++) {
      const sample = channelData[i];
      this.buffer[this.bufferIndex++] = sample;

      if (this.bufferIndex >= this.bufferSize) {
        // Compute RMS volume to detect speech vs silence
        let sum = 0;
        for (let j = 0; j < this.bufferSize; j++) {
          sum += this.buffer[j] * this.buffer[j];
        }
        const rms = Math.sqrt(sum / this.bufferSize);

        if (rms > 0.002) {
          // Actual voice speech — send audio buffer
          this.port.postMessage(this.buffer);
        } else {
          // Silence / background noise — send digital zero buffer for instant Gemini VAD trigger
          this.port.postMessage(new Float32Array(this.bufferSize));
        }

        this.buffer = new Float32Array(this.bufferSize);
        this.bufferIndex = 0;
      }
    }

    return true;
  }
}

registerProcessor("pcm-processor", PCMProcessor);
