// Registry of running VS Code windows (one bridge each) in ~/.claude-pets/instances/<pid>.json.
import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

export interface InstanceInfo {
  pid: number;
  port: number;
  token: string;
  workspaceFolders: string[];
  startedAt: string;
  version: string;
}

export function petsHome(home: string = os.homedir()): string {
  return path.join(home, '.claude-pets');
}

export function instancesDir(home?: string): string {
  return path.join(petsHome(home), 'instances');
}

export function isProcessAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === 'EPERM';
  }
}

export function readInstances(home?: string): InstanceInfo[] {
  const dir = instancesDir(home);
  let names: string[];
  try {
    names = fs.readdirSync(dir);
  } catch {
    return [];
  }
  const out: InstanceInfo[] = [];
  for (const name of names) {
    if (!/^\d+\.json$/.test(name)) continue;
    try {
      const info = JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8')) as InstanceInfo;
      if (typeof info.port === 'number' && typeof info.token === 'string') out.push(info);
    } catch {
      /* ignore broken entries */
    }
  }
  return out;
}

export function writeInstance(info: InstanceInfo, home?: string): string {
  const dir = instancesDir(home);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const file = path.join(dir, `${info.pid}.json`);
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(info), { mode: 0o600 });
  fs.renameSync(tmp, file);
  return file;
}

export function removeInstance(pid: number, home?: string): void {
  try {
    fs.unlinkSync(path.join(instancesDir(home), `${pid}.json`));
  } catch {
    /* already gone */
  }
}

/** Delete entries whose process no longer exists. Returns the number of removed files. */
export function cleanupOrphans(home?: string, alive: (pid: number) => boolean = isProcessAlive): number {
  let removed = 0;
  for (const info of readInstances(home)) {
    if (info.pid !== process.pid && !alive(info.pid)) {
      removeInstance(info.pid, home);
      removed++;
    }
  }
  return removed;
}

function norm(p: string): string {
  const resolved = path.resolve(p);
  return process.platform === 'win32' || process.platform === 'darwin' ? resolved.toLowerCase() : resolved;
}

/** Instances whose workspace contains `cwd`; if none match, all instances. */
export function instancesForCwd(instances: InstanceInfo[], cwd: string | undefined): InstanceInfo[] {
  if (!cwd) return instances;
  const c = norm(cwd);
  const matching = instances.filter((i) =>
    i.workspaceFolders.some((f) => {
      const n = norm(f);
      return c === n || c.startsWith(n.endsWith(path.sep) ? n : n + path.sep);
    }),
  );
  return matching.length > 0 ? matching : instances;
}

const TOKEN_RE = /^[a-f0-9]{48}$/;

function readToken(file: string): string | null {
  try {
    const t = fs.readFileSync(file, 'utf8').trim();
    return TOKEN_RE.test(t) ? t : null;
  } catch {
    return null;
  }
}

/**
 * The bridge token shared by all VS Code windows. Several windows may activate at the same
 * moment; the file is created via link() (atomic, fails if it exists), so exactly one token
 * wins and every window ends up with the same value.
 */
export function loadOrCreateToken(preferred?: string, home?: string): string {
  const dir = petsHome(home);
  const file = path.join(dir, 'token');
  const existing = readToken(file);
  if (existing) return existing;
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const candidate = preferred && TOKEN_RE.test(preferred) ? preferred : crypto.randomBytes(24).toString('hex');
  const tmp = path.join(dir, `.token-${process.pid}-${Date.now()}`);
  fs.writeFileSync(tmp, candidate, { mode: 0o600 });
  try {
    fs.linkSync(tmp, file);
    return candidate;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
    const winner = readToken(file);
    if (winner) return winner;
    // A broken token file: replace it.
    fs.renameSync(tmp, file);
    return candidate;
  } finally {
    try {
      fs.unlinkSync(tmp);
    } catch {
      /* already moved or removed */
    }
  }
}
