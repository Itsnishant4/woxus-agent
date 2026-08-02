/**
 * Resolve the backend port chosen by BackendManager (8457 when free, otherwise
 * the next free port). The renderer reads it synchronously via preload so the
 * API/WebSocket base URLs are correct from module load.
 */
export function resolveBackendPort(): number {
  try {
    const port = (window as any).electronAPI?.getBackendPort?.();
    if (typeof port === "number" && port > 0) return port;
  } catch {
    /* dev / preload unavailable */
  }
  return 8457;
}

export const API_BASE = `http://127.0.0.1:${resolveBackendPort()}/api`;
const BASE = API_BASE;

async function request(path: string, opts?: RequestInit) {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...opts,
  });
  if (!res.ok) throw new Error(`API ${res.status}: ${res.statusText}`);
  return res.json();
}

export const api = {
  get: (path: string) => request(path),
  post: (path: string, body: unknown) =>
    request(path, { method: 'POST', body: JSON.stringify(body) }),
  put: (path: string, body: unknown) =>
    request(path, { method: 'PUT', body: JSON.stringify(body) }),
  delete: (path: string) => request(path, { method: 'DELETE' }),
};
