// Renders media/banner.gif: all twelve pets side by side on the top edge of a prompt box,
// each doing something different. Run with `npm run make-banner`.
import { readFileSync, readdirSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';
import gifenc from 'gifenc';

const { GIFEncoder, quantize, applyPalette } = gifenc;

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const SCALE = 2; // 840 × 64 px: fits README widths without blurry down-scaling
const CELL = 34; // atlas px per pet
const PAD = 6;
const FRAME = 24;
const TOP = 3; // sprite top row inside the banner
const EDGE = TOP + FRAME - 1; // prompt box top line: right below the feet (row 22)
const DURATION_MS = 6000;
const STEP_MS = 50;

// What each pet does: animation id, optional back-and-forth walk (range px, period ms).
const ROLES = {
  dog: { anim: 'gehen', walk: [10, 2000] },
  cat: { anim: 'streicheln' },
  fox: { anim: 'rennen', walk: [10, 1500] },
  raccoon: { anim: 'buddeln' },
  panda: { anim: 'fressen' },
  monkey: { anim: 'springen' },
  rabbit: { anim: 'gehen', walk: [10, 3000] },
  frog: { anim: 'leckerli_fangen' },
  robot: { anim: 'freuen' },
  crab: { anim: 'bellen' },
  squirrel: { anim: 'knochen_vergraben' },
  turtle: { anim: 'schlafen' },
};

const COLORS = {
  background: [0x1f, 0x1f, 0x1f, 255],
  boxFill: [0x2a, 0x2a, 0x2a, 255],
  boxBorder: [0x4a, 0x4a, 0x4a, 255],
  boxHighlight: [0xd9, 0x77, 0x57, 255], // Claude orange on the focused box edge
};

const pets = readdirSync(join(root, 'assets'))
  .filter((d) => /^\d\d_/.test(d))
  .sort()
  .map((dir) => {
    const atlas = JSON.parse(readFileSync(join(root, 'assets', dir, 'atlas.json'), 'utf8'));
    const sheet = PNG.sync.read(readFileSync(join(root, 'assets', dir, 'atlas.png')));
    const role = ROLES[atlas.species.id];
    if (!role) throw new Error(`no role for ${atlas.species.id}`);
    return { atlas, sheet, role, anim: atlas.animations[role.anim] };
  });

const W = PAD * 2 + pets.length * CELL;
const H = EDGE + 6;

function put(buf, x, y, c) {
  if (x < 0 || y < 0 || x >= W || y >= H) return;
  buf.set(c, (y * W + x) * 4);
}

/** Rounded rectangle with stepped (pixel-art) corners. */
function roundedRect(buf, x0, y0, x1, y1, r, fill, border) {
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const dx = Math.max(x0 + r - x, x - (x1 - r), 0);
      const dy = Math.max(y0 + r - y, y - (y1 - r), 0);
      const d = Math.hypot(dx, dy);
      if (d > r + 0.25) continue;
      const edge = border && (d > r - 0.75 || x === x0 || x === x1 || y === y0 || y === y1);
      put(buf, x, y, edge ? border : fill);
    }
  }
}

function drawBackground(buf) {
  buf.fill(0);
  roundedRect(buf, 0, 0, W - 1, H - 1, 4, COLORS.background, null);
  // The prompt box: its top edge is where the pets stand; it continues below the banner.
  roundedRect(buf, PAD - 2, EDGE, W - PAD + 1, H + 6, 3, COLORS.boxFill, COLORS.boxBorder);
  for (let x = PAD + 2; x <= W - PAD - 3; x++) put(buf, x, EDGE, COLORS.boxHighlight);
}

function drawSprite(buf, pet, frameName, left, flip) {
  const r = pet.atlas.frames[frameName];
  const src = pet.sheet;
  for (let y = 0; y < FRAME; y++) {
    for (let x = 0; x < FRAME; x++) {
      const sx = r.x + (flip ? FRAME - 1 - x : x);
      const i = ((r.y + y) * src.width + sx) * 4;
      if (src.data[i + 3] < 128) continue;
      put(buf, left + x, TOP + y, [src.data[i], src.data[i + 1], src.data[i + 2], 255]);
    }
  }
}

