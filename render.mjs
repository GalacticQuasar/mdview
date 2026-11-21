// Markdown rendering for mdview: markdown-it with GitHub-style heading ids, alerts,
// KaTeX math and YAML frontmatter.

import MarkdownIt from 'markdown-it';
import githubAlerts from 'markdown-it-github-alerts';
import hljs from 'highlight.js';
import katex from 'katex';

export const isMarkdown = (p) => /\.(md|markdown|mdown|mkd)$/i.test(p);

export const escapeHtml = (s) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

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

// GitHub-style math, rendered with KaTeX: $inline$, $`inline`$, $$display$$ and ```math blocks.
const tex = (src, displayMode) => katex.renderToString(src, { displayMode, throwOnError: false });

const isSpace = (c) => c === ' ' || c === '\t' || c === '\n';

md.inline.ruler.before('escape', 'math_inline', (state, silent) => {
  const src = state.src, start = state.pos;
  if (src[start] !== '$') return false;
  let open = '$', close = '$';
  if (src[start + 1] === '`') { open = '$`'; close = '`$'; }
  else if (src[start + 1] === '$') { open = close = '$$'; }
  const from = start + open.length;
  if (open === '$' && (from >= state.posMax || isSpace(src[from]))) return false;
  let end = from;
  for (;;) {
    end = src.indexOf(close, end);
    if (end < 0 || end + close.length > state.posMax) return false;
    if (open !== '$') break;
    if (src[end - 1] === '\\') { end++; continue; } // \$ inside math
    // A lone $ must close at the next $, after a non-space and before a non-digit,
    // so "$5-$10" stays text.
    if (isSpace(src[end - 1]) || /\d/.test(src[end + 1] ?? '')) return false;
    break;
  }
  if (end === from) return false;
  if (!silent) {
    const tok = state.push('math_inline', 'math', 0);
    tok.content = src.slice(from, end);
    tok.markup = open;
  }
  state.pos = end + close.length;
  return true;
});

// $$ on its own line(s): "$$ x $$", or "$$" ... "$$" across lines.
md.block.ruler.before('fence', 'math_block', (state, startLine, endLine, silent) => {
  if (state.sCount[startLine] - state.blkIndent >= 4) return false;
  const line = (n) => state.src.slice(state.bMarks[n] + state.tShift[n], state.eMarks[n]).trimEnd();
  const first = line(startLine);
  if (!first.startsWith('$$')) return false;
  let content, last = startLine;
  const rest = first.slice(2);
  if (rest.includes('$$')) {
    if (!rest.endsWith('$$') || rest.length < 3) return false; // "$$x$$ more text" is inline math
    content = rest.slice(0, -2);
  } else {
    const lines = [rest];
    for (;;) {
      if (++last >= endLine) return false;
      const l = line(last);
      if (l.endsWith('$$')) { lines.push(l.slice(0, -2)); break; }
      lines.push(l);
    }
    content = lines.join('\n');
  }
  if (silent) return true;
  state.line = last + 1;
  const tok = state.push('math_block', 'math', 0);
  tok.block = true;
  tok.content = content;
  tok.map = [startLine, state.line];
  return true;
}, { alt: ['paragraph', 'reference', 'blockquote', 'list'] });

md.renderer.rules.math_inline = (tokens, idx) => tex(tokens[idx].content, tokens[idx].markup === '$$');
md.renderer.rules.math_block = (tokens, idx) => tex(tokens[idx].content, true) + '\n';
const fence = md.renderer.rules.fence;
md.renderer.rules.fence = (tokens, idx, ...rest) =>
  tokens[idx].info.trim() === 'math' ? tex(tokens[idx].content, true) + '\n' : fence(tokens, idx, ...rest);

// YAML frontmatter (e.g. SKILL.md) is shown as a highlighted block instead of
// being parsed as Markdown, where it turned into an <hr> plus a setext heading.
const FRONTMATTER = /^﻿?---\r?\n([\s\S]*?\r?\n)?---[ \t]*(?:\r?\n|$)/;

// Markdown source to HTML; with markdown false, the text is shown verbatim.
export const render = (src, markdown = true) => {
  if (!markdown) return `<pre class="plain-text">${escapeHtml(src.replace(/^\uFEFF/, ''))}</pre>`;
  const m = src.match(FRONTMATTER);
  if (!m) return md.render(src);
  const body = md.render(src.slice(m[0].length));
  if (!m[1]?.trim()) return body;
  const yaml = hljs.highlight(m[1], { language: 'yaml', ignoreIllegals: true }).value;
  return `<pre class="frontmatter"><code class="hljs language-yaml">${yaml}</code></pre>\n${body}`;
};
