// Building the configuration that is embedded into the injected script (pure, testable).
import { LEGACY_SPECIES, RANDOM_SPECIES, SPECIES_IDS, bridgePorts, type PetConfig, type ReduceMotion } from './shared/types';

/** Reads one "claudePets.*" setting with a fallback. */
export type SettingReader = <T>(key: string, fallback: T) => T;

/** Map any stored species value (including pre-0.2.0 German ids) to a valid current one. */
export function normalizeSpecies(value: unknown): string {
  const v = typeof value === 'string' ? (LEGACY_SPECIES[value] ?? value) : 'dog';
  return v === RANDOM_SPECIES || (SPECIES_IDS as readonly string[]).includes(v) ? v : 'dog';
}

export function buildPetConfig(read: SettingReader, opts: { version: string; token: string; bridgeEnabled: boolean }): PetConfig {
  const scale = Number(read('scale', 2));
  const reduce = read<ReduceMotion>('reduceMotion', 'auto');
  return {
    version: opts.version,
    species: normalizeSpecies(read('species', 'dog')),
    scale: Number.isFinite(scale) ? Math.min(4, Math.max(1, scale)) : 2,
    showButtons: read('showButtons', true),
    wander: read('idle.wander', true),
    sleepAfterMs: Math.max(1, Number(read('idle.sleepAfterMinutes', 4))) * 60000,
    opacityOnHover: Math.min(1, Math.max(0, Number(read('opacityOnHover', 0.35)))),
    reduceMotion: reduce === 'on' || reduce === 'off' ? reduce : 'auto',
    debug: read('debug', false),
    bridge: { enabled: opts.bridgeEnabled, ports: bridgePorts(), token: opts.token },
  };
}

/** Defaults only – what a fresh installation embeds. */
export const defaultReader: SettingReader = (_key, fallback) => fallback;
