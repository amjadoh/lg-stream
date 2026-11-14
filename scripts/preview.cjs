'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '../app');
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.png': 'image/png' };
const allowed = new Set(['/', '/index.html', '/app.js', '/core.js', '/playlist.js', '/speed-test.js', '/style.css', '/appinfo.json', '/icon.png']);
http.createServer((req, res) => {
  let pathname;
  try { pathname = new URL(req.url, 'http://localhost').pathname; } catch { res.writeHead(400).end(); return; }
  if (req.method !== 'GET' || !allowed.has(pathname)) { res.writeHead(404).end(); return; }
  const file = path.join(root, pathname === '/' ? 'index.html' : pathname.slice(1));
  fs.readFile(file, (error, contents) => {
    if (error) { res.writeHead(404).end(); return; }
    res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' });
    res.end(contents);
  });
}).listen(4173, '127.0.0.1', () => console.log('Preview: http://127.0.0.1:4173 (browser preview does not validate LG playback or Dolby support)'));
