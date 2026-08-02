// after-pack.mjs — restore executable/read-write state on the bundled backend.
//
// GitHub Actions upload-artifact/download-artifact stores files in a zip that
// does NOT preserve Unix permissions, so the PyInstaller backend lands in the
// packaged app as 0644 (or with restricted flags) and spawn() fails with
// EACCES. This hook runs after the app directory is packed and re-applies
// permissions before the DMG/zip/NSIS targets are built. On macOS this re-adds
// the exec bit; on Windows it clears any read-only flag left by extraction.
import { chmodSync, existsSync, readdirSync, statSync } from 'fs';
import { join } from 'path';

export default async function (context) {
  const { appOutDir, electronPlatformName } = context;

  const backendDir =
    electronPlatformName === 'darwin'
      ? join(appOutDir, 'Woxus.app', 'Contents', 'Resources', 'backend')
      : join(appOutDir, 'backend');

  if (!existsSync(backendDir)) {
    console.warn(`[after-pack] backend dir not found: ${backendDir}`);
    return;
  }

  chmodTree(backendDir);
  console.log(`[after-pack] set 0755 on backend bundle: ${backendDir}`);
}

function chmodTree(dir) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      chmodTree(full);
    } else if (st.isFile()) {
      chmodSync(full, 0o755);
    }
  }
}
