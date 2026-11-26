#!/usr/bin/env node
// mdview: render a Markdown or text file and show it in a chromeless browser window
// with vim-style navigation and live reload.

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { render, isMarkdown, escapeHtml } from './render.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
// Vendored files are found through Node's resolution, not HERE/node_modules, since a
// package manager may hoist dependencies out of mdview's own folder.
const vendored = createRequire(import.meta.url).resolve;
const readVendored = (f) => fs.readFileSync(vendored(f), 'utf8');

// ---------- args ----------

// Same heuristic as git: a NUL byte near the start means binary.
const isBinary = (p) => {
  const buf = Buffer.alloc(8192);
  const fd = fs.openSync(p, 'r');
  const n = fs.readSync(fd, buf);
  fs.closeSync(fd);
  return buf.subarray(0, n).includes(0);
};

const USAGE = `usage: mdview <file | -> [--size WxH] [--pos X,Y] [--no-open] [--version]`;
const opts = { size: null, pos: null, open: true, file: null };
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === '--size') opts.size = argv[++i];
  else if (a === '--pos') opts.pos = argv[++i];
  else if (a === '--no-open') opts.open = false;
  else if (a === '-h' || a === '--help') { console.log(USAGE); process.exit(0); }
  else if (a === '-v' || a === '--version') {
    console.log(JSON.parse(fs.readFileSync(path.join(HERE, 'package.json'), 'utf8')).version);
    process.exit(0);
  }
  else if (!opts.file) opts.file = a;
  else { console.error(USAGE); process.exit(1); }
}
if (!opts.file) { console.error(USAGE); process.exit(1); }

// "-" reads Markdown from stdin. It's served as a virtual stdin.md in the current
// directory, so relative links and images resolve from there; there's no live reload.
const stdin = opts.file === '-' ? readStdin() : null;
const file = stdin === null ? path.resolve(opts.file) : path.resolve('stdin.md');
const isStdin = (p) => stdin !== null && p === file;

function readStdin() {
  if (process.stdin.isTTY) { console.error('mdview: nothing piped to stdin'); process.exit(1); }
  return fs.readFileSync(0, 'utf8');
}

if (stdin === null) {
  if (!fs.existsSync(file)) { console.error(`mdview: no such file: ${opts.file}`); process.exit(1); }
  if (!fs.statSync(file).isFile()) { console.error(`mdview: not a file: ${opts.file}`); process.exit(1); }
  if (!isMarkdown(file) && isBinary(file)) { console.error(`mdview: not a text file: ${opts.file}`); process.exit(1); }
}

// Serve from the git root (so ../images work inside a repo), else the file's directory.
let root = path.dirname(file);
try {
  root = execFileSync('git', ['-C', root, 'rev-parse', '--show-toplevel'], { stdio: ['ignore', 'pipe', 'ignore'] })
    .toString().trim() || root;
} catch {}

// ---------- markdown ----------

const renderFile = (p) => render(isStdin(p) ? stdin : fs.readFileSync(p, 'utf8'), isMarkdown(p));

// ---------- page ----------

const KATEX = path.dirname(vendored('katex/dist/katex.min.css'));
const css = [
  'github-markdown-css/github-markdown.css',
  'markdown-it-github-alerts/styles/github-base.css',
  'markdown-it-github-alerts/styles/github-colors-light.css',
  'markdown-it-github-alerts/styles/github-colors-dark-media.css',
].map(readVendored).join('\n')
  + `\n@media (prefers-color-scheme: light) {${readVendored('highlight.js/styles/github.css')}}`
  + `\n@media (prefers-color-scheme: dark) {${readVendored('highlight.js/styles/github-dark.css')}}`
  // The stylesheet is inlined, so point its relative font URLs at the /__katex/ route.
  + '\n' + fs.readFileSync(path.join(KATEX, 'katex.min.css'), 'utf8').replaceAll('url(fonts/', 'url(/__katex/fonts/')
  + '\n' + fs.readFileSync(path.join(HERE, 'page.css'), 'utf8');
const js = fs.readFileSync(path.join(HERE, 'page.js'), 'utf8');
const icon = 'data:image/svg+xml,' + encodeURIComponent(fs.readFileSync(path.join(HERE, 'icon.svg'), 'utf8'));

const page = (p) => `<!doctype html>
<html><head><meta charset="utf-8">
<title>${escapeHtml(path.basename(p))}</title>
<link rel="icon" type="image/svg+xml" href="${icon}">
<style>${css}</style>
</head><body class="markdown-body">
<article id="content">${renderFile(p)}</article>
<div id="mdview-bar" hidden><span>/</span><input id="mdview-search" spellcheck="false"></div>
<div id="mdview-status" hidden></div>
<div id="mdview-progress"></div>
<script>${js}</script>
</body></html>`;

// ---------- server ----------

