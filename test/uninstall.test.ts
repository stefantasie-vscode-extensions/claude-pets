import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { otherInstallations } from '../src/uninstall';
import { tmpDir } from './helpers';

function extRoot(dirs: string[], registry?: string[], obsolete: string[] = []) {
  const root = tmpDir();
  for (const d of dirs) fs.mkdirSync(path.join(root, d));
  if (registry) fs.writeFileSync(path.join(root, 'extensions.json'), JSON.stringify(registry.map((r) => ({ relativeLocation: r, identifier: { id: r.replace(/-\d.*$/, '') } }))));
  if (obsolete.length) fs.writeFileSync(path.join(root, '.obsolete'), JSON.stringify(Object.fromEntries(obsolete.map((o) => [o, true]))));
  return root;
}

describe('uninstall guard', () => {
  it('keeps the patches when another Claude Pets installation is registered', () => {
    const root = extRoot(
      ['kleywalker.claude-pets-0.1.1', 'stefantasie.claude-pets-0.2.0', 'anthropic.claude-code-2.1.322'],
      ['stefantasie.claude-pets-0.2.0', 'anthropic.claude-code-2.1.322'],
      ['kleywalker.claude-pets-0.1.1'],
    );
    expect(otherInstallations(path.join(root, 'kleywalker.claude-pets-0.1.1'))).toEqual(['stefantasie.claude-pets-0.2.0']);
  });

  it('cleans up when the last installation goes (obsolete leftovers do not count)', () => {
    const root = extRoot(
      ['kleywalker.claude-pets-0.1.0', 'stefantasie.claude-pets-0.2.0'],
      ['anthropic.claude-code-2.1.322'],
      ['kleywalker.claude-pets-0.1.0', 'stefantasie.claude-pets-0.2.0'],
    );
    expect(otherInstallations(path.join(root, 'stefantasie.claude-pets-0.2.0'))).toEqual([]);
  });

  it('falls back to the folder listing without extensions.json', () => {
    const root = extRoot(['stefantasie.claude-pets-0.2.0', 'stefantasie.claude-pets-0.3.0']);
    expect(otherInstallations(path.join(root, 'stefantasie.claude-pets-0.2.0'))).toEqual(['stefantasie.claude-pets-0.3.0']);
  });
});
