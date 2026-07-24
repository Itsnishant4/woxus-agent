import { api } from './api';

export const websocket = {
  connect: (url: string) => {
    // Phase 2: implement WebSocket connection
    console.log('WebSocket connecting to', url);
  },
  disconnect: () => {},
  send: (data: unknown) => {},
};
