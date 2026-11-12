import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { cleanupOrphans, instancesForCwd, loadOrCreateToken, readInstances, writeInstance, type InstanceInfo } from '../src/instances';
import { tmpDir } from './helpers';

const inst = (pid: number, folders: string[]): InstanceInfo => ({ pid, port: 47811, token: 't', workspaceFolders: folders, startedAt: '', version: '0.1.0' });

describe('instances', () => {
  it('shares one token between windows that start at the same time', () => {
    const home = tmpDir();
    const a = loadOrCreateToken('a'.repeat(48), home);
    const b = loadOrCreateToken('b'.repeat(48), home);
    const c = loadOrCreateToken(undefined, home);
    expect(a).toBe('a'.repeat(48));
    expect(b).toBe(a);
    expect(c).toBe(a);
    const file = path.join(home, '.claude-pets', 'token');
    expect(fs.statSync(file).mode & 0o777).toBe(0o600);
    expect(fs.readdirSync(path.join(home, '.claude-pets'))).toEqual(['token']);
  });

  it('replaces a broken token file and ignores invalid preferred tokens', () => {
    const home = tmpDir();
    fs.mkdirSync(path.join(home, '.claude-pets'));
    fs.writeFileSync(path.join(home, '.claude-pets', 'token'), 'kaputt');
    const t = loadOrCreateToken('nope', home);
    expect(t).toMatch(/^[a-f0-9]{48}$/);
    expect(loadOrCreateToken(undefined, home)).toBe(t);
  });

  it('registers instances, routes by cwd and removes orphans', () => {
    const home = tmpDir();
    writeInstance(inst(111, ['/work/a']), home);
    writeInstance(inst(process.pid, ['/work/b']), home);
    expect(readInstances(home)).toHaveLength(2);
    expect(instancesForCwd(readInstances(home), '/work/b/src').map((i) => i.pid)).toEqual([process.pid]);
    expect(instancesForCwd(readInstances(home), '/elsewhere')).toHaveLength(2);
    expect(cleanupOrphans(home, (pid) => pid !== 111)).toBe(1);
    expect(readInstances(home).map((i) => i.pid)).toEqual([process.pid]);
  });
});
