<picture>
  <source media="(prefers-color-scheme: dark)" srcset=".github/brand/logo-horizontal-on-dark.png">
  <source media="(prefers-color-scheme: light)" srcset=".github/brand/logo-horizontal-on-light.png">
  <img src=".github/brand/logo-horizontal-on-light.png" alt="Vekrel" width="360">
</picture>

# Vekrel-Desktop
The Electron app that bundles the Vekrel engine and web client. Highly inspired by T3 Code (MIT, see NOTICE).

`apps/web`, `apps/server` and `packages/` are git subtrees of the other Vekrel repos. Each needs a split branch first, because the prefix is not the repo root. The split branches are temporary; delete them afterwards.
```bash
# in Vekrel-Web / Vekrel-Engine / Vekrel-Shared
git subtree split --prefix=apps/web    -b split-web        # Vekrel-Web
git subtree split --prefix=apps/server -b split-server     # Vekrel-Engine
git subtree split --prefix=packages    -b split-packages   # Vekrel-Shared
# in this repo (first time: add; later updates: pull)
git subtree add  --prefix=apps/web    <path-to-Vekrel-Web>    split-web      --squash
git subtree add  --prefix=apps/server <path-to-Vekrel-Engine> split-server   --squash
git subtree add  --prefix=packages    <path-to-Vekrel-Shared> split-packages --squash
git subtree pull --prefix=<same prefix> <same path> <same branch> --squash
# afterwards, in each source repo
git branch -D split-web   # split-server / split-packages
```
Last pulled from: Vekrel-Web `b5042d1` (apps/web), Vekrel-Engine `9d2e2ab` (apps/server), Vekrel-Shared `06cde1f` (packages/). After a pull, `diff -rq -x node_modules -x dist <prefix> <source>/<prefix>` should be empty except the `apps/server` hunks listed under Deviations.

