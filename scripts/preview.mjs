/** Serve the verified static output over loopback HTTP. */
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { root } from './lib.mjs';

const directory = path.join(root, 'public');
await stat(path.join(directory, 'index.html')).catch(() => {
  throw new Error('Run npm run build before preview.');
});
const types = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css',
  '.js': 'text/javascript',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.xml': 'application/xml',
  '.jpg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
};
const server = createServer(async (request, response) => {
  try {
    if (!['GET', 'HEAD'].includes(request.method)) {
      response.writeHead(405);
      response.end();
      return;
    }
    const pathname = decodeURIComponent(
      new URL(request.url, 'http://localhost').pathname,
    );
    let file = path.resolve(directory, `.${pathname}`);
    if (file !== directory && !file.startsWith(`${directory}${path.sep}`)) {
      response.writeHead(403);
      response.end();
      return;
    }
    if ((await stat(file)).isDirectory()) file = path.join(file, 'index.html');
    const body = await readFile(file);
    response.writeHead(200, {
      'Content-Type': types[path.extname(file)] ?? 'application/octet-stream',
      'Cache-Control': 'no-cache',
    });
    response.end(request.method === 'HEAD' ? undefined : body);
  } catch (error) {
    const code = error.code === 'ENOENT' ? 404 : 400;
    response.writeHead(code, { 'Content-Type': 'text/plain; charset=utf-8' });
    response.end(code === 404 ? '页面未找到' : '请求无效');
  }
});
server.listen(4173, '127.0.0.1', () =>
  console.log('Preview: http://localhost:4173/'),
);
process.once('SIGINT', () => server.close());
process.once('SIGTERM', () => server.close());