const MIME = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif',
  '.svg': 'image/svg+xml', '.webp': 'image/webp', '.ico': 'image/x-icon', '.pdf': 'application/pdf',
  '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript',
  '.json': 'application/json', '.txt': 'text/plain; charset=utf-8',
  '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf',
};
// The absolute path for a request path, or null when it falls outside the serve root.
const inRoot = (p) => {
  const abs = path.join(root, p);
  return abs === root || abs.startsWith(root + path.sep) ? abs : null;
};
const urlFor = (p) => '/' + path.relative(root, p).split(path.sep).map(encodeURIComponent).join('/');

// Exit once the window is closed: no live event streams for a short grace period.
let clients = 0;
let exitTimer = setTimeout(() => process.exit(0), 30_000); // window never connected
const clientGone = () => {
  if (--clients === 0) exitTimer = setTimeout(() => process.exit(0), 1500);
};

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');

  if (url.pathname === '/') {
    res.writeHead(302, { Location: urlFor(file) });
    return res.end();
  }
  if (url.pathname === '/__quit') {
    res.end();
    return setTimeout(() => process.exit(0), 50);
  }
  if (url.pathname.startsWith('/__katex/fonts/')) {
    const font = path.join(KATEX, 'fonts', path.basename(url.pathname));
    return fs.readFile(font, (err, data) => {
      res.writeHead(err ? 404 : 200, { 'Content-Type': MIME[path.extname(font)] ?? 'application/octet-stream' });
      res.end(err ? undefined : data);
    });
  }
  if (url.pathname === '/__open' && req.method === 'POST') {
    if (req.headers.origin !== `http://${req.headers.host}`) { // only our own pages
      res.writeHead(403);
      return res.end();
    }
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      res.writeHead(openExternal(body) ? 204 : 400);
      res.end();
    });
    return;
  }

  let target;
  try { target = inRoot(decodeURIComponent(url.pathname)); } catch { // malformed %-escape
    res.writeHead(400);
    return res.end();
  }
  // searchParams.get has already decoded `path`, so it isn't decoded again.
  const watched = url.pathname === '/__events' ? inRoot(url.searchParams.get('path') ?? '') : undefined;
  if (!target || watched === null) {
    res.writeHead(403);
    return res.end();
  }

  if (watched) {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });
    res.write(': hi\n\n');
    clients++;
    clearTimeout(exitTimer);
    if (isStdin(watched)) return req.on('close', clientGone);
    // Watch the directory, not the file: editors like Neovim save by rename.
    // A missing or deleted directory just means no reloads; the stream stays open for the lifecycle.
    let debounce, watcher;
    try {
      watcher = fs.watch(path.dirname(watched), (_, name) => {
        if (name !== path.basename(watched)) return;
        clearTimeout(debounce);
        debounce = setTimeout(() => res.write('data: reload\n\n'), 50);
      }).on('error', () => {});
    } catch {}
    req.on('close', () => { watcher?.close(); clientGone(); });
    return;
  }

  fs.stat(target, (err, st) => {
    if (!isStdin(target) && (err || !st.isFile())) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      return res.end('not found');
    }
    try {
      if (isMarkdown(target) || target === file) {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
        return res.end(url.searchParams.has('fragment') ? renderFile(target) : page(target));
      }
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'text/plain' });
      return res.end(String(e));
    }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(target).toLowerCase()] ?? 'application/octet-stream' });
    fs.createReadStream(target).pipe(res);
  });
});

// ---------- window ----------

const isWSL = fs.existsSync('/proc/version') && /microsoft/i.test(fs.readFileSync('/proc/version', 'utf8'));

function findBrowser() {
  if (process.env.MDVIEW_BROWSER) return process.env.MDVIEW_BROWSER;
  const macApps = ['Google Chrome.app/Contents/MacOS/Google Chrome',
                   'Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
                   'Chromium.app/Contents/MacOS/Chromium',
                   'Brave Browser.app/Contents/MacOS/Brave Browser'];
  const candidates = isWSL
    ? ['/mnt/c/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
       '/mnt/c/Program Files/Microsoft/Edge/Application/msedge.exe',
       '/mnt/c/Program Files/Google/Chrome/Application/chrome.exe']
    : process.platform === 'darwin'
      ? ['/Applications', path.join(os.homedir(), 'Applications')].flatMap((dir) => macApps.map((app) => path.join(dir, app)))
      : ['/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/microsoft-edge'];
  return candidates.find((c) => fs.existsSync(c));
}

// e.g. "chrome", "msedge", "google-chrome", "microsoft-edge"
const browserName = (browser) =>
  path.basename(browser).replace(/\.exe$/i, '').toLowerCase().replace(/[^a-z0-9]+/g, '-');

