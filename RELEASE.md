# 🚀 Woxus Release Checklist

This is the step-by-step process for shipping a new version of Woxus to users.

---

## Overview

Releases are **fully automated** by GitHub Actions. You only need to:

1. **Bump the version** in `frontend/package.json` (+ `package-lock.json` mirror)
2. **Push a git tag** starting with `v` (e.g. `v0.1.13`)

Pushing the tag triggers [`.github/workflows/release.yml`](.github/workflows/release.yml), which builds the
backend (PyInstaller) + frontend (electron-builder) on **macOS arm64, macOS x64, and Windows** in parallel,
bundles the matching **wacli** binary per platform (WhatsApp needs it on user systems), and uploads the
installers + update metadata to the public
**[woxus-releases](https://github.com/Itsnishant4/woxus-releases)** repo.

Users' apps then auto-detect the update on next launch and show the in-app banner.

---

## ⚠️ Before you start (one-time setup)

Verify these exist:

- [ ] **`RELEASE_TOKEN`** secret (cross-repo PAT with write access to `woxus-releases`; the workflow
      sets it as `GH_TOKEN` — plain `GITHUB_TOKEN` can't publish cross-repo).
- [ ] `frontend/electron-builder.yml` `publish` block points at `Itsnishant4/woxus-releases`
      with `releaseType: release` (merges all platforms into one published release).
- [ ] The `frontend` folder uses **pnpm** (the workflow runs `pnpm install --frozen-lockfile`). Confirm
      `frontend/pnpm-lock.yaml` is committed and in sync.

> **macOS note:** ad-hoc signed (`identity: "-"`). Updates work for users who already launched the app once
> (right-click → Open clears quarantine). Fresh installs show the Gatekeeper "unidentified developer" step once.

---

## ✅ Release steps

### 1. Make sure `main` is clean

```bash
git checkout main
git pull origin main
git status            # should be clean
```

### 2. Bump the version

Edit `frontend/package.json`:

```json
"version": "0.1.1"
```

> Must be **higher** than the last released version (semver). electron-updater compares versions.

### 3. Commit the version bump

```bash
git add frontend/package.json frontend/package-lock.json
git commit -m "chore: bump version to 0.1.1"
git push origin main
```

### 4. Tag & push (this triggers the release)

```bash
git tag v0.1.1
git push origin v0.1.1
```

> The `v` prefix is **required** — the workflow triggers on `tags: "v*"`.
> `v0.1.1` ✅ · `0.1.1` ❌

### 5. Watch the build

Open: `https://github.com/Itsnishant4/woxus-agent/actions`

There are 6 jobs total (backend + release × mac-arm64, mac-x64, Windows). They run in parallel and take
**~15–30 minutes** (backend PyInstaller + llama.cpp builds are slow).

### 6. Verify the release

Once green, open: `https://github.com/Itsnishant4/woxus-releases/releases`

The `v0.1.13` release should be **published** (not draft) and contain:

| File | Platform | Purpose |
|------|----------|---------|
| `Woxus-0.1.13-arm64.dmg` / `.zip` | macOS arm64 | Installer + updater artifact |
| `Woxus-0.1.13-x64.dmg` / `.zip` | macOS Intel | Installer + updater artifact |
| `Woxus-0.1.13-x64.exe` / `Woxus Setup 0.1.13.exe` | Windows | Installer + updater artifact |
| `latest.yml` / `latest-mac.yml` | All / mac | **Update manifests** — the app reads these to detect new versions |
| `*.blockmap` | All | Differential-update deltas |

> If you don't see `latest*.yml` + `*.blockmap` files, the updater **will not work** — re-check the publish
> config before telling users to update.

---

## 🧪 Testing the updater locally (optional)

You can't test the banner in dev mode — `electron-updater` only runs in **packaged** apps.

### Option A — Real release (recommended)
1. Do a real release (steps above).
2. Install the **previous** version on your machine.
3. Launch → wait ~10s → banner appears → Download → Restart & Update.

### Option B — Local update server (no real release)
```bash
# Serve a local dir as the update feed
cd /path/to/release/artifacts && python3 -m http.server 9000

# Run the app pointing at it
WOXUS_UPDATE_URL=http://localhost:9000 npm run electron:dev -- -- --update-dev
```

---

## Rollback / hotfix

If a release is broken:

```bash
# 1. Fix the code, commit, push
git commit -am "fix: ..."
git push origin main

# 2. Bump version (higher than the broken one)
#    e.g. broken was 0.1.1 → hotfix 0.1.2

# 3. Tag & push
git tag v0.1.2 && git push origin v0.1.2
```

Users on the broken 0.1.1 will see the 0.1.2 update. There's no way to "force" users off a version — you
always release a fixed higher version.

---

## Quick reference

```bash
# One-shot release (0.1.1)
git checkout main && git pull origin main
sed -i '' 's/"version": "0.1.0"/"version": "0.1.1"/' frontend/package.json
git add frontend/package.json frontend/package-lock.json
git commit -m "chore: bump version to 0.1.1"
git push origin main
git tag v0.1.1
git push origin v0.1.1
```

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---------|-------------|-----|
| Workflow doesn't run after `git push origin v...` | Tag missing `v` prefix | `git tag vX.Y.Z && git push origin vX.Y.Z` |
| Release has installers but **no `latest.yml`** | `publish` block wrong / no `GH_TOKEN` | Check `electron-builder.yml` + secrets |
| Users see banner but "Download" fails | macOS unsigned fresh-install | Tell user to right-click → Open once; win/linux fine |
| Build fails on backend job | PyInstaller spec / Python deps | Check `backend/woxus_backend.spec`, `requirements.txt` |
| `pnpm install --frozen-lockfile` fails | Lockfile out of date | Run `pnpm install` locally, commit `pnpm-lock.yaml` |


