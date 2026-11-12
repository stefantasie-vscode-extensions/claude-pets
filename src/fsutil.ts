// Small file helpers: atomic writes and one-time backups.
import * as fs from 'node:fs';
import * as path from 'node:path';

export interface FsLike {
  readFileSync(p: string, enc: 'utf8'): string;
  writeFileSync(p: string, data: string, opts?: { mode?: number }): void;
  renameSync(a: string, b: string): void;
  existsSync(p: string): boolean;
  copyFileSync(a: string, b: string): void;
  unlinkSync(p: string): void;
  statSync(p: string): { mode: number };
}

export const realFs: FsLike = fs as unknown as FsLike;

/**
 * Write via a temporary file in the same directory followed by rename, so readers either see
 * the old or the new content and a failed write never leaves a truncated file behind.
 */
export function writeFileAtomic(file: string, content: string, io: FsLike = realFs): void {
  const tmp = path.join(path.dirname(file), `.${path.basename(file)}.claude-pets-${process.pid}-${Date.now()}.tmp`);
  let mode: number | undefined;
  try {
    mode = io.statSync(file).mode & 0o777;
  } catch {
    mode = undefined;
  }
  try {
    io.writeFileSync(tmp, content, mode !== undefined ? { mode } : undefined);
    io.renameSync(tmp, file);
  } catch (err) {
    try {
      if (io.existsSync(tmp)) io.unlinkSync(tmp);
    } catch {
      /* ignore cleanup errors */
    }
    throw err;
  }
}

/** Create `<file><suffix>` once; an existing backup is never overwritten. */
export function backupOnce(file: string, suffix: string, io: FsLike = realFs): string {
  const backup = file + suffix;
  if (!io.existsSync(backup) && io.existsSync(file)) io.copyFileSync(file, backup);
  return backup;
}
