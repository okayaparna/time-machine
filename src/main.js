import * as THREE from 'three';
import { extractFrames, demoFrames } from './frames.js';

const $ = (id) => document.getElementById(id);
const canvas = $('stage');

// ---------- scene ----------
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setClearColor(0x000000);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(38, 1, 0.01, 200);

// pivot rotates around the current frame; stack slides along z to bring each frame to the pivot.
const pivot = new THREE.Group();
const stack = new THREE.Group();
pivot.add(stack);
scene.add(pivot);

const DEFAULT_ROT = { x: 0.28, y: -0.62 };

const state = {
  planes: [],
  aspect: 1,
  pos: 0, // current (smoothed) frame index
  target: 0, // frame index the user is scrolling toward
  rot: { ...DEFAULT_ROT },
  rotTarget: { ...DEFAULT_ROT },
  zoom: 1,
  zoomTarget: 1,
  offset: 0,
  playing: false,
  file: null,
  loadToken: 0,
  wheelMode: 'time', // what a plain scroll does: 'time' or 'zoom'
  autoSpin: false,
  lightBg: false,
  bg: '#000000',
};

const settings = {
  frames: +$('frames').value,
  spacing: +$('spacing').value,
  depth: +$('depth').value,
  opacity: +$('opacity').value,
  additive: $('additive').checked,
  outline: $('outline').checked,
};

const planeGeo = new THREE.PlaneGeometry(1, 1);
const outlineMat = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.45 });
const cubeOutline = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1)), outlineMat);
stack.add(cubeOutline);

const currentBorder = new THREE.LineLoop(
  new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(-0.5, -0.5, 0),
    new THREE.Vector3(0.5, -0.5, 0),
    new THREE.Vector3(0.5, 0.5, 0),
    new THREE.Vector3(-0.5, 0.5, 0),
  ]),
  new THREE.LineBasicMaterial({ color: 0xffffff })
);
currentBorder.renderOrder = 1e6;
pivot.add(currentBorder);

// ---------- building the cube ----------
function clearPlanes() {
  for (const p of state.planes) {
    stack.remove(p);
    p.material.map.dispose();
    p.material.dispose();
  }
  state.planes = [];
}

function setSource(name, type, frames) {
  $('sourceName').textContent = name;
  $('sourceName').title = name;
  $('sourceMeta').textContent = `${type} · ${frames.length} frames · ${frames[0].width} × ${frames[0].height}`;
}

