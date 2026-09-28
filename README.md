# Time Cube

Upload a video or GIF and explore it as a 3D "time cube": every frame is a slice stacked in depth. Scroll to move through time — frames you pass fade away while the upcoming frames stay visible behind the current one.

## Run

```bash
node serve.mjs
```

Then open http://localhost:5173. No build step or dependencies (Three.js and gifuct-js load from a CDN).

## Controls

- **Scroll / trackpad** — move through frames
- **Drag** — rotate the cube
- **Pinch / ctrl+scroll** — zoom
- **← / →** — step one frame, **space** — play/pause, **R** — reset view
- Bottom-right dock: **hand** — scroll moves through time (default) · **magnifier** — scroll zooms instead · **orbit** — auto-spin · **eye** — hide/show all controls (also **H**)
- Panel: frame count, spacing between slices, how many frames are visible behind, ghost opacity, additive blending (multiply on light backgrounds), outline, background colour (presets + custom picker). The outline is always the complement of the background — white on black, black on white.
