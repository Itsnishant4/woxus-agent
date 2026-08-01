import { clipboard } from 'electron';
import { keyboard, Key, getActiveWindow } from '@nut-tree-fork/nut-js';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export interface PasteResult {
  ok: boolean;
  method: 'paste' | 'type' | 'none';
  error?: string;
  clipboard?: boolean;
}

// Writes prompt to system clipboard and injects the paste keystroke (Cmd+V / Ctrl+V).
// IMPORTANT: nut.js expects the MODIFIER key FIRST, then the letter key — the
// documented combo is `pressKey(Key.LeftCmd, Key.V)` (modifier first). The old
// `pressKey(Key.V, Key.LeftCmd)` sent "V then Cmd", which macOS doesn't treat as
// a paste shortcut, so the clipboard was set but nothing was pasted.
export async function pasteText(text: string): Promise<PasteResult> {
  clipboard.writeText(text);
  await sleep(120);

  const modifier = process.platform === 'darwin' ? Key.LeftCmd : Key.LeftControl;
  try {
    // Modifier first, then the letter key — proper Cmd+V / Ctrl+V.
    await keyboard.pressKey(modifier, Key.V);
    await sleep(60);
    await keyboard.releaseKey(modifier, Key.V);
    return { ok: true, method: 'paste' };
  } catch (err) {
    console.error('[paste] nut.js paste failed, falling back to typing:', err);
    try {
      await keyboard.type(text);
      return { ok: true, method: 'type' };
    } catch (typeErr) {
      console.error('[paste] typing fallback failed:', typeErr);
      // Clipboard is still set, so the user can paste manually with Cmd+V.
      return { ok: false, method: 'none', error: String(typeErr), clipboard: true };
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