## Deviations from upstream T3 Code 8d3b061
- Root package is `@vekrel/desktop-root`; desktop package is `@vekrel/desktop`, product name `Vekrel`. The upstream npm scope, env prefix (`T3CODE_` to `VEKREL_`) and product name ("T3 Code", including the Beta/Dev/Nightly labels) are replaced in `apps/desktop` and `scripts/build-desktop-artifact.ts`.
- App id is `dev.vekrel.desktop` (`dev.vekrel.Desktop` replaces the upstream CamelCase `com.t3tools.T3Code` desktop-entry and D-Bus spelling, so the two spellings stay distinct). The Linux metainfo file is `dev.vekrel.desktop.metainfo.xml`.
- URL scheme is `vekrel://` (`vekrel-dev://` in development) instead of `t3code://`. Also changed in the subtrees; see "Synced to Vekrel-Shared / Vekrel-Engine".
- Electron user-data directories, Linux WM class, executable name and desktop-file names changed `t3code` to `vekrel`, so Vekrel does not share state with an installed T3 Code. The default home is `~/.vekrel` (upstream `~/.t3`). The `t3code/*` lint rule namespace is unchanged.
- Internal identifiers (CLI shim and command `vekrel`, `VEKREL_*` env vars, `~/.vekrel/wsl-runtime`, the `vekrel` runtime executable, `vekrel-desktop` telemetry service, release tooling and npm launcher names) follow the Engine rename; see Vekrel-ArchBoss `.superpowers/sdd/2026-10-23-plan-6/rename-identifiers-report.md`. Round 2 renamed browser partitions (`persist:vekrel-preview-*`), localStorage keys (`vekrel:*`), `data-vekrel-*` attributes, `--vekrel-dev-root` and `vekrelCommitHash`; earlier preview sessions and drafts are not carried over.
- Icons: `assets/{prod,dev}/` hold generated files under the upstream file names (`scripts/lib/brand-assets.ts` still points at them, including `t3-black-windows.ico`). The 1024 px macOS icon is Vekrel-ArchBoss `brand/mark.svg` at 824 px centered on a transparent canvas (100 px inset), rendered with `sharp` (the upstream export script needs the macOS Icon Composer `.icon` sources, which are not copied). The universal PNG is `org-avatar.svg`, full-bleed; the Windows ICO holds 16-256 px PNG entries; web favicons are rendered from `favicon.svg`. Dev uses the same artwork as prod. `assets/nightly` is not generated. At stage time the build script makes `icon.icns` from the macOS PNG with `sips` and `iconutil`.
- `pnpm-lock.yaml` is upstream's, with the scope renamed, then reconciled by `pnpm install`. `scripts` stays a workspace member (desktop's vite config and tsconfig import `scripts/lib`); `infra/*` is not.
- `apps/server`: the `build` task depends on `@vekrel/web#build` again and `@vekrel/web` is a devDependency again, because web lives in this repo. `apps/desktop/vite.config.ts` depends on `vekrel-engine#build` (upstream `t3#build`).
- Files copied only so the web licence plugin and the server icon step find their inputs: `third-party-licenses.config.json`, `apps/mobile/modules/{t3-composer-editor,t3-source-text}/LICENSE`. `native/` is a full copy of upstream's (not a pnpm workspace member upstream either; Rust crates build with cargo, so put `~/.cargo/bin` on PATH).
- Mac artifact: `artifactName` in `scripts/build-desktop-artifact.ts` is `Vekrel-${version}-${arch}.${ext}` (was `T3-Code-...`). Build unsigned with `VEKREL_DESKTOP_SKIP_BUILD=true pnpm dist:desktop:dmg` after `pnpm build:desktop`; signing and notarization stay off because `VEKREL_DESKTOP_SIGNED` defaults to false (`--signed` enables it). Output goes to `release/` (git-ignored).
- `apps/desktop` has no `typecheck` package script upstream; run `pnpm exec vp run typecheck` inside `apps/desktop`.
- Tests: two `DesktopLinuxUrlHandler` icon tests fail on case-insensitive filesystems (macOS APFS) because they use two spellings that differ only in case; upstream has the same spellings.
- Accounts: no Clerk (`@clerk/electron`, `@clerk/electron-passkeys` removed; the CSP no longer allows the Clerk frontend API or `challenges.cloudflare.com`). Sign-in opens the system browser at the Vekrel relay's `/oauth/authorize` (client `vekrel-desktop`, PKCE S256, redirect `vekrel://auth/callback`, `vekrel-dev://` in development); `app/DesktopAccount.ts` takes the callback (a foreign `state` is ignored) and redeems the code. The session lives in the main process, because the relay's `/oauth/token` answers cross-origin only to the web app: the preload exposes `window.desktopAccount` (`startSignIn`, `getAccessToken`, `signOut`), and the refresh token never reaches the renderer. It is stored encrypted with `safeStorage` in `<stateDir>/account-refresh-token.bin` (mode 0600); without OS encryption (or with Linux `basic_text`) it is kept in memory only, so the next launch starts signed out. Sign-out revokes at the relay, then deletes the file. The relay URL is the build-time `VEKREL_RELAY_URL`. `app/DesktopClerk.ts` became `app/DesktopDeepLinks.ts` (userData, single-instance lock, link routing, now also `setAsDefaultProtocolClient`).
- Removed `patchedDependencies` entries (and patch files) for packages not installed here: the Expo, React Native, Clerk-native, alchemy and react-navigation patches. Kept: mdast-util-math, micromark-extension-llm-math, micromark-extension-gfm-table, @effect/vitest, @ff-labs/fff-node, @legendapp/list, @pierre/diffs, dbus-next, node-pty, app-builder-lib.
- The "environment" concept (a host the client connects to) is called "machine" in `apps/desktop`, `apps/web`, `apps/server` and `packages/`: IPC channels are `desktop:*-machine*` and `fetch-machine-descriptor`, files `DesktopSavedMachines`, `DesktopLocalMachineAuth`, `DesktopSshMachine`, `ipc/methods/{localMachine,sshMachine}`. Process env keeps its names (`DesktopEnvironment`, `DesktopShellEnvironment`, `DesktopWslEnvironment`), and so does the legacy migration source file `saved-environments.json`.


## Synced to Vekrel-Shared / Vekrel-Engine
URL-scheme edits made here and committed in the source repos (Shared `cba8d1d`, Engine `47d3d67`), so the next subtree pull is clean:
- Vekrel-Shared `packages/shared/src/`: `codexAuthHandoff.ts`, `promptLinks.ts`, `promptLinks.test.ts`, `providerAuthReturnUrl.ts`, `providerAuthReturnUrl.test.ts`.
- Vekrel-Engine `apps/server/src/`: `httpCors.ts`, `auth/MachineAuth.test.ts` (was `EnvironmentAuth.test.ts`).

## Left as upstream
- `T3 Tools Inc.` developer name, `t3.codes` and `pingdotgg/t3code` URLs (metainfo, gnome-extension manifest, package metadata).
- Metainfo `project_license` is still `MIT`.
- CLI name `t3`.
- `assets/prod/t3-black-windows.ico` filename (and the other `t3-black-*` names).
- Nightly icons (`assets/nightly` not generated).
- Two `DesktopLinuxUrlHandler` icon tests fail on case-insensitive filesystems (macOS APFS): the spellings `dev.vekrel.desktop` and `dev.vekrel.Desktop` collide, as the upstream ones do.
