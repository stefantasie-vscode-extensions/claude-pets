// dist/hook.js – registered as an async command hook in ~/.claude/settings.json.
// Reads the hook payload from stdin and forwards a slimmed copy to the running Claude Pets
// bridges. It never writes to stdout/stderr (stdout can influence Claude) and always exits 0.
import * as http from 'node:http';
import { slimHookPayload } from './shared/events';
import { instancesForCwd, readInstances } from './instances';

const POST_TIMEOUT_MS = 300;
const STDIN_TIMEOUT_MS = 2000;
const MAX_STDIN = 4 * 1024 * 1024;

function silenceAndExit(): never {
  process.exit(0);
}

process.on('uncaughtException', silenceAndExit);
process.on('unhandledRejection', silenceAndExit);
// Hard upper bound, whatever happens (main() normally finishes long before).
setTimeout(silenceAndExit, STDIN_TIMEOUT_MS + 1000);

function readStdin(): Promise<string> {
  return new Promise((resolve) => {
    if (process.stdin.isTTY) return resolve('');
    const chunks: Buffer[] = [];
    let size = 0;
    const done = () => resolve(Buffer.concat(chunks).toString('utf8'));
    const timer = setTimeout(done, STDIN_TIMEOUT_MS);
    process.stdin.on('data', (c: Buffer) => {
      size += c.length;
      if (size <= MAX_STDIN) chunks.push(c);
    });
    process.stdin.on('end', () => {
      clearTimeout(timer);
      done();
    });
    process.stdin.on('error', () => {
      clearTimeout(timer);
      done();
    });
  });
}

function post(port: number, token: string, body: string): Promise<void> {
  return new Promise((resolve) => {
    const req = http.request(
      {
        host: '127.0.0.1',
        port,
        path: '/event',
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'content-length': Buffer.byteLength(body),
          'x-claude-pets-token': token,
        },
        timeout: POST_TIMEOUT_MS,
      },
      (res) => {
        res.resume();
        res.on('end', () => resolve());
        res.on('error', () => resolve());
      },
    );
    req.on('timeout', () => {
      req.destroy();
      resolve();
    });
    req.on('error', () => resolve());
    req.end(body);
  });
}

async function main(): Promise<void> {
  const input = await readStdin();
  let payload: unknown;
  try {
    payload = JSON.parse(input);
  } catch {
    return;
  }
  const slim = slimHookPayload(payload);
  if (!slim) return;
  const targets = instancesForCwd(readInstances(), typeof slim.cwd === 'string' ? slim.cwd : undefined);
  if (targets.length === 0) return;
  const body = JSON.stringify(slim);
  await Promise.all(targets.map((t) => post(t.port, t.token, body)));
}

main().then(silenceAndExit, silenceAndExit);
