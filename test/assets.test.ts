import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { referencedAnimationIds, triggers } from '../src/shared/triggers';
import type { AtlasJson } from '../src/shared/types';
import { SPECIES_IDS } from '../src/shared/types';

const assetsDir = path.join(__dirname, '..', 'assets');
const dirs = fs.readdirSync(assetsDir).filter((d) => /^\d\d_/.test(d)).sort();
const atlases = dirs.map((d) => ({ dir: d, atlas: JSON.parse(fs.readFileSync(path.join(assetsDir, d, 'atlas.json'), 'utf8')) as AtlasJson }));

function pngSize(file: string): { w: number; h: number } {
  const b = fs.readFileSync(file);
  expect(b.subarray(1, 4).toString('ascii')).toBe('PNG');
  return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
}

describe('assets', () => {
  it('contains the 12 species in the expected folders', () => {
    expect(dirs).toHaveLength(12);
    expect(atlases.map((a) => a.atlas.species.id)).toEqual([...SPECIES_IDS]);
    for (const { dir, atlas } of atlases) expect(dir.endsWith('_' + atlas.species.id)).toBe(true);
  });

  it('every atlas has the same 49 canonical animation ids', () => {
    const reference = Object.keys(atlases[0].atlas.animations).sort();
    expect(reference).toHaveLength(49);
    for (const { atlas } of atlases) expect(Object.keys(atlas.animations).sort()).toEqual(reference);
  });

  it('every referenced frame exists and lies inside atlas.png', () => {
    for (const { dir, atlas } of atlases) {
      const { w, h } = pngSize(path.join(assetsDir, dir, 'atlas.png'));
      const names = new Set<string>();
      for (const anim of Object.values(atlas.animations)) {
        anim.frames.forEach((f) => names.add(f));
        anim.eyes?.half.forEach((f) => names.add(f));
        anim.eyes?.closed.forEach((f) => names.add(f));
        if (anim.eyes) {
          expect(anim.eyes.half).toHaveLength(anim.frames.length);
          expect(anim.eyes.closed).toHaveLength(anim.frames.length);
        }
      }
      for (const name of names) {
        const r = atlas.frames[name];
        expect(r, `${dir}: ${name}`).toBeDefined();
        expect(r.x + r.w).toBeLessThanOrEqual(w);
        expect(r.y + r.h).toBeLessThanOrEqual(h);
      }
    }
  });

  it('every animation id used in triggers.json exists in every atlas', () => {
    const ids = referencedAnimationIds(triggers);
    expect(ids.length).toBeGreaterThan(30);
    for (const { dir, atlas } of atlases) {
      for (const id of ids) expect(atlas.animations[id], `${dir}: ${id}`).toBeDefined();
    }
  });

  it('every atlas defines the interaction objects inside objects.png', () => {
    for (const { dir, atlas } of atlases) {
      const { w, h } = pngSize(path.join(assetsDir, dir, 'objects.png'));
      for (const key of ['toy', 'treat', 'item', 'bowl_full', 'bowl_empty', 'heart', 'heart_small', 'rope_icon'] as const) {
        const r = atlas.objects[key];
        expect(r, `${dir}: ${key}`).toBeDefined();
        expect(r.x + r.w).toBeLessThanOrEqual(w);
        expect(r.y + r.h).toBeLessThanOrEqual(h);
      }
      expect(atlas.objects.rope_colors).toHaveLength(2);
    }
  });

  it('uses the icon from the package (128×128)', () => {
    expect(pngSize(path.join(assetsDir, 'icon.png'))).toEqual({ w: 128, h: 128 });
  });
});
