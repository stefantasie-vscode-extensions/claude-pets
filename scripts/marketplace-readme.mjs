// Writes README.marketplace.md: README.md without the blocks marked as GitHub-only.
//
//   <!-- github-only -->
//   … shown on GitHub (and Gitea), never in the Marketplace or in VS Code …
//   <!-- /github-only -->
//
// The markers are HTML comments, so they are invisible on GitHub. `npm run package` packages the
// result via `vsce package --readme-path README.marketplace.md`; README.md itself is excluded in
// .vscodeignore. Usage: node scripts/marketplace-readme.mjs [input] [output]
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const START = '<!-- github-only -->';
const END = '<!-- /github-only -->';

export function stripGithubOnly(text) {
  let out = '';
  let pos = 0;
  for (;;) {
    const start = text.indexOf(START, pos);
    const strayEnd = text.indexOf(END, pos);
    if (strayEnd >= 0 && (start < 0 || strayEnd < start)) throw new Error(`"${END}" without "${START}"`);
    if (start < 0) {
      out += text.slice(pos);
      break;
    }
    const end = text.indexOf(END, start + START.length);
    if (end < 0) throw new Error(`"${START}" is not closed by "${END}"`);
    out += text.slice(pos, start);
    pos = end + END.length;
  }
  // Removing a block leaves its surrounding blank lines behind; keep at most one.
  return out.replace(/\n{3,}/g, '\n\n');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = join(dirname(fileURLToPath(import.meta.url)), '..');
  const input = resolve(root, process.argv[2] ?? 'README.md');
  const output = resolve(root, process.argv[3] ?? 'README.marketplace.md');
  writeFileSync(output, stripGithubOnly(readFileSync(input, 'utf8')));
  console.log(`Wrote ${output}`);
}
