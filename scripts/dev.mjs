/** Maintainer asset watcher alongside Hugo's native content watcher. */
import { spawn } from 'node:child_process';
import chokidar from 'chokidar';
import path from 'node:path';
import { buildAssets } from './build-assets.mjs';
import { root } from './lib.mjs';

await buildAssets(root, true, root);
const server = spawn(
  'hugo',
  [
    'server',
    '--source',
    path.join(root, 'exampleSite'),
    '--themesDir',
    path.dirname(root),
    '--environment',
    'development',
    '--bind',
    '0.0.0.0',
    '--port',
    '1313',
    '--disableFastRender',
  ],
  { cwd: root, stdio: 'inherit' },
);
server.on('error', (error) => console.error(error));
let running = false;
let pending = false;
let timer;
/** Serialize asset rebuilds, coalescing changes during compilation. @returns {Promise<void>} Completion. */
async function rebuildAssets() {
  if (running) {
    pending = true;
    return;
  }
  running = true;
  try {
    await buildAssets(root, true, root);
  } catch (error) {
    console.error(error);
  } finally {
    running = false;
    if (pending) {
      pending = false;
      await rebuildAssets();
    }
  }
}
const watcher = chokidar.watch(
  ['assets/css/main.css', 'assets/css/components', 'assets/js', 'layouts'].map(
    (name) => path.join(root, name),
  ),
  { ignoreInitial: true },
);
watcher.on('all', () => {
  clearTimeout(timer);
  timer = setTimeout(rebuildAssets, 150);
});
/** Stop the watcher and development server. @returns {Promise<void>} Completion. */
async function shutdown() {
  clearTimeout(timer);
  await watcher.close();
  server.kill('SIGTERM');
}
process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
server.once('exit', () => {
  clearTimeout(timer);
  void watcher.close();
});
