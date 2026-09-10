/** Rebuild author inputs serially before restarting the Hugo development server. */
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import chokidar from 'chokidar';
import path from 'node:path';
import { buildSite } from './build.mjs';
import { root } from './lib.mjs';

let server;
let running = false;
let pending = false;
let closing = false;
let timer;
/** Stop the managed Hugo process. @returns {Promise<void>} Completion. */
async function stopServer() {
  if (!server || server.exitCode !== null || server.signalCode !== null) return;
  const stopped = once(server, 'exit');
  server.kill('SIGTERM');
  await stopped;
}
/** Rebuild once, coalescing edits arriving during a build. @returns {Promise<void>} Completion. */
async function rebuild() {
  if (running) {
    pending = true;
    return;
  }
  running = true;
  try {
    await stopServer();
    const { finalConfig, commonArgs } = await buildSite({ development: true });
    if (closing) return;
    server = spawn(
      'hugo',
      [
        'server',
        '--config',
        `hugo.toml,${finalConfig}`,
        '--environment',
        'development',
        '--port',
        '1313',
        '--bind',
        '127.0.0.1',
        '--watch=false',
        '--disableFastRender',
        '--destination',
        path.join(root, '.build/dev-server'),
        ...commonArgs,
      ],
      { cwd: root, stdio: 'inherit' },
    );
    server.on('error', (error) => console.error(error));
    server.on('exit', (code) => {
      if (code) console.error(`Hugo server exited with ${code}`);
    });
  } catch (error) {
    console.error(error);
  } finally {
    running = false;
    if (pending && !closing) {
      pending = false;
      await rebuild();
    }
  }
}
const watcher = chokidar.watch(
  [
    'content',
    'assets',
    'layouts',
    'data',
    'static',
    'i18n',
    'scripts',
    'hugo.toml',
    'package-lock.json',
  ].map((name) => path.join(root, name)),
  { ignoreInitial: true },
);
watcher.on('all', () => {
  clearTimeout(timer);
  timer = setTimeout(rebuild, 150);
});
/** Close watchers and the development child on interruption. @returns {Promise<void>} Completion. */
async function shutdown() {
  closing = true;
  clearTimeout(timer);
  await watcher.close();
  await stopServer();
}
process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
await rebuild();
