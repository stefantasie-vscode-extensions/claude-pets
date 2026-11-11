// Build script: bundles the extension host, the hook script, the uninstall script and the
// webview payload (with all sprite atlases embedded as data URLs).
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, mkdirSync, rmSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');
const watch = process.argv.includes('--watch');
const skipTypecheck = process.argv.includes('--no-typecheck');

rmSync(dist, { recursive: true, force: true });
mkdirSync(dist, { recursive: true });

if (!skipTypecheck) {
  execFileSync(process.execPath, [join(root, 'node_modules/typescript/bin/tsc'), '--noEmit', '-p', root], {
    stdio: 'inherit',
  });
}

/**
 * Virtual module "claude-pets:assets": every species folder (NN_id) becomes one entry with the
 * compact atlas metadata plus atlas.png / objects.png as base64 data URLs.
 */
const assetsPlugin = {
  name: 'claude-pets-assets',
  setup(b) {
    b.onResolve({ filter: /^claude-pets:assets$/ }, (args) => ({ path: args.path, namespace: 'claude-pets-assets' }));
    b.onLoad({ filter: /.*/, namespace: 'claude-pets-assets' }, () => {
      const assetsDir = join(root, 'assets');
      const species = readdirSync(assetsDir)
        .filter((d) => /^\d\d_/.test(d) && statSync(join(assetsDir, d)).isDirectory())
        .sort()
        .map((dir) => {
          const atlas = JSON.parse(readFileSync(join(assetsDir, dir, 'atlas.json'), 'utf8'));
          const png = (f) => 'data:image/png;base64,' + readFileSync(join(assetsDir, dir, f)).toString('base64');
          return { dir, atlas, atlasPng: png('atlas.png'), objectsPng: png('objects.png') };
        });
      return {
        contents: 'export default ' + JSON.stringify(species) + ';',
        loader: 'js',
        watchFiles: species.flatMap((s) => ['atlas.json', 'atlas.png', 'objects.png'].map((f) => join(assetsDir, s.dir, f))),
      };
    });
  },
};

const common = { bundle: true, sourcemap: false, logLevel: 'info', legalComments: 'none' };

const nodeTargets = [
  { entryPoints: [join(root, 'src/extension.ts')], outfile: join(dist, 'extension.js'), external: ['vscode'] },
  { entryPoints: [join(root, 'src/hook.ts')], outfile: join(dist, 'hook.js') },
  { entryPoints: [join(root, 'src/uninstall.ts')], outfile: join(dist, 'uninstall.js') },
];

const builds = nodeTargets.map((t) =>
  build({ ...common, ...t, platform: 'node', format: 'cjs', target: 'node18', minify: !watch }),
);

builds.push(
  build({
    ...common,
    entryPoints: [join(root, 'src/webview/main.ts')],
    outfile: join(dist, 'webview.js'),
    platform: 'browser',
    format: 'iife',
    target: 'chrome114',
    minify: true,
    plugins: [assetsPlugin],
  }),
  build({
    ...common,
    entryPoints: [join(root, 'src/webview/styles.css')],
    outfile: join(dist, 'webview.css'),
    loader: { '.css': 'css' },
    minify: true,
  }),
);

await Promise.all(builds);

// The injected script must never contain our own end marker, otherwise removal would cut it short.
for (const f of ['webview.js', 'webview.css']) {
  const text = readFileSync(join(dist, f), 'utf8');
  if (text.includes('claude-pets:end') || text.includes('claude-pets:start')) {
    throw new Error(`${f} contains a claude-pets marker string`);
  }
}
writeFileSync(join(dist, 'build-info.json'), JSON.stringify({ builtAt: new Date().toISOString() }) + '\n');
console.log('Build fertig.');
