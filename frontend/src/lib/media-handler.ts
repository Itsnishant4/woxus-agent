/**
 * MediaHandler — Audio/Video capture and playback for Gemini Live API.
 *
 * Mirrors the working reference from gemini-live-api-examples.
 *
 * - Captures microphone audio → downsamples to 16kHz → Int16 PCM
 * - Receives 24kHz Int16 PCM from Gemini → plays via AudioContext
 * - Optional camera/screen capture for multimodal
 */

export class MediaHandler {
  audioContext: AudioContext | null = null;
  mediaStream: MediaStream | null = null;
  audioWorkletNode: AudioWorkletNode | ScriptProcessorNode | null = null;
  videoStream: MediaStream | null = null;
  private videoInterval: ReturnType<typeof setInterval> | null = null;
  private nextStartTime = 0;
  private scheduledSources: AudioBufferSourceNode[] = [];
  isRecording = false;
  private videoCanvas = document.createElement("canvas");
  private canvasCtx = this.videoCanvas.getContext("2d")!;

  async initializeAudio() {
    if (!this.audioContext) {
      this.audioContext = new (window.AudioContext ||
        (window as any).webkitAudioContext)();
      // Try AudioWorklet; fall back to ScriptProcessorNode
      if (
        this.audioContext.audioWorklet &&
        typeof AudioWorkletNode !== "undefined"
      ) {
        await this.audioContext.audioWorklet.addModule("./pcm-processor.js");
      } else {
        console.warn(
          "AudioWorklet not available, using ScriptProcessorNode fallback"
        );
      }
    }
    if (this.audioContext.state === "suspended") {
      await this.audioContext.resume();
    }
  }

  async startAudio(
    onAudioData: (data: ArrayBuffer) => void
  ): Promise<void> {
    await this.initializeAudio();

    try {
      this.mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: true,
      });
      const source = this.audioContext!.createMediaStreamSource(
        this.mediaStream
      );

      if (
        this.audioContext!.audioWorklet &&
        typeof AudioWorkletNode !== "undefined"
      ) {
        // Modern AudioWorklet path
        this.audioWorkletNode = new AudioWorkletNode(
          this.audioContext!,
          "pcm-processor"
        );
        this.audioWorkletNode.port.onmessage = (event) => {
          if (this.isRecording) {
            const downsampled = this.downsampleBuffer(
              event.data as Float32Array,
              this.audioContext!.sampleRate,
              16000
            );
            const pcm16 = this.convertFloat32ToInt16(downsampled);
            onAudioData(pcm16);
          }
        };
        source.connect(this.audioWorkletNode);
      } else {
        // Legacy ScriptProcessorNode fallback
        const processor = this.audioContext!.createScriptProcessor(
          4096,
          1,
          1
        );
        processor.onaudioprocess = (event) => {
          if (this.isRecording) {
            const inputData = event.inputBuffer.getChannelData(0);
            const downsampled = this.downsampleBuffer(
              inputData,
              this.audioContext!.sampleRate,
              16000
            );
            const pcm16 = this.convertFloat32ToInt16(downsampled);
            onAudioData(pcm16);
          }
        };
        source.connect(processor);
        this.audioWorkletNode = processor;
      }

      // Mute local feedback
      const muteGain = this.audioContext!.createGain();
      muteGain.gain.value = 0;
      if (this.audioWorkletNode) {
        this.audioWorkletNode.connect(muteGain);
      }
      muteGain.connect(this.audioContext!.destination);

