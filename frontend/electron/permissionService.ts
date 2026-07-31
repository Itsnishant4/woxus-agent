import { systemPreferences, shell } from 'electron';

export interface PermissionStatus {
  ok: boolean;
  platform: NodeJS.Platform;
  os: 'macos' | 'windows' | 'linux';
  wayland?: boolean;
  needsManual?: boolean;
}

function detectWayland(): boolean {
  if (process.platform !== 'linux') return false;
  const sessionType = process.env['XDG_SESSION_TYPE']?.toLowerCase() ?? '';
  const waylandDisplay = process.env['WAYLAND_DISPLAY'];
  return sessionType === 'wayland' || !!waylandDisplay;
}

export function checkPermission(): PermissionStatus {
  const platform = process.platform;
  if (platform === 'darwin') {
    const trusted = systemPreferences.isTrustedAccessibilityClient(false);
    return { ok: trusted, platform, os: 'macos' };
  }
  if (platform === 'win32') {
    return { ok: true, platform, os: 'windows' };
  }
  const wayland = detectWayland();
  return { ok: true, platform, os: 'linux', wayland, needsManual: wayland };
}

export function openPermissionSettings(): void {
  if (process.platform !== 'darwin') return;
  shell.openExternal(
    'x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility',
  );
}
