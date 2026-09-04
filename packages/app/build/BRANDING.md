# Calmnova Code branding assets

The current `icon.ico` is a temporary inherited application icon. It is not the final Calmnova Code logo.

Before a public release, replace it with approved Calmnova artwork and add platform-native sources:

- Windows: `icon.ico`, including 16, 24, 32, 48, 64, 128, and 256 px layers.
- macOS: `icon.icns`, including the full 16–1024 px iconset.
- Linux: PNG icons at 16, 32, 48, 64, 128, 256, 512, and 1024 px.
- Renderer and onboarding: an SVG wordmark plus light/dark symbol variants.

Keep source artwork outside generated `dist/` and `release/` directories. Packaging configuration should reference files in this directory.
