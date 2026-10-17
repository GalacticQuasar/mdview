// Vim-style navigation + live reload, injected into every rendered page.
(() => {
  const content = document.getElementById('content');
  const bar = document.getElementById('mdview-bar');
  const input = document.getElementById('mdview-search');
  const status = document.getElementById('mdview-status');

  const LINE = 60;
  const half = () => window.innerHeight / 2;
  const full = () => window.innerHeight - LINE;

  // Smooth scrolling: ease toward a target each frame. Repeated keys (e.g. holding j)
  // push the target further instead of restarting the animation.
  let target = null;
  let last = 0; // where we last put the page, to notice wheel/scrollbar taking over
  let lastTime = 0;
  const maxY = () => document.documentElement.scrollHeight - window.innerHeight;
  const step = (now) => {
    if (target === null) return;
    if (Math.abs(window.scrollY - last) > 2) { target = null; return; }
    const d = target - window.scrollY;
    if (Math.abs(d) <= 1) { window.scrollTo(0, target); target = null; return; }
    // Frame-rate independent ease-out (~25% of the remaining distance per 60Hz frame),
    // at least 1px so pixel snapping can't stall it just short of the target.
    const k = 1 - Math.pow(0.75, Math.min(now - lastTime, 100) / 16.7);
    lastTime = now;
    window.scrollTo(0, window.scrollY + Math.sign(d) * Math.max(1, Math.abs(d) * k));
    last = window.scrollY;
    requestAnimationFrame(step);
  };
  const scrollTo = (y) => {
    const animating = target !== null;
    target = Math.round(Math.max(0, Math.min(maxY(), y)));
    if (!animating) {
      last = window.scrollY;
      lastTime = performance.now();
      requestAnimationFrame(step);
    }
  };
  const scroll = (dy) => scrollTo((target ?? window.scrollY) + dy);

  let statusTimer;
  const flash = (msg) => {
    status.textContent = msg;
    status.hidden = false;
    clearTimeout(statusTimer);
    statusTimer = setTimeout(() => { status.hidden = true; }, 1200);
  };

  const headings = () => [...content.querySelectorAll('h1, h2, h3, h4, h5, h6')];
  const jumpHeading = (dir) => {
    const y = window.scrollY + 1;
    const hs = headings().map((h) => h.getBoundingClientRect().top + window.scrollY - 16);
    const next = dir > 0 ? hs.find((t) => t > y + 4) : hs.reverse().find((t) => t < y - 4);
    if (next !== undefined) scrollTo(next);
  };

  // Search via window.find (non-standard but supported by Chromium).
  let query = '';
  const find = (backwards) => {
    if (!query) return;
    if (!window.find(query, false, backwards, true)) return flash(`not found: ${query}`);
    const rect = window.getSelection().getRangeAt(0).getBoundingClientRect();
    if (rect.top < 0 || rect.bottom > window.innerHeight) {
      scrollTo(window.scrollY + rect.top - window.innerHeight / 3);
    }
  };

  // Multi-key sequences: gg, ]], [[
  let pending = '';
  let pendingTimer;
  const sequences = {
    gg: () => scrollTo(0),
    ']]': () => jumpHeading(1),
    '[[': () => jumpHeading(-1),
  };

  const ctrlKeys = {
    d: () => scroll(half()),
    u: () => scroll(-half()),
    f: () => scroll(full()),
    b: () => scroll(-full()),
    e: () => scroll(LINE),
    y: () => scroll(-LINE),
    o: () => history.back(),
    i: () => history.forward(),
  };

  const keys = {
    j: () => scroll(LINE),
    k: () => scroll(-LINE),
    d: () => scroll(half()),
    u: () => scroll(-half()),
    ' ': () => scroll(full()),
    G: () => scrollTo(maxY()),
    H: () => history.back(),
    L: () => history.forward(),
    '/': () => { bar.hidden = false; input.value = query; input.select(); input.focus(); },
    n: () => find(false),
    N: () => find(true),
    r: () => reload(),
    q: () => quit(),
  };

  document.addEventListener('keydown', (e) => {
    if (e.target === input || e.altKey || e.metaKey) return;
    if (e.ctrlKey) {
      const fn = ctrlKeys[e.key.toLowerCase()];
      if (fn) { e.preventDefault(); fn(); }
      return;
    }
    if (e.key === 'Escape') { pending = ''; window.getSelection().removeAllRanges(); return; }

    pending += e.key;
    clearTimeout(pendingTimer);
    if (sequences[pending]) { e.preventDefault(); sequences[pending](); pending = ''; return; }
    if (Object.keys(sequences).some((s) => s.startsWith(pending))) {
      e.preventDefault();
      pendingTimer = setTimeout(() => { pending = ''; }, 800);
      return;
    }
    pending = '';
    const fn = keys[e.key];
    if (fn) { e.preventDefault(); fn(); }
  });

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      query = input.value;
      bar.hidden = true;
      input.blur();
      window.getSelection().removeAllRanges();
      find(false);
    } else if (e.key === 'Escape') {
      bar.hidden = true;
      input.blur();
    }
    e.stopPropagation();
  });

  // No browser context menu: it's a viewer, not a browser.
  document.addEventListener('contextmenu', (e) => e.preventDefault());

  // ---------- live reload (keeps scroll position) ----------

  async function reload() {
    const res = await fetch(location.pathname + '?fragment', { cache: 'no-store' });
    if (!res.ok) return flash(`reload failed: ${res.status}`);
    const y = window.scrollY;
    content.innerHTML = await res.text();
    window.scrollTo({ top: y, behavior: 'instant' });
  }

  const events = new EventSource('/__events?path=' + encodeURIComponent(decodeURIComponent(location.pathname)));
  events.onmessage = (e) => { if (e.data === 'reload') reload(); };

  async function quit() {
    events.close();
    try { await fetch('/__quit'); } catch {}
    window.close();
  }
})();
