// Static server over docs/ for the browser tests, like GitHub Pages serves the site.
// It reuses the CLI's static handler and answers api/info with { mode: 'static' },
// so Eval Studio starts in browser mode without a 404 in the console.
// Usage: node serve.mjs [port]   (default 4180)

import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createStaticHandler } from '../../bin/pmstack.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const port = Number(process.argv[2]) || 4180;
const handle = createStaticHandler(path.resolve(here, '../../docs'));

http.createServer((req, res) => {
  const pathname = String(req.url || '/').split('?')[0];
  if (pathname.endsWith('/api/info')) {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end('{"mode":"static"}');
    return;
  }
  handle(req, res);
}).listen(port, '127.0.0.1', () => {
  process.stdout.write(`Serving docs/ at http://127.0.0.1:${port}/\n`);
});
