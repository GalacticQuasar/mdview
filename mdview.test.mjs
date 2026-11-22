// Tests for mdview: `npm test` (node --test). Rendering is tested through render.mjs
// directly; the server through a real `mdview --no-open` process.

import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { render } from './render.mjs';

const MDVIEW = path.join(path.dirname(fileURLToPath(import.meta.url)), 'mdview.mjs');
const hasMath = (html) => html.includes('class="katex"');

describe('render', () => {
  test('gives headings GitHub-style ids, numbering duplicates', () => {
    const html = render('# Hello, World!\n\n## Hello, World!');
    assert.match(html, /<h1 id="hello-world">/);
    assert.match(html, /<h2 id="hello-world-1">/);
  });

  test('renders inline math', () => {
    assert.ok(hasMath(render('Area is $x^2$.')));
    assert.ok(hasMath(render('Area is $`x^2`$.')));
  });

  test('leaves prices and escaped dollars as text', () => {
    for (const src of ['It costs $5 and $10.', 'Between $5-$10', 'A lone $ sign', 'Escaped \\$x\\$ here', '$ x$', '$x $']) {
      assert.ok(!hasMath(render(src)), src);
    }
  });

  test('renders $$ in a paragraph as display math', () => {
    assert.match(render('Sum: $$\\sum x$$ done'), /katex-display/);
  });

  test('renders $$ blocks on one line or across lines', () => {
    assert.match(render('$$ a = b $$'), /katex-display/);
    assert.match(render('$$\na = b\n$$'), /katex-display/);
  });

  test('renders ```math fences as display math', () => {
    const html = render('```math\na = b\n```');
    assert.match(html, /katex-display/);
    assert.ok(!html.includes('<pre>'));
  });

  test('shows KaTeX errors inline instead of throwing', () => {
    assert.match(render('$\\frac{$'), /class="katex-error"/);
  });

  test('shows YAML frontmatter as a highlighted block', () => {
    const html = render('---\ntitle: x\n---\n# Body');
    assert.match(html, /^<pre class="frontmatter"><code class="hljs language-yaml">/);
    assert.ok(!html.includes('<hr>'));
    assert.match(html, /<h1 id="body">/);
  });

  test('drops empty frontmatter', () => {
    assert.equal(render('---\n---\n# Body'), render('# Body'));
  });

  test('renders GitHub alerts', () => {
    assert.match(render('> [!NOTE]\n> Careful'), /markdown-alert-note/);
  });

  test('renders task lists with GitHub classes, nested too', () => {
    const html = render('- [x] done\n- [ ] todo\n  - [X] nested\n- not [x] a task\n- [x]');
    assert.equal(html.match(/<ul class="contains-task-list">/g).length, 2);
    assert.equal(html.match(/<li class="task-list-item"><input type="checkbox" class="task-list-item-checkbox" disabled checked> /g).length, 2);
    assert.match(html, /<li class="task-list-item"><input type="checkbox" class="task-list-item-checkbox" disabled> todo/);
    assert.match(html, /<li>not \[x\] a task<\/li>/);
    assert.match(html, /<li>\[x\]<\/li>/);
  });

  test('shows non-Markdown text verbatim', () => {
    assert.equal(render('﻿<b>*x*</b> $y$\n', false), '<pre class="plain-text">&lt;b&gt;*x*&lt;/b&gt; $y$\n</pre>');
  });
});

