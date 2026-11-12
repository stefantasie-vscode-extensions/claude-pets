// Embedded sprite atlases: decoding, frame lookup and per-frame pixel facts.
import type { AnimDef, AtlasJson, EmbeddedSpecies, ObjectKey, Rect } from '../shared/types';

export interface FrameFacts {
  /** Opaque bounding box within the 24×24 frame (inclusive). */
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  /** Lowest opaque row; < groundRow means the feet are off the ground. */
  lowest: number;
}

export class SpeciesAssets {
  readonly id: string;
  readonly atlas: AtlasJson;
  readonly frameSize: number;
  readonly groundRow: number;
  readonly eyes = new Map<string, { half: string; closed: string }>();
  private facts = new Map<string, FrameFacts>();
  private animBoxes = new Map<string, FrameFacts>();
  sheet!: HTMLImageElement;
  objects!: HTMLImageElement;

  private constructor(src: EmbeddedSpecies) {
    this.atlas = src.atlas;
    this.id = src.atlas.species.id;
    this.frameSize = src.atlas.frameSize || 24;
    this.groundRow = src.atlas.anchor?.groundRow ?? 22;
    for (const anim of Object.values(this.atlas.animations)) {
      if (!anim.eyes) continue;
      anim.frames.forEach((f, i) => {
        const half = anim.eyes!.half[i];
        const closed = anim.eyes!.closed[i];
        if (half && closed) this.eyes.set(f, { half, closed });
      });
    }
  }

  static async load(src: EmbeddedSpecies): Promise<SpeciesAssets> {
    const s = new SpeciesAssets(src);
    [s.sheet, s.objects] = await Promise.all([decode(src.atlasPng), decode(src.objectsPng)]);
    s.analyse();
    return s;
  }

  get anims(): Record<string, AnimDef> {
    return this.atlas.animations;
  }

  get gait(): 'walk' | 'hop' {
    return this.atlas.species.gait === 'hop' ? 'hop' : 'walk';
  }

  frameRect(name: string): Rect | undefined {
    return this.atlas.frames[name];
  }

  objectRect(key: ObjectKey): Rect | undefined {
    return this.atlas.objects[key];
  }

  get ropeColors(): string[] {
    const c = this.atlas.objects.rope_colors;
    return Array.isArray(c) && c.length > 0 ? c : ['#9696a0', '#6e6e7d'];
  }

  factsOf(frame: string): FrameFacts | undefined {
    return this.facts.get(frame);
  }

  /** Union of the opaque boxes of all frames of an animation (stable hit area). */
  animBox(animId: string): FrameFacts | undefined {
    return this.animBoxes.get(animId);
  }

  isAirborne = (frame: string): boolean => {
    const f = this.facts.get(frame);
    return !!f && f.lowest < this.groundRow;
  };

  /** Read every frame's alpha once to know bounding boxes and ground contact. */
  private analyse(): void {
    const canvas = document.createElement('canvas');
    canvas.width = this.sheet.naturalWidth || this.sheet.width;
    canvas.height = this.sheet.naturalHeight || this.sheet.height;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return;
    ctx.drawImage(this.sheet, 0, 0);
    let data: Uint8ClampedArray;
    try {
      data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    } catch {
      return; // tainted canvas cannot happen with data URLs, but stay defensive
    }
    const W = canvas.width;
    for (const [name, r] of Object.entries(this.atlas.frames)) {
      let x0 = r.w, y0 = r.h, x1 = -1, y1 = -1;
      for (let y = 0; y < r.h; y++) {
        for (let x = 0; x < r.w; x++) {
          if (data[((r.y + y) * W + r.x + x) * 4 + 3] > 16) {
            if (x < x0) x0 = x;
            if (x > x1) x1 = x;
            if (y < y0) y0 = y;
            if (y > y1) y1 = y;
          }
        }
      }
      if (x1 >= 0) this.facts.set(name, { x0, y0, x1, y1, lowest: y1 });
    }
    for (const [id, anim] of Object.entries(this.atlas.animations)) {
      let box: FrameFacts | undefined;
      for (const f of anim.frames) {
        const ff = this.facts.get(f);
        if (!ff) continue;
        box = box
          ? { x0: Math.min(box.x0, ff.x0), y0: Math.min(box.y0, ff.y0), x1: Math.max(box.x1, ff.x1), y1: Math.max(box.y1, ff.y1), lowest: Math.max(box.lowest, ff.lowest) }
          : { ...ff };
      }
      if (box) this.animBoxes.set(id, box);
    }
  }
}

function decode(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      if (typeof img.decode === 'function') img.decode().then(() => resolve(img), () => resolve(img));
      else resolve(img);
    };
    img.onerror = () => reject(new Error('Atlas konnte nicht dekodiert werden'));
    img.src = dataUrl;
  });
}

/** Registry over all embedded species; decodes lazily and caches. */
export class AssetLibrary {
  private cache = new Map<string, Promise<SpeciesAssets>>();
  constructor(private readonly all: EmbeddedSpecies[]) {}

  ids(): string[] {
    return this.all.map((s) => s.atlas.species.id);
  }

  label(id: string): string {
    return this.all.find((s) => s.atlas.species.id === id)?.atlas.species.label ?? id;
  }

  has(id: string): boolean {
    return this.all.some((s) => s.atlas.species.id === id);
  }

  load(id: string): Promise<SpeciesAssets> {
    const src = this.all.find((s) => s.atlas.species.id === id) ?? this.all[0];
    const key = src.atlas.species.id;
    if (!this.cache.has(key)) {
      const p = SpeciesAssets.load(src);
      p.catch(() => this.cache.delete(key));
      this.cache.set(key, p);
    }
    return this.cache.get(key)!;
  }
}
