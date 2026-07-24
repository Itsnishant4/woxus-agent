/**
 * GeminiClient — WebSocket communication for Gemini Live API.
 *
 * Mirrors the working reference from gemini-live-api-examples.
 * Connects to our backend WebSocket which relays to Gemini Live.
 */

export interface GeminiClientConfig {
  onOpen?: () => void;
  onMessage?: (event: MessageEvent) => void;
  onClose?: (event: CloseEvent) => void;
  onError?: (event: Event) => void;
}

export class GeminiClient {
  private websocket: WebSocket | null = null;
  private config: GeminiClientConfig;

  constructor(config: GeminiClientConfig) {
    this.config = config;
  }

  connect() {
    const wsUrl = `ws://127.0.0.1:8000/api/voice/live`;

    this.websocket = new WebSocket(wsUrl);
    this.websocket.binaryType = "arraybuffer";

    this.websocket.onopen = () => {
      this.config.onOpen?.();
    };

    this.websocket.onmessage = (event) => {
      this.config.onMessage?.(event);
    };

    this.websocket.onclose = (event) => {
      this.config.onClose?.(event);
    };

    this.websocket.onerror = (event) => {
      this.config.onError?.(event);
    };
  }

  send(data: ArrayBuffer | string) {
    if (this.websocket && this.websocket.readyState === WebSocket.OPEN) {
      this.websocket.send(data);
    }
  }

  sendText(text: string) {
    this.send(JSON.stringify({ text }));
  }

  sendImage(base64Data: string, mimeType = "image/jpeg") {
    this.send(
      JSON.stringify({
        type: "image",
        mime_type: mimeType,
        data: base64Data,
      })
    );
  }

  disconnect() {
    if (this.websocket) {
      this.websocket.close();
      this.websocket = null;
    }
  }

  isConnected(): boolean {
    return (
      this.websocket !== null && this.websocket.readyState === WebSocket.OPEN
    );
  }
}
