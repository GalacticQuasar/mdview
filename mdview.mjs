#!/usr/bin/env node
// mdview: render a Markdown file and show it in a chromeless browser window
// with vim-style navigation and live reload.

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import MarkdownIt from 'markdown-it';
import githubAlerts from 'markdown-it-github-alerts';
import hljs from 'highlight.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MODULES = path.join(HERE, 'node_modules');

// ---------- args ----------

const USAGE = `usage: mdview <file.md> [--size WxH] [--pos X,Y] [--no-open]`;
const opts = { size: null, pos: null, open: true, file: null };
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === '--size') opts.size = argv[++i];
  else if (a === '--pos') opts.pos = argv[++i];
  else if (a === '--no-open') opts.open = false;
  else if (a === '-h' || a === '--help') { console.log(USAGE); process.exit(0); }
  else if (!opts.file) opts.file = a;
  else { console.error(USAGE); process.exit(1); }
}
if (!opts.file) { console.error(USAGE); process.exit(1); }

const file = path.resolve(opts.file);
if (!fs.existsSync(file)) { console.error(`mdview: no such file: ${opts.file}`); process.exit(1); }

// Serve from the git root (so ../images work inside a repo), else the file's directory.
let root = path.dirname(file);
try {
  root = execFileSync('git', ['-C', root, 'rev-parse', '--show-toplevel'], { stdio: ['ignore', 'pipe', 'ignore'] })
    .toString().trim() || root;
} catch {}

// ---------- markdown ----------

const md = new MarkdownIt({
  html: true,
  linkify: true,
  typographer: true,
  highlight(code, lang) {
    if (lang && hljs.getLanguage(lang)) {
      return `<pre><code class="hljs language-${lang}">${hljs.highlight(code, { language: lang, ignoreIllegals: true }).value}</code></pre>`;
    }
    return '';
  },
}).use(githubAlerts);

// GitHub-style heading ids so #anchor links work.
md.core.ruler.push('heading_ids', (state) => {
  const seen = new Map();
  state.tokens.forEach((tok, i) => {
    if (tok.type !== 'heading_open') return;
    const text = state.tokens[i + 1].children.map((c) => c.content).join('');
    let slug = text.toLowerCase().trim().replace(/[^\p{L}\p{N}\s_-]/gu, '').replace(/\s/g, '-');
    const n = seen.get(slug) ?? 0;
    seen.set(slug, n + 1);
    if (n) slug += `-${n}`;
    tok.attrSet('id', slug);
  });
});

const render = (p) => md.render(fs.readFileSync(p, 'utf8'));

// ---------- page ----------

const css = [
  'github-markdown-css/github-markdown.css',
  'markdown-it-github-alerts/styles/github-base.css',
  'markdown-it-github-alerts/styles/github-colors-light.css',
  'markdown-it-github-alerts/styles/github-colors-dark-media.css',
].map((f) => fs.readFileSync(path.join(MODULES, f), 'utf8')).join('\n')
  + `\n@media (prefers-color-scheme: light) {${fs.readFileSync(path.join(MODULES, 'highlight.js/styles/github.css'), 'utf8')}}`
  + `\n@media (prefers-color-scheme: dark) {${fs.readFileSync(path.join(MODULES, 'highlight.js/styles/github-dark.css'), 'utf8')}}`
  + '\n' + fs.readFileSync(path.join(HERE, 'page.css'), 'utf8');
const js = fs.readFileSync(path.join(HERE, 'page.js'), 'utf8');
const icon = 'data:image/svg+xml,' + encodeURIComponent(fs.readFileSync(path.join(HERE, 'icon.svg'), 'utf8'));

const escapeHtml = (s) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

const page = (p) => `<!doctype html>
<html><head><meta charset="utf-8">
<title>${escapeHtml(path.basename(p))}</title>
<link rel="icon" type="image/svg+xml" href="${icon}">
<style>${css}</style>
</head><body class="markdown-body">
<article id="content">${render(p)}</article>
<div id="mdview-bar" hidden><span>/</span><input id="mdview-search" spellcheck="false"></div>
<div id="mdview-status" hidden></div>
<script>${js}</script>
</body></html>`;

// ---------- server ----------

const MIME = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif',
  '.svg': 'image/svg+xml', '.webp': 'image/webp', '.ico': 'image/x-icon', '.pdf': 'application/pdf',
  '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript',
  '.json': 'application/json', '.txt': 'text/plain; charset=utf-8',
};
const isMarkdown = (p) => /\.(md|markdown|mdown|mkd)$/i.test(p);
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

  const target = path.join(root, decodeURIComponent(url.pathname));
  if (target !== root && !target.startsWith(root + path.sep)) {
    res.writeHead(403);
    return res.end();
  }

  if (url.pathname === '/__events') {
    const watched = path.join(root, decodeURIComponent(url.searchParams.get('path') ?? ''));
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });
    res.write(': hi\n\n');
    clients++;
    clearTimeout(exitTimer);
    // Watch the directory, not the file: editors like Neovim save by rename.
    let debounce;
    const watcher = fs.watch(path.dirname(watched), (_, name) => {
      if (name !== path.basename(watched)) return;
      clearTimeout(debounce);
      debounce = setTimeout(() => res.write('data: reload\n\n'), 50);
    });
    req.on('close', () => { watcher.close(); clientGone(); });
    return;
  }

  fs.stat(target, (err, st) => {
    if (err || !st.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      return res.end('not found');
    }
    try {
      if (isMarkdown(target)) {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
        return res.end(url.searchParams.has('fragment') ? render(target) : page(target));
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
  const cache = path.join(HERE, '.localappdata');
  let local;
  try { local = fs.readFileSync(cache, 'utf8').trim(); } catch {}
  if (!local) {
    local = execFileSync('cmd.exe', ['/c', 'echo %LOCALAPPDATA%'], { cwd: '/mnt/c', stdio: ['ignore', 'pipe', 'ignore'] })
      .toString().trim();
    fs.writeFileSync(cache, local);
  }
  return `${local}\\mdview\\${name}`;
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
  spawn(browser, args, { detached: true, stdio: 'ignore', cwd: isWSL ? '/mnt/c' : undefined }).unref();
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