      this.isRecording = true;
    } catch (e) {
      console.error("Error starting audio:", e);
      throw e;
    }
  }

  stopAudio() {
    this.isRecording = false;
    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach((t) => t.stop());
      this.mediaStream = null;
    }
    if (this.audioWorkletNode) {
      this.audioWorkletNode.disconnect();
      this.audioWorkletNode = null;
    }
  }

  async startVideo(
    videoElement: HTMLVideoElement,
    onFrame: (base64: string) => void
  ) {
    try {
      this.videoStream = await navigator.mediaDevices.getUserMedia({
        video: true,
      });
      videoElement.srcObject = this.videoStream;
      this.videoInterval = setInterval(() => {
        this.captureFrame(videoElement, onFrame);
      }, 1000);
    } catch (e) {
      console.error("Error starting video:", e);
      throw e;
    }
  }

  async startScreen(
    videoElement: HTMLVideoElement,
    onFrame: (base64: string) => void,
    onEnded?: () => void
  ) {
    try {
      this.videoStream = await (
        navigator.mediaDevices as any
      ).getDisplayMedia({
        video: true,
      });
      videoElement.srcObject = this.videoStream;
      this.videoStream!.getVideoTracks()[0].onended = () => {
        this.stopVideo(videoElement);
        onEnded?.();
      };
      this.videoInterval = setInterval(() => {
        this.captureFrame(videoElement, onFrame);
      }, 1000);
    } catch (e) {
      console.error("Error starting screen share:", e);
      throw e;
    }
  }

  stopVideo(videoElement?: HTMLVideoElement) {
    if (this.videoStream) {
      this.videoStream.getTracks().forEach((t) => t.stop());
      this.videoStream = null;
    }
    if (this.videoInterval) {
      clearInterval(this.videoInterval);
      this.videoInterval = null;
    }
    if (videoElement) {
      videoElement.srcObject = null;
    }
  }

  private captureFrame(
    videoElement: HTMLVideoElement,
    onFrame: (base64: string) => void
  ) {
    if (!this.videoStream) return;
    this.videoCanvas.width = 640;
    this.videoCanvas.height = 480;
    this.canvasCtx.drawImage(videoElement, 0, 0, 640, 480);
    const base64 = this.videoCanvas
      .toDataURL("image/jpeg", 0.7)
      .split(",")[1];
    onFrame(base64);
  }

  /** Play 24kHz Int16 PCM audio from Gemini */
  playAudio(arrayBuffer: ArrayBuffer) {
    if (!this.audioContext) return;
    if (this.audioContext.state === "suspended") {
      this.audioContext.resume();
    }

    const pcmData = new Int16Array(arrayBuffer);
    const float32Data = new Float32Array(pcmData.length);
    for (let i = 0; i < pcmData.length; i++) {
      float32Data[i] = pcmData[i] / 32768.0;
    }

    const buffer = this.audioContext.createBuffer(
      1,
      float32Data.length,
      24000
    );
    buffer.getChannelData(0).set(float32Data);

    const source = this.audioContext.createBufferSource();
    source.buffer = buffer;
    source.connect(this.audioContext.destination);

    const now = this.audioContext.currentTime;
    this.nextStartTime = Math.max(now, this.nextStartTime);
    source.start(this.nextStartTime);
    this.nextStartTime += buffer.duration;

    this.scheduledSources.push(source);
    source.onended = () => {
      const idx = this.scheduledSources.indexOf(source);
      if (idx > -1) this.scheduledSources.splice(idx, 1);
    };
  }

  /** Stop all scheduled audio playback (for interruptions) */
  stopAudioPlayback() {
    this.scheduledSources.forEach((s) => {
      try {
        s.stop();
      } catch (_) {}
    });
    this.scheduledSources = [];
    if (this.audioContext) {
      this.nextStartTime = this.audioContext.currentTime;
    }
  }

  /** Downsample Float32 audio buffer to a target sample rate */
  private downsampleBuffer(
    buffer: Float32Array,
    sampleRate: number,
    outSampleRate: number
  ): Float32Array {
    if (outSampleRate === sampleRate) return buffer;
    const ratio = sampleRate / outSampleRate;
    const newLength = Math.round(buffer.length / ratio);
    const result = new Float32Array(newLength);
    let offsetResult = 0;
    let offsetBuffer = 0;
    while (offsetResult < result.length) {
      const nextOffsetBuffer = Math.round((offsetResult + 1) * ratio);
      let accum = 0,
        count = 0;
      for (
        let i = offsetBuffer;
        i < nextOffsetBuffer && i < buffer.length;
        i++
      ) {
        accum += buffer[i];
        count++;
      }
      result[offsetResult] = accum / count;
      offsetResult++;
      offsetBuffer = nextOffsetBuffer;
    }
    return result;
  }

  /** Convert Float32 [-1..1] to Int16 PCM ArrayBuffer */
  private convertFloat32ToInt16(buffer: Float32Array): ArrayBuffer {
    let l = buffer.length;
    const buf = new Int16Array(l);
    while (l--) {
      buf[l] = Math.min(1, Math.max(-1, buffer[l])) * 0x7fff;
    }
    return buf.buffer;
  }
}
