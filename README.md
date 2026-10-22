# Vekrel-Desktop
The Electron app that bundles the Vekrel engine and web client; derived from T3 Code (MIT, see NOTICE).

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

## Deviations from upstream T3 Code 8d3b061
- Root package is `@vekrel/desktop-root`; desktop package is `@vekrel/desktop`, product name `Vekrel`. The upstream npm scope, env prefix (`T3CODE_` to `VEKREL_`) and product name ("T3 Code", including the Beta/Dev/Nightly labels) are replaced in `apps/desktop` and `scripts/build-desktop-artifact.ts`.
- App id is `dev.vekrel.desktop` (`dev.vekrel.Desktop` replaces the upstream CamelCase `com.t3tools.T3Code` desktop-entry and D-Bus spelling, so the two spellings stay distinct). The Linux metainfo file is `dev.vekrel.desktop.metainfo.xml`.
- URL scheme is `vekrel://` (`vekrel-dev://` in development) instead of `t3code://`. Also changed outside `apps/desktop`: `packages/shared` (`promptLinks`, `codexAuthHandoff`, `providerAuthReturnUrl` and tests) and `apps/server/src/httpCors.ts` plus one test. These edits are not in Vekrel-Shared or Vekrel-Engine yet; apply them there before the next subtree pull.
- Electron user-data directories, Linux WM class, executable name and desktop-file names changed `t3code` to `vekrel`, so Vekrel does not share state with an installed T3 Code. Renderer localStorage keys (`t3code:*`), the `t3code/*` lint rule namespace, DOM `data-t3code-*` attributes and the `--t3code-dev-root` flag are unchanged.
- Icons: `assets/{prod,dev}/` hold generated files under the upstream file names (`scripts/lib/brand-assets.ts` still points at them, including `t3-black-windows.ico`). The 1024 px macOS icon is `brand/mark-on-dark.svg` on a `#111111` rounded square, rendered with `sharp` (the upstream export script needs the macOS Icon Composer `.icon` sources, which are not copied). The universal PNG is full-bleed; the Windows ICO holds 16-256 px PNG entries; web favicons are copied from Vekrel-Web. Dev uses the same artwork as prod. `assets/nightly` is not generated. At stage time the build script makes `icon.icns` from the macOS PNG with `sips` and `iconutil`.
- `pnpm-lock.yaml` is upstream's, with the scope renamed, then reconciled by `pnpm install`. `scripts` stays a workspace member (desktop's vite config and tsconfig import `scripts/lib`); `infra/*` is not.
- `apps/server`: the `build` task depends on `@vekrel/web#build` again and `@vekrel/web` is a devDependency again, because web lives in this repo. `apps/desktop/vite.config.ts` depends on `vekrel-engine#build` (upstream `t3#build`).
- Files copied only so the web licence plugin and the server icon step find their inputs: `third-party-licenses.config.json`, `native/libghostty-vt/{LICENSE,VERSION,include/}`, `apps/mobile/modules/{t3-composer-editor,t3-source-text}/LICENSE`. The resource-monitor crate under `native/` is not copied, so `pnpm dist:desktop:*` (needs Rust and that crate) does not run yet.
- `apps/desktop` has no `typecheck` package script upstream; run `pnpm exec vp run typecheck` inside `apps/desktop`.
- Tests: two `DesktopLinuxUrlHandler` icon tests fail on case-insensitive filesystems (macOS APFS) because they use two spellings that differ only in case; upstream has the same spellings.
- Removed `patchedDependencies` entries (and patch files) for packages not installed here: the Expo, React Native, Clerk-native, alchemy and react-navigation patches. Kept: mdast-util-math, micromark-extension-llm-math, micromark-extension-gfm-table, @effect/vitest, @ff-labs/fff-node, @legendapp/list, @pierre/diffs, dbus-next, node-pty, app-builder-lib.
- Still upstream: `T3 Tools Inc.` developer, `t3.codes` and `pingdotgg/t3code` URLs in the metainfo, gnome-extension manifest and package metadata; metainfo `project_license` is still `MIT`; the CLI name `t3`.
