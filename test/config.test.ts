import { describe, expect, it } from 'vitest';
import { buildPetConfig, defaultReader, normalizeSpecies, type SettingReader } from '../src/config';
import { BRIDGE_PORT_FIRST, BRIDGE_PORT_LAST } from '../src/shared/types';

describe('config', () => {
  it('maps pre-0.2.0 German species ids to the English ones', () => {
    expect(normalizeSpecies('hund')).toBe('dog');
    expect(normalizeSpecies('eichhoernchen')).toBe('squirrel');
    expect(normalizeSpecies('zufall')).toBe('random');
    expect(normalizeSpecies('panda')).toBe('panda');
    expect(normalizeSpecies('random')).toBe('random');
    expect(normalizeSpecies('unicorn')).toBe('dog');
    expect(normalizeSpecies(undefined)).toBe('dog');
  });

  it('builds the embedded config from defaults', () => {
    const cfg = buildPetConfig(defaultReader, { version: '0.2.0', token: 't', bridgeEnabled: true });
    expect(cfg).toEqual({
      version: '0.2.0',
      species: 'dog',
      scale: 2,
      showButtons: true,
      wander: true,
      sleepAfterMs: 240000,
      opacityOnHover: 0.35,
      reduceMotion: 'auto',
      debug: false,
      bridge: { enabled: true, ports: expect.any(Array), token: 't' },
    });
    expect(cfg.bridge.ports[0]).toBe(BRIDGE_PORT_FIRST);
    expect(cfg.bridge.ports.at(-1)).toBe(BRIDGE_PORT_LAST);
  });

  it('clamps and normalises user values', () => {
    const values: Record<string, unknown> = { species: 'katze', scale: 9, opacityOnHover: -1, 'idle.sleepAfterMinutes': 10, reduceMotion: 'weird' };
    const read: SettingReader = <T,>(key: string, fallback: T) => (key in values ? (values[key] as T) : fallback);
    const cfg = buildPetConfig(read, { version: '1', token: 't', bridgeEnabled: false });
    expect(cfg).toMatchObject({ species: 'cat', scale: 4, opacityOnHover: 0, sleepAfterMs: 600000, reduceMotion: 'auto' });
  });
});
