# Rivet macOS icon

`rivet-icon.svg` uses the actual Lucide Compass component from the Rivet rail. The rounded tile extends to all four canvas edges, with no surrounding transparent padding. The tile and mark use the default dark UI's `--surface` and `--primary` tokens from `src/styles.css`, converted from OKLCH to sRGB. All fills are flat, without lighting, gradients, bevels or shadows.

`rivet-icon.png` and `rivet-icon-1024.png` are the 1024px exports. `Rivet.icns` is the native build asset. `node scripts/build-app-icon.mjs` refreshes the SVG directly from the UI, rasterises each size with AppKit in sRGB, and builds the complete 16–1024px Retina family with `iconutil`. No image-generation service or third-party raster library is needed.

The package names its ICNS resource `Rivet-<content hash>.icns` and advances `CFBundleVersion` on each successful package so macOS can distinguish it from cached builds. The main process explicitly loads the same PNG into the running Dock icon. Web, touch and native icon assets come from this one vector; the package copies the current images into its renderer rather than retaining the old web artwork.