function buildPlanes(frames) {
  clearPlanes();
  const { width, height } = frames[0];
  state.aspect = width / height;
  // normalise so the longest side is 2 units
  const sx = state.aspect >= 1 ? 2 : 2 * state.aspect;
  const sy = state.aspect >= 1 ? 2 / state.aspect : 2;

  frames.forEach((c) => {
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.minFilter = THREE.LinearFilter;
    tex.generateMipmaps = false;
    const mat = new THREE.MeshBasicMaterial({
      map: tex,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(planeGeo, mat);
    mesh.scale.set(sx, sy, 1);
    stack.add(mesh);
    state.planes.push(mesh);
  });

  currentBorder.scale.set(sx, sy, 1);
  state.pos = state.target = 0;

  const n = frames.length;
  $('timeline').max = n - 1;
  $('depth').max = n;
  if (settings.depth > n) setDepth(n);
  paintRange($('depth'));
  applyLayout();
  applyBlend();
}

function applyLayout() {
  const n = state.planes.length;
  const s = settings.spacing;
  state.planes.forEach((p, i) => (p.position.z = -i * s));

  const first = state.planes[0];
  if (first) {
    const len = Math.max(0.001, (n - 1) * s);
    cubeOutline.scale.set(first.scale.x, first.scale.y, len);
    cubeOutline.position.z = -len / 2;
  }
  cubeOutline.visible = settings.outline && n > 1;
  currentBorder.visible = settings.outline && n > 0;
}

// Additive glows on dark backgrounds but saturates to white on light ones, so light
// backgrounds get the mirror image: an opacity-weighted multiply, dst * mix(1, src, a).
function applyBlend() {
  const multiply = settings.additive && state.lightBg;
  $('blendLabel').textContent = state.lightBg ? 'Multiply blend' : 'Additive blend';
  for (const p of state.planes) {
    const m = p.material;
    m.premultipliedAlpha = multiply; // shader outputs rgb * a
    if (multiply) {
      m.blending = THREE.CustomBlending;
      m.blendEquation = THREE.AddEquation;
      m.blendSrc = THREE.DstColorFactor;
      m.blendDst = THREE.OneMinusSrcAlphaFactor;
    } else {
      m.blending = settings.additive ? THREE.AdditiveBlending : THREE.NormalBlending;
    }
    m.needsUpdate = true;
  }
}

// Opacity for a frame `d` frames away from the current one (negative = already scrolled past).
function frameOpacity(d) {
  if (d < 0) return Math.max(0, 1 + d * 1.4); // fades out as it flies past the viewer
  if (d < 1) return 1 + (settings.opacity - 1) * d; // current -> ghost
  const falloff = 1 - (d - 1) / Math.max(1, settings.depth - 1);
  return settings.opacity * Math.max(0, falloff) ** 1.2;
}

// ---------- loading ----------
function showStatus(msg) {
  const el = $('status');
  el.textContent = msg || '';
  el.classList.toggle('show', !!msg);
}

async function loadFile(file) {
  state.file = file;
  const token = ++state.loadToken;
  showStatus('Reading frames… 0%');
  try {
    const frames = await extractFrames(file, settings.frames, (p) => {
      if (token === state.loadToken) showStatus(`Reading frames… ${Math.round(p * 100)}%`);
    });
    if (token !== state.loadToken) return;
    buildPlanes(frames);
    const isGif = file.type === 'image/gif' || /\.gif$/i.test(file.name);
    setSource(file.name.replace(/\.[^.]+$/, ''), isGif ? 'GIF' : 'Video', frames);
    showStatus('');
  } catch (err) {
    if (token !== state.loadToken) return;
    console.error(err);
    showStatus(err.message || 'Could not read that file.');
    setTimeout(() => showStatus(''), 3500);
  }
}

function loadDemo(keepPosition = false) {
  state.file = null;
  state.loadToken++;
  const { pos, target } = state;
  const frames = demoFrames(Math.min(settings.frames, 120), state.bg, '#' + oppositeColor(state.bg).getHexString());
  buildPlanes(frames);
  if (keepPosition) Object.assign(state, { pos, target });
  setSource('Demo sequence', 'Procedural', frames);
}

// ---------- controls ----------
function paintRange(el) {
  const min = +el.min;
  const max = +el.max;
  const p = max > min ? ((+el.value - min) / (max - min)) * 100 : 0;
  el.style.setProperty('--p', p + '%');
}

function bindRange(id, key, fmt, onChange) {
  const el = $(id);
  const label = $(id + 'Val');
  const sync = () => {
    settings[key] = +el.value;
    label.textContent = fmt(settings[key]);
    paintRange(el);
  };
  sync();
  el.addEventListener('input', () => {
    sync();
    onChange?.('input');
  });
  el.addEventListener('change', () => onChange?.('change'));
}

function setDepth(v) {
  $('depth').value = v;
  settings.depth = v;
  $('depthVal').textContent = v;
  paintRange($('depth'));
}

bindRange('frames', 'frames', (v) => v, (ev) => {
  if (ev !== 'change') return;
  state.file ? loadFile(state.file) : loadDemo();
});
bindRange('spacing', 'spacing', (v) => v.toFixed(3), applyLayout);
bindRange('depth', 'depth', (v) => v);
bindRange('opacity', 'opacity', (v) => Math.round(v * 100) + '%');

$('additive').addEventListener('change', (e) => {
  settings.additive = e.target.checked;
  applyBlend();
});
$('outline').addEventListener('change', (e) => {
  settings.outline = e.target.checked;
  applyLayout();
});

function setPlaying(on) {
  state.playing = on;
  $('playLabel').textContent = on ? 'Pause' : 'Play';
}
$('play').addEventListener('click', () => setPlaying(!state.playing));
function resetView() {
  state.rotTarget = { ...DEFAULT_ROT };
  state.zoomTarget = 1;
}
$('resetView').addEventListener('click', resetView);

// Outline colour = the background's opposite: hue rotated 180°, lightness inverted
// (black -> white, white -> black). Falls back to black/white when that would be too close.
function oppositeColor(hex) {
  const c = new THREE.Color(hex);
  const hsl = {};
  c.getHSL(hsl);
  let l = 1 - hsl.l;
  if (Math.abs(l - hsl.l) < 0.4) l = hsl.l < 0.5 ? 0.95 : 0.05;
  return new THREE.Color().setHSL((hsl.h + 0.5) % 1, hsl.s, l);
}

// background colour: swatches + free picker
let demoRedraw = 0;
function setBackground(hex) {
  state.bg = hex;
  renderer.setClearColor(hex);
  const line = oppositeColor(hex);
  outlineMat.color.copy(line);
  currentBorder.material.color.copy(line);
  const root = document.documentElement;
  root.style.setProperty('--bg', hex);
  // glass UI follows the background: light chrome on light backgrounds
  const bg = new THREE.Color(hex);
  const luma = 0.2126 * bg.r + 0.7152 * bg.g + 0.0722 * bg.b;
  state.lightBg = luma > 0.5;
  root.dataset.theme = state.lightBg ? 'light' : 'dark';
  applyBlend();
  if (!state.file && state.planes.length) {
    clearTimeout(demoRedraw);
    demoRedraw = setTimeout(() => !state.file && loadDemo(true), 80);
  }
  $('bgColor').value = hex;
  for (const s of document.querySelectorAll('.swatch')) {
    s.classList.toggle('active', s.dataset.color ? s.dataset.color === hex : !isPreset(hex));
  }
}
const isPreset = (hex) => [...document.querySelectorAll('.swatch[data-color]')].some((s) => s.dataset.color === hex);
for (const s of document.querySelectorAll('.swatch[data-color]')) {
  s.addEventListener('click', () => setBackground(s.dataset.color));
}
$('bgColor').addEventListener('input', (e) => setBackground(e.target.value));
setBackground('#000000');

// hide / show every control except the toggle itself
const EYE = '<path d="M1.5 10S4.5 4 10 4s8.5 6 8.5 6-3 6-8.5 6-8.5-6-8.5-6Z"/><circle cx="10" cy="10" r="2.5"/>';
const EYE_OFF = EYE + '<path d="M3 3l14 14"/>';

function setUIHidden(hidden) {
  $('ui').classList.toggle('hidden', hidden);
  $('dock').classList.toggle('collapsed', hidden);
  // eye-slash = "hide" action while visible; plain eye = "show" once collapsed
  $('hideIcon').innerHTML = hidden ? EYE : EYE_OFF;
  const label = hidden ? 'Show controls' : 'Hide controls';
  $('hideUI').setAttribute('aria-label', label);
  $('hideUI').dataset.tip = `${label} (H)`;
  for (const b of document.querySelectorAll('#dock .tool')) b.tabIndex = hidden ? -1 : 0;
  hideTip();
}

function setWheelMode(mode) {
  state.wheelMode = mode;
  $('modeTime').setAttribute('aria-pressed', mode === 'time');
  $('modeZoom').setAttribute('aria-pressed', mode === 'zoom');
}
$('modeTime').addEventListener('click', () => setWheelMode('time'));
$('modeZoom').addEventListener('click', () => setWheelMode(state.wheelMode === 'zoom' ? 'time' : 'zoom'));
$('spin').addEventListener('click', () => {
  state.autoSpin = !state.autoSpin;
  $('spin').setAttribute('aria-pressed', state.autoSpin);
});

// tooltips sit to the left of the dock, level with the hovered button
function showTip(btn) {
  const tip = $('tip');
  const b = btn.getBoundingClientRect();
  const dock = $('dock').getBoundingClientRect();
  tip.textContent = btn.dataset.tip;
  tip.style.right = window.innerWidth - (btn.id === 'hideUI' && $('dock').classList.contains('collapsed') ? b.left : dock.left) + 8 + 'px';
  tip.style.top = b.top + b.height / 2 + 'px';
  tip.classList.add('show');
}
function hideTip() {
  $('tip').classList.remove('show');
}
for (const btn of document.querySelectorAll('#dock .icon-btn')) {
  btn.addEventListener('pointerenter', () => showTip(btn));
  btn.addEventListener('focus', () => btn.matches(':focus-visible') && showTip(btn));
  btn.addEventListener('pointerleave', hideTip);
  btn.addEventListener('blur', hideTip);
}
setUIHidden(false);
$('hideUI').addEventListener('click', () => setUIHidden(!$('ui').classList.contains('hidden')));

$('timeline').addEventListener('input', (e) => {
  setPlaying(false);
  state.target = +e.target.value;
});

$('file').addEventListener('change', (e) => {
  const f = e.target.files?.[0];
  if (f) loadFile(f);
  e.target.value = '';
});

// drag & drop
let dragDepth = 0;
window.addEventListener('dragenter', (e) => {
  e.preventDefault();
  dragDepth++;
  $('drop').classList.add('show');
});
window.addEventListener('dragleave', () => {
  if (--dragDepth <= 0) $('drop').classList.remove('show');
});
window.addEventListener('dragover', (e) => e.preventDefault());
window.addEventListener('drop', (e) => {
  e.preventDefault();
  dragDepth = 0;
  $('drop').classList.remove('show');
  const f = e.dataTransfer.files?.[0];
  if (f) loadFile(f);
});

// scroll = move through time; ctrl/pinch = zoom
canvas.addEventListener(
  'wheel',
  (e) => {
    e.preventDefault();
    const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1;
    if (e.ctrlKey || state.wheelMode === 'zoom') {
      // pinch deltas are small; mouse-wheel deltas are ~100 per notch
      const rate = e.ctrlKey ? 0.01 : 0.0025;
      state.zoomTarget = THREE.MathUtils.clamp(state.zoomTarget * Math.exp(e.deltaY * unit * rate), 0.3, 4);
      return;
    }
    setPlaying(false);
    const delta = (Math.abs(e.deltaY) > Math.abs(e.deltaX) ? e.deltaY : e.deltaX) * unit;
    state.target = clampFrame(state.target + delta / 40);
  },
  { passive: false }
);

// drag = rotate the cube
let drag = null;
canvas.addEventListener('pointerdown', (e) => {
  drag = { x: e.clientX, y: e.clientY };
  canvas.setPointerCapture(e.pointerId);
  canvas.classList.add('dragging');
});
canvas.addEventListener('pointermove', (e) => {
  if (!drag) return;
  state.rotTarget.y += (e.clientX - drag.x) * 0.006;
  state.rotTarget.x = THREE.MathUtils.clamp(state.rotTarget.x + (e.clientY - drag.y) * 0.006, -1.4, 1.4);
  drag = { x: e.clientX, y: e.clientY };
});
const endDrag = () => {
  drag = null;
  canvas.classList.remove('dragging');
};
canvas.addEventListener('pointerup', endDrag);
canvas.addEventListener('pointercancel', endDrag);

window.addEventListener('keydown', (e) => {
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  if (e.target.tagName === 'INPUT' && e.target.type !== 'checkbox') return;
  if (e.key === 'ArrowRight' || e.key === 'ArrowDown') state.target = clampFrame(Math.round(state.target) + 1);
  else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') state.target = clampFrame(Math.round(state.target) - 1);
  else if (e.key === ' ') setPlaying(!state.playing);
  else if (e.key === 'h' || e.key === 'H') setUIHidden(!$('ui').classList.contains('hidden'));
  else if (e.key === 'r' || e.key === 'R') resetView();
  else return;
  e.preventDefault();
});

function clampFrame(v) {
  return THREE.MathUtils.clamp(v, 0, Math.max(0, state.planes.length - 1));
}

// ---------- render loop ----------
function resize() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
resize();

const clock = new THREE.Clock();
let lastCounter = '';

function tick() {
  const dt = Math.min(clock.getDelta(), 0.1);
  const n = state.planes.length;

  if (state.playing && n > 1) {
    state.target += dt * 24;
    if (state.target > n - 1) state.target = state.pos = 0;
  }

  const k = 1 - Math.exp(-dt * 12);
  state.pos += (state.target - state.pos) * k;
  if (state.autoSpin && !drag) state.rotTarget.y += dt * 0.4;
  state.rot.x += (state.rotTarget.x - state.rot.x) * k;
  state.rot.y += (state.rotTarget.y - state.rot.y) * k;
  state.zoom += (state.zoomTarget - state.zoom) * k;

  pivot.rotation.set(state.rot.x, state.rot.y, 0);
  stack.position.z = state.pos * settings.spacing;

  for (let i = 0; i < n; i++) {
    const p = state.planes[i];
    const o = frameOpacity(i - state.pos);
    p.visible = o > 0.004;
    p.material.opacity = o;
  }

  // centre the cube in the space left of the panel (desktop layout only)
  const w = window.innerWidth;
  const h = window.innerHeight;
  const panel = $('panel').getBoundingClientRect();
  const sidePanel = !$('ui').classList.contains('hidden');
  const reserve = sidePanel ? w - panel.left : 0;
  state.offset += (reserve / 2 - state.offset) * k;
  camera.setViewOffset(w, h, state.offset, 0, w, h);

  // keep the frame comfortably in view regardless of window shape
  const freeAspect = (w - reserve) / h;
  const fit = freeAspect < state.aspect ? state.aspect / freeAspect : 1;
  camera.position.set(0, 0, 5.2 * fit * state.zoom);
  camera.lookAt(0, 0, 0);

  const counter = `${n ? Math.round(state.pos) + 1 : 0} / ${n}`;
  if (counter !== lastCounter) {
    $('counter').textContent = counter;
    lastCounter = counter;
  }
  if (document.activeElement !== $('timeline')) $('timeline').value = state.pos;
  paintRange($('timeline'));

  renderer.render(scene, camera);
  requestAnimationFrame(tick);
}

loadDemo();
tick();