describe('server', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mdview-test-'));
  fs.writeFileSync(path.join(dir, 'doc.md'), '# Doc\n\n[other](other.md)');
  fs.writeFileSync(path.join(dir, 'other.md'), '# Other');
  fs.writeFileSync(path.join(dir, 'notes.txt'), '*plain*');
  fs.writeFileSync(path.join(dir, 'binary.dat'), Buffer.from([1, 0, 2]));
  const children = [];
  after(() => {
    for (const c of children) c.kill();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  // Starts mdview --no-open and resolves with the URL it prints as its first line.
  const start = (args, input) => new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [MDVIEW, ...args, '--no-open'], { cwd: dir });
    children.push(child);
    const timer = setTimeout(() => reject(new Error('mdview printed no URL within 5s')), 5000);
    const done = (fn, value) => { clearTimeout(timer); fn(value); };
    let out = '';
    child.stdout.on('data', (d) => {
      out += d;
      const nl = out.indexOf('\n');
      if (nl < 0) return;
      try { done(resolve, new URL(out.slice(0, nl))); } catch (e) { done(reject, e); }
    });
    child.on('exit', (code) => done(reject, new Error(`mdview exited with ${code}`)));
    if (input !== undefined) child.stdin.end(input);
  });

  // http.get rather than fetch, which would normalize away `..` segments.
  const get = (base, pathname) => new Promise((resolve, reject) => {
    http.get({ host: base.hostname, port: base.port, path: pathname }, (res) => {
      let body = '';
      res.on('data', (c) => { body += c; });
      res.on('end', () => resolve({ status: res.statusCode, type: res.headers['content-type'], body }));
    }).on('error', reject);
  });

  test('serves the page and the ?fragment for live reload', async () => {
    const url = await start(['doc.md']);
    const page = await get(url, '/doc.md');
    assert.equal(page.status, 200);
    assert.match(page.body, /^<!doctype html>/);
    assert.match(page.body, /<title>doc\.md<\/title>/);
    const fragment = await get(url, '/doc.md?fragment');
    assert.equal(fragment.body.trim(), '<h1 id="doc">Doc</h1>\n<p><a href="other.md">other</a></p>');
  });

  test('renders other Markdown files and serves other files as static', async () => {
    const url = await start(['doc.md']);
    assert.match((await get(url, '/other.md?fragment')).body, /<h1 id="other">/);
    const txt = await get(url, '/notes.txt');
    assert.equal(txt.body, '*plain*');
    assert.match(txt.type, /^text\/plain/);
    assert.equal((await get(url, '/missing.md')).status, 404);
  });

  test('refuses paths outside the serve root', async () => {
    const url = await start(['doc.md']);
    assert.equal((await get(url, '/..%2f..%2fetc%2fpasswd')).status, 403);
  });

  // The status of a request that may never end (the event stream), closed once headers arrive.
  const status = (base, pathname) => new Promise((resolve, reject) => {
    http.get({ host: base.hostname, port: base.port, path: pathname }, (res) => {
      resolve(res.statusCode);
      res.destroy();
    }).on('error', reject);
  });

  test('survives malformed %-escapes', async () => {
    const url = await start(['doc.md']);
    assert.equal((await get(url, '/%E0')).status, 400);
    assert.equal((await get(url, '/doc.md')).status, 200);
  });

  test('keeps the event stream open for a missing directory and checks its root', async () => {
    const url = await start(['doc.md']);
    assert.equal(await status(url, '/__events?path=' + encodeURIComponent('/gone/x.md')), 200);
    assert.equal(await status(url, '/__events?path=' + encodeURIComponent('/../../x.md')), 403);
    assert.equal((await get(url, '/doc.md')).status, 200);
  });

  test('watches files with % in their name', async () => {
    fs.writeFileSync(path.join(dir, '100%.md'), '# Full');
    const url = await start(['100%.md']);
    assert.equal(url.pathname, '/100%25.md');
    assert.equal(await status(url, '/__events?path=' + encodeURIComponent('/100%.md')), 200);
    assert.equal((await get(url, '/100%25.md')).status, 200);
  });

  test('shows a text file named on the command line as a page', async () => {
    const url = await start(['notes.txt']);
    assert.equal((await get(url, '/notes.txt?fragment')).body, '<pre class="plain-text">*plain*</pre>');
  });

  test('reads Markdown from stdin as a virtual stdin.md', async () => {
    const url = await start(['-'], '# From stdin');
    assert.equal(url.pathname, '/stdin.md');
    assert.equal((await get(url, '/stdin.md?fragment')).body.trim(), '<h1 id="from-stdin">From stdin</h1>');
    assert.match((await get(url, '/other.md?fragment')).body, /<h1 id="other">/);
  });

  test('refuses binary files and missing files', async () => {
    await assert.rejects(start(['binary.dat']), /exited with 1/);
    await assert.rejects(start(['nope.md']), /exited with 1/);
  });
});
