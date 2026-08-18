import { randomUUID } from 'crypto';
import { networkInterfaces, hostname, platform } from 'os';
import { settingsStore, CachedLicense, CachedTrial } from './store.js';
import { BackendManager } from './backendManager.js';

/**
 * License/trial/feedback calls hit the LOCAL backend, which now runs on a
 * port chosen at startup (8457 when free, otherwise the next free port). Read
 * it lazily at call time — a module-level const would resolve before
 * BackendManager.start() picks the port.
 */
function apiBase(): string {
  return `http://127.0.0.1:${BackendManager.getInstance().getPort()}/api`;
}

function getMacAddress(): string {
  const interfaces = networkInterfaces();
  for (const name of Object.keys(interfaces).sort()) {
    const net = interfaces[name];
    if (!net) continue;
    for (const iface of net) {
      if (!iface.internal && iface.mac && iface.mac !== '00:00:00:00:00:00') {
        return iface.mac;
      }
    }
  }
  return '00:00:00:00:00:00';
}

export function getHardwareId(): string {
  const mac = getMacAddress();
  const node = hostname();
  const raw = `${node}-${mac}-${platform()}`;
  // Simple hash to produce consistent ID
  let hash = 0;
  for (let i = 0; i < raw.length; i++) {
    const chr = raw.charCodeAt(i);
    hash = ((hash << 5) - hash) + chr;
    hash |= 0;
  }
  const hex = Math.abs(hash).toString(16).padStart(8, '0');
  return `${hex}-${mac.replace(/:/g, '').slice(0, 8)}`;
}

export async function verifyLicense(licenseKey: string): Promise<{
  valid: boolean;
  reason?: string;
  offline?: boolean;
  cached?: boolean;
}> {
  const hwid = getHardwareId();
  try {
    const res = await fetch(`${apiBase()}/license/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ license_key: licenseKey, hardware_id: hwid }),
    });
    const data = await res.json();
    if (data.valid) {
      settingsStore.setLicenseKey(licenseKey);
      settingsStore.setCachedLicenseStatus({
        valid: true,
        license_key: licenseKey,
        expires_at: data.expiry || data.expires_at || '',
        hardware_id: hwid,
      });
    }
    return { valid: data.valid, reason: data.reason, offline: data.offline };
  } catch {
    return { valid: false, reason: 'Could not reach license server', offline: true };
  }
}

export async function getLicenseStatus(): Promise<{
  status: 'licensed' | 'trial' | 'unlicensed';
  licenseKey?: string;
  trialEmail?: string;
  trialRemaining?: number;
  trialTotal?: number;
  offline?: boolean;
}> {
  // Server must re-verify every launch when a key is stored — a cached
  // 'valid' result alone is never trusted (revocation must lock the app).
  const hwid = getHardwareId();
  const storedKey = settingsStore.getLicenseKey();
  if (storedKey) {
    try {
      const res = await fetch(`${apiBase()}/license/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ license_key: storedKey, hardware_id: hwid }),
      });
      const data = await res.json();
      if (data.valid) {
        settingsStore.setCachedLicenseStatus({
          valid: true,
          license_key: storedKey,
          expires_at: data.expiry || data.expires_at || '',
          hardware_id: hwid,
        });
        return { status: 'licensed', licenseKey: storedKey };
      }
      // Key genuinely invalid / revoked — clear cache and lock.
      if (!data.offline) {
        settingsStore.setLicenseKey('');
        settingsStore.setCachedLicenseStatus(null);
        return { status: 'unlicensed' };
      }
      // Backend unreachable — fall through to offline cache grace below.
    } catch { /* backend not up yet — fall through to offline cache grace */ }

    const cached = settingsStore.getCachedLicenseStatus();
    if (cached?.valid) {
      return { status: 'licensed', licenseKey: cached.license_key, offline: true };
    }
  }

  // Check cached trial accurately
  const cachedTrial = settingsStore.getCachedTrialStatus();
  console.log('[LicenseIpc] Checking local trial cache...', cachedTrial);
  if (cachedTrial?.active) {
    const startedAt = settingsStore.getTrialStartedAt();
    if (startedAt > 0) {
      const elapsed = (Date.now() - startedAt) / 1000;
      const remaining = Math.max(0, cachedTrial.total_seconds - elapsed);
      console.log(`[LicenseIpc] Local cache calculation -> elapsed: ${elapsed}s, remaining: ${remaining}s`);
      if (remaining > 0) {
        return {
          status: 'trial',
          trialEmail: cachedTrial.email,
          trialRemaining: Math.floor(remaining),
          trialTotal: cachedTrial.total_seconds,
        };
      }
      console.log('[LicenseIpc] Local cache says trial has expired.');
      return { status: 'unlicensed', trialTotal: cachedTrial.total_seconds };
    }
  }

  console.log(`[LicenseIpc] Fetching trial status from local Python backend API: ${apiBase()}/trial/status?hardware_id=${hwid}`);
  try {
    const res = await fetch(`${apiBase()}/trial/status?hardware_id=${hwid}`);
    const data = await res.json();
    console.log('[LicenseIpc] Local Python backend returned trial status:', data);
    if (data.active) {
      settingsStore.setCachedTrialStatus({
        active: true,
        email: data.email || '',
        remaining_seconds: data.remaining_seconds,
        total_seconds: data.total_seconds,
      });
      settingsStore.setTrialStartedAt(Date.now() - (data.total_seconds - data.remaining_seconds) * 1000);
      return {
        status: 'trial',
        trialEmail: data.email,
        trialRemaining: data.remaining_seconds,
        trialTotal: data.total_seconds,
      };
    }
    console.log('[LicenseIpc] Local Python backend says unlicensed or expired.');
    return { status: 'unlicensed', trialTotal: data.total_seconds };
  } catch (e) { 
    console.log('[LicenseIpc] Failed to fetch from local Python backend, marking offline.', e);
  }

  return { status: 'unlicensed', trialTotal: 600 };
}

