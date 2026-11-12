import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

export function tmpDir(prefix = 'claude-pets-test-'): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}
