# Calmnova Code branding assets

Approved source artwork lives in `build/branding/` and is the only source for generated native and renderer assets.

- App icon master: `branding/app-icon-1024.png` (high-resolution square source; currently 1254 px).
- Standalone mark: `branding/symbol.png`.
- Theme wordmarks: `branding/logo-light.png` and `branding/logo-dark.png`.
- Supplied lockup sources: `branding/logo-light-subtitle.png` and `branding/logo-dark-subtitle.png`.
- Supplied standalone subtitle: `branding/subtitle.png`.

Generated outputs:

- `build/icon.icns`: macOS 16–1024 px iconset container.
- `build/icon.ico`: Windows 16, 24, 32, 48, 64, 128, and 256 px icon container.
- `src/renderer/assets/branding/`: cropped, size-optimized symbol and light/dark wordmarks.

Run `pnpm branding:generate` on macOS after approved source artwork changes. Run `pnpm branding:verify` on any supported host before packaging. The renderer must use `BrandLogo.vue`; do not copy or CSS-filter the artwork in individual views.