export async function getTrialStatus(): Promise<{
  active: boolean;
  remaining_seconds: number;
  total_seconds: number;
  email?: string;
}> {
  const hwid = getHardwareId();
  console.log(`[LicenseIpc] Polling local Python backend for trial status updates...`);
  try {
    const res = await fetch(`${apiBase()}/trial/status?hardware_id=${hwid}`);
    const data = await res.json();
    console.log('[LicenseIpc] Polling response:', data);
    return {
      active: data.active,
      remaining_seconds: data.remaining_seconds,
      total_seconds: data.total_seconds,
      email: data.email,
    };
  } catch (e) {
    console.log('[LicenseIpc] Polling failed, backend may be offline.', e);
    return { active: false, remaining_seconds: 0, total_seconds: 600 };
  }
}

export async function startTrial(email: string): Promise<{
  active: boolean;
  remaining_seconds: number;
  total_seconds: number;
  email?: string;
}> {
  const hwid = getHardwareId();
  try {
    const res = await fetch(`${apiBase()}/trial/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ hardware_id: hwid, email }),
    });
    const data = await res.json();
    if (data.active) {
      settingsStore.setTrialEmail(data.email || email);
      settingsStore.setTrialStartedAt(Date.now());
      settingsStore.setCachedTrialStatus({
        active: true,
        email: data.email || email,
        remaining_seconds: data.remaining_seconds,
        total_seconds: data.total_seconds,
      });
    }
    return data;
  } catch {
    return { active: false, remaining_seconds: 0, total_seconds: 600 };
  }
}

export async function submitFeedback(rating: number, text: string): Promise<boolean> {
  const hwid = getHardwareId();
  try {
    await fetch(`${apiBase()}/feedback/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rating, text, hardware_id: hwid }),
    });
    return true;
  } catch {
    return false;
  }
}
