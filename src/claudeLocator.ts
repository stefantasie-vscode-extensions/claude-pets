// Locating the Claude Code extension and the webview files it loads.
// Pure Node (no vscode import) so the uninstall script can reuse it.
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

export const CLAUDE_EXTENSION_ID = 'anthropic.claude-code';

export interface ClaudeFiles {
  extensionPath: string;
  version: string;
  extensionJs: string | null;
  webviewJs: string;
  webviewCss: string;
  /** How the webview files were determined. */
  method: 'standard' | 'html-builder' | 'scan';
}

function exists(p: string): boolean {
  try {
    return fs.statSync(p).isFile();
  } catch {
    return false;
  }
}

function readVersion(extPath: string): string {
  try {
    return String((JSON.parse(fs.readFileSync(path.join(extPath, 'package.json'), 'utf8')) as { version?: string }).version ?? '?');
  } catch {
    return '?';
  }
}

/** The extension's main script (package.json "main"), usually extension.js. */
export function mainScript(extPath: string): string | null {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(extPath, 'package.json'), 'utf8')) as { main?: string };
    if (pkg.main) {
      const p = path.resolve(extPath, pkg.main);
      for (const candidate of [p, p + '.js']) if (exists(candidate)) return candidate;
    }
  } catch {
    /* fall through */
  }
  const fallback = path.join(extPath, 'extension.js');
  return exists(fallback) ? fallback : null;
}

/**
 * Determine the webview's index.js/index.css. First the known layout, then the paths the
 * extension itself joins when it builds the webview HTML, finally the largest .js/.css in
 * the webview folder.
 */
export function resolveClaudeFiles(extPath: string): ClaudeFiles | null {
  const version = readVersion(extPath);
  const extensionJs = mainScript(extPath);
  const standardJs = path.join(extPath, 'webview', 'index.js');
  const standardCss = path.join(extPath, 'webview', 'index.css');
  if (exists(standardJs) && exists(standardCss)) {
    return { extensionPath: extPath, version, extensionJs, webviewJs: standardJs, webviewCss: standardCss, method: 'standard' };
  }

  if (extensionJs) {
    try {
      const src = fs.readFileSync(extensionJs, 'utf8');
      // e.g. joinPath(this.extensionUri,"webview","index.js")
      const re = /joinPath\([^()]*?((?:"[\w.-]+"\s*,\s*)*"[\w.-]+\.(js|css)")\)/g;
      let js: string | null = null;
      let css: string | null = null;
      for (const m of src.matchAll(re)) {
        const parts = [...m[1].matchAll(/"([\w.-]+)"/g)].map((x) => x[1]);
        const candidate = path.join(extPath, ...parts);
        if (!exists(candidate)) continue;
        if (m[2] === 'js' && !js && parts[0] !== 'node_modules') js = candidate;
        if (m[2] === 'css' && !css) css = candidate;
      }
      if (js && css) return { extensionPath: extPath, version, extensionJs, webviewJs: js, webviewCss: css, method: 'html-builder' };
    } catch {
      /* fall through */
    }
  }

  const dir = path.join(extPath, 'webview');
  try {
    const files = fs.readdirSync(dir).map((f) => path.join(dir, f));
    const largest = (ext: string) =>
      files
        .filter((f) => f.endsWith(ext) && exists(f))
        .sort((a, b) => fs.statSync(b).size - fs.statSync(a).size)[0];
    const js = largest('.js');
    const css = largest('.css');
    if (js && css) return { extensionPath: extPath, version, extensionJs, webviewJs: js, webviewCss: css, method: 'scan' };
  } catch {
    /* no webview folder */
  }
  return null;
}

/** Extension folders VS Code (stable, Insiders, OSS builds) may use. */
export function extensionRoots(home: string = os.homedir()): string[] {
  const roots = new Set<string>();
  if (process.env.VSCODE_EXTENSIONS) roots.add(process.env.VSCODE_EXTENSIONS);
  for (const d of ['.vscode', '.vscode-insiders', '.vscode-oss', '.vscode-server', '.vscode-server-insiders']) {
    roots.add(path.join(home, d, 'extensions'));
  }
  return [...roots];
}

/** Every installed Claude Code version folder (all VS Code flavours). */
export function findClaudeInstallations(roots: string[] = extensionRoots()): string[] {
  const out: string[] = [];
  for (const root of roots) {
    let names: string[];
    try {
      names = fs.readdirSync(root);
    } catch {
      continue;
    }
    for (const name of names) {
      if (name.toLowerCase().startsWith(CLAUDE_EXTENSION_ID + '-')) out.push(path.join(root, name));
    }
  }
  return out;
}
