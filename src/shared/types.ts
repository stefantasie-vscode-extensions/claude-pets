// Types shared between the extension host, the hook script and the injected webview script.

export type Pose = 'sit' | 'stand' | 'lie' | 'belly';

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface SpeciesInfo {
  id: string;
  label: string;
  item: string;
  toy: string;
  rope: string;
  sound: string;
  gait: 'walk' | 'hop';
}

export interface AnimDef {
  label: string;
  frames: string[];
  fps: number;
  loop: boolean;
  group?: string;
  note?: string;
  pose: [Pose, Pose];
  eyes?: { half: string[]; closed: string[] };
}

export type ObjectKey = 'toy' | 'treat' | 'item' | 'bowl_full' | 'bowl_empty' | 'heart' | 'heart_small' | 'rope_icon';

export interface AtlasJson {
  species: SpeciesInfo;
  frameSize: number;
  scale: number;
  anchor: { facing: 'right'; groundRow: number };
  animations: Record<string, AnimDef>;
  frames: Record<string, Rect>;
  objects: Record<ObjectKey, Rect> & { rope_colors: string[] };
}

/** One embedded species as produced by scripts/build.mjs. */
export interface EmbeddedSpecies {
  dir: string;
  atlas: AtlasJson;
  atlasPng: string;
  objectsPng: string;
}

export type BashTag = 'test' | 'install' | 'commit' | 'bash';
export type Outcome = 'success' | 'failure' | 'unknown';

/**
 * The only information that ever reaches the webview about a hook event. No prompts, file
 * contents or commands – just enough to pick an animation.
 */
export interface PetEvent {
  event: string;
  tool?: string;
  tag?: BashTag;
  outcome?: Outcome;
  notification?: string;
  /** Short non-reversible hash of the session id, used to bind a pet to its own session. */
  sid?: string;
  ts: number;
}

export type ReduceMotion = 'auto' | 'on' | 'off';

/** Configuration embedded into the injected script (and pushed live over the bridge). */
export interface PetConfig {
  version: string;
  species: string;
  scale: number;
  showButtons: boolean;
  wander: boolean;
  sleepAfterMs: number;
  opacityOnHover: number;
  reduceMotion: ReduceMotion;
  debug: boolean;
  bridge: {
    enabled: boolean;
    ports: number[];
    token: string;
  };
}

export const BRIDGE_PORT_FIRST = 47811;
export const BRIDGE_PORT_LAST = 47830;

export function bridgePorts(): number[] {
  const ports: number[] = [];
  for (let p = BRIDGE_PORT_FIRST; p <= BRIDGE_PORT_LAST; p++) ports.push(p);
  return ports;
}

export const SPECIES_IDS = [
  'hund',
  'katze',
  'fuchs',
  'waschbaer',
  'panda',
  'affe',
  'hase',
  'frosch',
  'roboter',
  'krabbe',
  'eichhoernchen',
  'schildkroete',
] as const;

export const SPECIES_LABELS: Record<string, string> = {
  hund: 'Hund',
  katze: 'Katze',
  fuchs: 'Fuchs',
  waschbaer: 'Waschbär',
  panda: 'Panda',
  affe: 'Affe',
  hase: 'Hase',
  frosch: 'Frosch',
  roboter: 'Roboter',
  krabbe: 'Krabbe',
  eichhoernchen: 'Eichhörnchen',
  schildkroete: 'Schildkröte',
  zufall: 'Zufall',
};
