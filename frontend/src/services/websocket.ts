export const websocket = {
  connect: (url: string) => {
    console.log('WebSocket connecting to', url);
  },
  disconnect: () => {},
  send: (_data: unknown) => {},
};
