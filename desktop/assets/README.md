# Rivet macOS icon

`rivet-icon.svg` uses the actual Lucide Compass component from the Rivet rail. The rounded tile is 824×824px on a 1024×1024 canvas, with 100px transparent margins. This matches the visible tile bounds measured from the installed Finder and Brave icons. The compass remains centered at 18×18 units inside the tile's 24×24 coordinate system, preserving its existing proportions. Tile and mark colours come from the UI's `--surface` and `--primary` tokens in `src/styles.css` and `src/app/appearance.css`, converted from OKLCH to sRGB. All fills are flat, without lighting, gradients, bevels or shadows.

`rivet-icon.png` and `rivet-icon-1024.png` are the 1024px exports. `Rivet.icns` is the native build asset. `node scripts/build-app-icon.mjs` refreshes the SVG directly from the UI, rasterises each size with AppKit in sRGB, and builds the complete 16–1024px Retina family with `iconutil`. No image-generation service or third-party raster library is needed.

The generator also builds twelve 1024px PNGs under `icons/` and `public/app-icons/`: six main colours, each in light and dark mode. `icons/manifest.json` records their exact sRGB fills. The main process updates the running macOS Dock icon when appearance changes and mirrors preferences in local SQLite so the next launch starts with the saved icon. System mode follows macOS; explicit light/dark choices override it. Web favicons and touch icons follow the same preferences.

The package names its ICNS resource `Rivet-<content hash>.icns` and advances `CFBundleVersion` on each successful package so macOS can distinguish it from cached builds. Finder and Spotlight use this static dark Crimson bundle icon; live appearance changes apply to the running Dock icon. The package includes all native and web variants.
