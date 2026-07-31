import { clipboard } from 'electron';
import { keyboard, Key, getActiveWindow } from '@nut-tree-fork/nut-js';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export interface PasteResult {
  ok: boolean;
  method: 'paste' | 'type' | 'none';
  error?: string;
}

// Writes prompt to system clipboard and injects the paste keystroke (Cmd+V / Ctrl+V)
export async function pasteText(text: string): Promise<PasteResult> {
  clipboard.writeText(text);
  await sleep(120);

  const modifier = process.platform === 'darwin' ? Key.LeftCmd : Key.LeftControl;
  try {
    await keyboard.pressKey(Key.V, modifier);
    await keyboard.releaseKey(Key.V, modifier);
    return { ok: true, method: 'paste' };
  } catch (err) {
    console.error('[paste] nut.js paste failed, falling back to typing:', err);
    try {
      await keyboard.type(text);
      return { ok: true, method: 'type' };
    } catch (typeErr) {
      console.error('[paste] typing fallback failed:', typeErr);
      return { ok: false, method: 'none', error: String(typeErr) };
    }
  }
}

export async function getActiveWindowTitle(): Promise<string> {
  try {
    const win = await getActiveWindow();
    return win?.title ?? '';
  } catch {
    return '';
  }
}

let savedActiveWindow: Awaited<ReturnType<typeof getActiveWindow>> | null = null;

export async function saveActiveWindow(): Promise<void> {
  try {
    savedActiveWindow = await getActiveWindow();
  } catch {
    savedActiveWindow = null;
  }
}

export async function restoreActiveWindow(): Promise<void> {
  const win = savedActiveWindow;
  savedActiveWindow = null;
  if (!win) return;
  try {
    await win.focus();
  } catch {
    /* focus restore is best-effort */
  }
}