// Separate profile so mdview windows don't attach to your normal browser session
// (which would ignore --window-size/--window-position). One per browser, since
// browsers can't safely share a user-data-dir.
function profileDir(browser) {
  const name = browserName(browser);
  if (process.platform === 'darwin') return path.join(os.homedir(), 'Library', 'Caches', 'mdview', name);
  if (!isWSL) return path.join(process.env.XDG_CACHE_HOME ?? path.join(os.homedir(), '.cache'), 'mdview', name);
  // Asking cmd.exe is slow, so the answer is cached. Not in mdview's own folder, which
  // is read-only after a global npm install.
  const cache = path.join(process.env.XDG_CACHE_HOME ?? path.join(os.homedir(), '.cache'), 'mdview', 'localappdata');
  let local;
  try { local = fs.readFileSync(cache, 'utf8').trim(); } catch {}
  if (!local) {
    local = execFileSync('cmd.exe', ['/c', 'echo %LOCALAPPDATA%'], { cwd: '/mnt/c', stdio: ['ignore', 'pipe', 'ignore'] })
      .toString().trim();
    try {
      fs.mkdirSync(path.dirname(cache), { recursive: true });
      fs.writeFileSync(cache, local);
    } catch {}
  }
  return `${local}\\mdview\\${name}`;
}

// Open a link in the user's default browser (links never navigate the viewer window away).
function openExternal(link) {
  let url;
  try { url = new URL(link); } catch { return false; }
  if (!['http:', 'https:', 'mailto:'].includes(url.protocol)) return false;
  const [cmd, args] = isWSL ? ['rundll32.exe', ['url.dll,FileProtocolHandler', url.href]]
    : process.platform === 'darwin' ? ['open', [url.href]]
    : ['xdg-open', [url.href]];
  spawn(cmd, args, { detached: true, stdio: 'ignore', cwd: isWSL ? '/mnt/c' : undefined })
    .on('error', () => {}).unref();
  return true;
}

// Turn off Edge's "mini menu" (the popup toolbar over selected text). Pages can't suppress it,
// so set the profile pref directly.
function disableMiniMenu(profile) {
  const dir = path.join(isWSL ? execFileSync('wslpath', ['-u', profile]).toString().trim() : profile, 'Default');
  const file = path.join(dir, 'Preferences');
  let prefs = {};
  try { prefs = JSON.parse(fs.readFileSync(file, 'utf8')); } catch {}
  if (prefs.edge_quick_search?.show_mini_menu === false) return;
  prefs.edge_quick_search = { ...prefs.edge_quick_search, show_mini_menu: false };
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(file, JSON.stringify(prefs));
}

function openWindow(url) {
  const browser = findBrowser();
  if (!browser) {
    console.error(`mdview: no Chromium-based browser found; set MDVIEW_BROWSER. Open ${url} manually.`);
    return;
  }
  const profile = profileDir(browser);
  if (/edge/.test(browserName(browser))) {
    try { disableMiniMenu(profile); } catch {}
  }
  const args = [`--app=${url}`, `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check'];
  if (opts.size) args.push(`--window-size=${opts.size.replace('x', ',')}`);
  if (opts.pos) args.push(`--window-position=${opts.pos}`);
  if (process.platform === 'darwin') quitBrowserWhenLast(profile);
  spawn(browser, args, { detached: true, stdio: 'ignore', cwd: isWSL ? '/mnt/c' : undefined }).unref();
}

// macOS keeps an app running after its last window closes, so the profile's browser
// would linger in the Dock. Every mdview that opens a window registers its pid next
// to the profile, and the last one to exit quits the browser whose pid is in the
// profile's SingletonLock ("<hostname>-<pid>"). Registered before spawning, so an
// mdview that is just starting keeps the browser alive.
function quitBrowserWhenLast(profile) {
  const dir = `${profile}.instances`;
  const me = path.join(dir, String(process.pid));
  try {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(me, '');
  } catch { return; }
  process.on('exit', () => {
    try {
      fs.rmSync(me, { force: true });
      const alive = fs.readdirSync(dir).filter((name) => {
        try { process.kill(Number(name), 0); return true; } catch (e) {
          if (e.code === 'EPERM') return true;
          fs.rmSync(path.join(dir, name), { force: true });
          return false;
        }
      });
      if (alive.length) return;
      const pid = Number(fs.readlinkSync(path.join(profile, 'SingletonLock')).split('-').pop());
      if (pid > 0) process.kill(pid, 'SIGTERM');
    } catch {}
  });
}

// In WSL's NAT mode, Windows reaches WSL's localhost through a relay that takes up to
// ~1.5s to pick up a new port, so the window often loads before it's reachable.
// The VM's own address is reachable from Windows immediately (and only from the host).
// Not used in mirrored mode, where that address is the machine's LAN IP.
function listenHost() {
  if (!isWSL) return '127.0.0.1';
  try {
    if (execFileSync('wslinfo', ['--networking-mode'], { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim() !== 'nat') {
      return '127.0.0.1';
    }
  } catch { return '127.0.0.1'; }
  const vnic = os.networkInterfaces().eth0?.find((a) => a.family === 'IPv4');
  return vnic?.address ?? '127.0.0.1';
}

const host = listenHost();
server.listen(0, host, () => {
  const url = `http://${host === '127.0.0.1' ? 'localhost' : host}:${server.address().port}${urlFor(file)}`;
  if (opts.open) openWindow(url);
  else console.log(url);
});