function renderFrame(t) {
  const buf = new Uint8Array(W * H * 4);
  drawBackground(buf);
  pets.forEach((pet, i) => {
    const cellLeft = PAD + i * CELL;
    const frames = pet.anim.frames;
    const frame = frames[Math.floor((t / 1000) * pet.anim.fps) % frames.length];
    let offset = (CELL - FRAME) / 2;
    let flip = false;
    if (pet.role.walk) {
      const [range, period] = pet.role.walk;
      const phase = (t % period) / period;
      offset = phase < 0.5 ? phase * 2 * range : (1 - phase) * 2 * range;
      flip = phase >= 0.5;
    }
    drawSprite(buf, pet, frame, Math.round(cellLeft + offset), flip);
  });
  return buf;
}

function upscale(buf) {
  const out = new Uint8Array(W * SCALE * H * SCALE * 4);
  for (let y = 0; y < H * SCALE; y++) {
    for (let x = 0; x < W * SCALE; x++) {
      const s = (Math.floor(y / SCALE) * W + Math.floor(x / SCALE)) * 4;
      out.set(buf.subarray(s, s + 4), (y * W * SCALE + x) * 4);
    }
  }
  return out;
}

const frames = [];
for (let t = 0; t < DURATION_MS; t += STEP_MS) frames.push(upscale(renderFrame(t)));

// Pixel art: use the exact colours if they fit into one palette, otherwise quantise.
const colours = new Map();
for (const f of frames) {
  for (let i = 0; i < f.length; i += 4) {
    const key = f[i + 3] === 0 ? -1 : (f[i] << 16) | (f[i + 1] << 8) | f[i + 2];
    if (!colours.has(key)) colours.set(key, colours.size);
  }
}
let palette;
let indexOf;
if (colours.size <= 256) {
  palette = [...colours.keys()].map((k) => (k === -1 ? [0, 0, 0, 0] : [(k >> 16) & 255, (k >> 8) & 255, k & 255, 255]));
  indexOf = (f) => {
    const idx = new Uint8Array(f.length / 4);
    for (let i = 0, p = 0; i < f.length; i += 4, p++) {
      idx[p] = colours.get(f[i + 3] === 0 ? -1 : (f[i] << 16) | (f[i + 1] << 8) | f[i + 2]);
    }
    return idx;
  };
} else {
  const sample = new Uint8Array(frames.filter((_, i) => i % 6 === 0).flatMap((f) => [...f]));
  palette = quantize(sample, 256, { format: 'rgba4444', oneBitAlpha: true });
  indexOf = (f) => applyPalette(f, palette, 'rgba4444');
}
const transparentIndex = palette.findIndex((c) => c.length === 4 && c[3] === 0);

const gif = GIFEncoder();
frames.forEach((f, i) => {
  gif.writeFrame(indexOf(f), W * SCALE, H * SCALE, {
    palette: i === 0 ? palette : undefined,
    delay: STEP_MS,
    repeat: 0,
    transparent: transparentIndex >= 0,
    transparentIndex: Math.max(0, transparentIndex),
  });
});
gif.finish();
mkdirSync(join(root, 'media'), { recursive: true });
const out = join(root, 'media', 'banner.gif');
writeFileSync(out, gif.bytes());
console.log(`${out}: ${W * SCALE}×${H * SCALE}, ${frames.length} frames, ${colours.size} colours, ${(gif.bytes().length / 1024).toFixed(0)} KB`);

// Optional: `node scripts/make-banner.mjs --preview out.png` stacks three moments as a PNG.
const previewAt = process.argv.indexOf('--preview');
if (previewAt > 0 && process.argv[previewAt + 1]) {
  const moments = [0, 1300, 3700].map((t) => upscale(renderFrame(t)));
  const png = new PNG({ width: W * SCALE, height: H * SCALE * moments.length + 8 * (moments.length - 1) });
  png.data.fill(255);
  moments.forEach((m, k) => {
    for (let y = 0; y < H * SCALE; y++) {
      for (let x = 0; x < W * SCALE; x++) {
        const s = (y * W * SCALE + x) * 4;
        if (m[s + 3] === 0) continue;
        png.data.set(m.subarray(s, s + 4), ((k * (H * SCALE + 8) + y) * W * SCALE + x) * 4);
      }
    }
  });
  writeFileSync(process.argv[previewAt + 1], PNG.sync.write(png));
}
