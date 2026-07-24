import { api } from '@services/api';

export function useAgent() {
  const sendMessage = async (content: string) => {
    const res = await api.post('/chat/send', { content });
    return res;
  };

  return { sendMessage };
}
