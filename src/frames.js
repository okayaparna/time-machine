// Turns an uploaded file into an array of same-sized canvases, one per frame.

const MAX_SIDE = 512; // downscale so hundreds of frames fit in GPU memory

function fitSize(w, h) {
  const s = Math.min(1, MAX_SIDE / Math.max(w, h));
  return [Math.max(1, Math.round(w * s)), Math.max(1, Math.round(h * s))];
}

function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

export async function extractFrames(file, maxFrames, onProgress = () => {}) {
  const isGif = file.type === 'image/gif' || /\.gif$/i.test(file.name);
  return isGif ? framesFromGif(file, maxFrames, onProgress) : framesFromVideo(file, maxFrames, onProgress);
}

async function framesFromVideo(file, maxFrames, onProgress) {
  const url = URL.createObjectURL(file);
  const video = document.createElement('video');
  video.muted = true;
  video.playsInline = true;
  video.preload = 'auto';
  video.src = url;

  try {
    await new Promise((resolve, reject) => {
      video.onloadeddata = resolve;
      video.onerror = () => reject(new Error('This browser could not decode that video.'));
    });

    const duration = video.duration;
    if (!isFinite(duration) || duration <= 0) throw new Error('Video has no readable duration.');

    // Sample at most ~30fps worth of frames, capped by the user's frame budget.
    const count = Math.max(2, Math.min(maxFrames, Math.round(duration * 30)));
    const [w, h] = fitSize(video.videoWidth, video.videoHeight);
    const frames = [];

    for (let i = 0; i < count; i++) {
      const t = Math.min(duration - 0.001, ((i + 0.5) / count) * duration);
      await seek(video, t);
      const c = makeCanvas(w, h);
      c.getContext('2d').drawImage(video, 0, 0, w, h);
      frames.push(c);
      onProgress((i + 1) / count);
    }
    return frames;
  } finally {
    URL.revokeObjectURL(url);
  }
}

function seek(video, t) {
  return new Promise((resolve) => {
    const done = () => {
      video.removeEventListener('seeked', done);
      resolve();
    };
    video.addEventListener('seeked', done);
    video.currentTime = t;
  });
}

async function framesFromGif(file, maxFrames, onProgress) {
  const { parseGIF, decompressFrames } = await import('gifuct-js');
  const gif = parseGIF(await file.arrayBuffer());
  const raw = decompressFrames(gif, true);
  if (!raw.length) throw new Error('That GIF has no frames.');

  const W = gif.lsd.width;
  const H = gif.lsd.height;
  const [w, h] = fitSize(W, H);

  // GIF frames are patches over the previous frame, so composite them in order.
  const full = makeCanvas(W, H);
  const fctx = full.getContext('2d');
  const patch = makeCanvas(1, 1);
  const pctx = patch.getContext('2d');

  const step = raw.length / Math.min(raw.length, maxFrames);
  const keep = new Set();
  for (let k = 0; k < raw.length; k += step) keep.add(Math.floor(k));

  const frames = [];
  let prev = null;
  let restore = null;

  for (let i = 0; i < raw.length; i++) {
    const f = raw[i];

    if (prev) {
      if (prev.disposalType === 2) {
        fctx.clearRect(prev.dims.left, prev.dims.top, prev.dims.width, prev.dims.height);
      } else if (prev.disposalType === 3 && restore) {
        fctx.putImageData(restore, 0, 0);
      }
    }
    if (f.disposalType === 3) restore = fctx.getImageData(0, 0, W, H);

    patch.width = f.dims.width;
    patch.height = f.dims.height;
    pctx.putImageData(new ImageData(f.patch, f.dims.width, f.dims.height), 0, 0);
    fctx.drawImage(patch, f.dims.left, f.dims.top);

    if (keep.has(i)) {
      const c = makeCanvas(w, h);
      c.getContext('2d').drawImage(full, 0, 0, w, h);
      frames.push(c);
    }
    prev = f;
    onProgress((i + 1) / raw.length);
  }
  return frames;
}

// Procedural animation shown before anything is uploaded.
// Drawn on the page background so it blends cleanly in both additive and multiply modes.
export function demoFrames(count = 72, bg = '#000000', fg = '#ffffff') {
  const w = 480;
  const h = 300;
  const frames = [];
  for (let i = 0; i < count; i++) {
    const t = i / count;
    const c = makeCanvas(w, h);
    const g = c.getContext('2d');
    g.fillStyle = bg;
    g.fillRect(0, 0, w, h);

    const x = w / 2 + Math.cos(t * Math.PI * 2) * 150;
    const y = h / 2 + Math.sin(t * Math.PI * 4) * 80;
    const hue = Math.round(t * 360);
    g.fillStyle = `hsl(${hue} 80% 62%)`;
    g.beginPath();
    g.arc(x, y, 34, 0, Math.PI * 2);
    g.fill();

    g.save();
    g.translate(w / 2, h / 2);
    g.rotate(t * Math.PI * 2);
    g.strokeStyle = fg;
    g.lineWidth = 3;
    g.strokeRect(-40, -40, 80, 80);
    g.restore();

    g.globalAlpha = 0.55;
    g.fillStyle = fg;
    g.font = '600 14px ui-sans-serif, system-ui';
    g.fillText(`frame ${String(i + 1).padStart(2, '0')}`, 14, h - 14);
    frames.push(c);
  }
  return frames;
}
