// Vim-style navigation + live reload, injected into every rendered page.
(() => {
  const content = document.getElementById('content');
  const bar = document.getElementById('mdview-bar');
  const input = document.getElementById('mdview-search');
  const status = document.getElementById('mdview-status');

  const LINE = 60;
  const half = () => window.innerHeight / 2;
  const full = () => window.innerHeight - LINE;

  // Smooth scrolling: ease toward a target each frame. Quick repeated presses (e.g. d d)
  // push the target further instead of restarting the animation.
  let target = null;
  let last = 0; // where we last put the page, to notice wheel/scrollbar taking over
  let lastTime = 0;
  let velocity = 0; // px/ms of the eased animation, so a hold can pick up where it left off
  // Fraction of the remaining distance covered per 60Hz frame.
  const EASE = 0.25;
  const EASE_HALF_PAGE = 0.16; // gentler for Ctrl-D/Ctrl-U, which travel much further
  let ease = EASE;
  const maxY = () => document.documentElement.scrollHeight - window.innerHeight;
  const step = (now) => {
    if (target === null) return;
    if (Math.abs(window.scrollY - last) > 2) { target = null; velocity = 0; return; }
    const d = target - window.scrollY;
    if (Math.abs(d) <= 1) { window.scrollTo(0, target); target = null; velocity = 0; return; }
    // Frame-rate independent ease-out, at least 1px so pixel snapping can't stall it
    // just short of the target.
    const dt = Math.min(now - lastTime, 100);
    const k = 1 - Math.pow(1 - ease, dt / 16.7);
    lastTime = now;
    const from = window.scrollY;
    window.scrollTo(0, from + Math.sign(d) * Math.max(1, Math.abs(d) * k));
    last = window.scrollY;
    if (dt > 0) velocity = (last - from) / dt;
    requestAnimationFrame(step);
  };
  const scrollTo = (y, rate = EASE) => {
    hideCursor();
    glide = null;
    ease = rate;
    const animating = target !== null;
    target = Math.round(Math.max(0, Math.min(maxY(), y)));
    if (!animating) {
      last = window.scrollY;
      lastTime = performance.now();
      requestAnimationFrame(step);
    }
  };
  const scroll = (dy, rate) => scrollTo((target ?? window.scrollY) + dy, rate);
  const halfPage = (dir) => scroll(dir * half(), EASE_HALF_PAGE);

  // Holding a line key: from the first auto-repeat on, scroll at a constant speed every frame.
  // Easing toward a target that each repeat bumps 60px makes the speed pulse at the repeat rate.
  const HOLD_SPEED = 1.8; // px/ms: LINE per repeat at Windows' default ~30/s repeat rate
  const HOLD_EASE = 70; // ms time constant for speeding up and slowing down
  let glide = null; // { key, dir, held, v, y, last, time }
  const holdLine = (key, dir) => {
    hideCursor();
    if (glide) { Object.assign(glide, { key, dir, held: true }); return; }
    const g = glide = {
      key, dir, held: true, v: velocity,
      y: window.scrollY, last: window.scrollY, time: performance.now(),
    };
    target = null; // take over from the eased tap
    const frame = (now) => {
      if (glide !== g) return;
      if (Math.abs(window.scrollY - g.last) > 2) { glide = null; return; } // wheel/scrollbar took over
      const dt = Math.min(now - g.time, 100);
      g.time = now;
      g.v += ((g.held ? g.dir * HOLD_SPEED : 0) - g.v) * (1 - Math.exp(-dt / HOLD_EASE));
      g.y = Math.max(0, Math.min(maxY(), g.y + g.v * dt)); // keep the fraction; scrollY snaps to pixels
      window.scrollTo(0, g.y);
      g.last = window.scrollY;
      if (!g.held && (Math.abs(g.v) < 0.05 || g.y === 0 || g.y === maxY())) { glide = null; return; }
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  };
  const line = (e, dir) => (e.repeat ? holdLine(e.key.toLowerCase(), dir) : scroll(dir * LINE));
  const release = () => { if (glide) glide.held = false; };
  document.addEventListener('keyup', (e) => {
    if (glide && (e.key.toLowerCase() === glide.key || e.key === 'Control')) release();
  });
  window.addEventListener('blur', release);

  // Hide the mouse cursor while scrolling with the keyboard; moving the mouse brings it back.
  // Compare positions because Chromium can fire mousemove when content scrolls under a still cursor.
  let mouseX = -1;
  let mouseY = -1;
  function hideCursor() { document.documentElement.classList.add('hide-cursor'); }
  document.addEventListener('mousemove', (e) => {
    if (e.screenX === mouseX && e.screenY === mouseY) return;
    mouseX = e.screenX;
    mouseY = e.screenY;
    document.documentElement.classList.remove('hide-cursor');
  });

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
    d: () => halfPage(1),
    u: () => halfPage(-1),
    f: () => scroll(full()),
    b: () => scroll(-full()),
    e: (e) => line(e, 1),
    y: (e) => line(e, -1),
    o: () => history.back(),
    i: () => history.forward(),
  };

  const keys = {
    j: (e) => line(e, 1),
    k: (e) => line(e, -1),
    d: () => halfPage(1),
    u: () => halfPage(-1),
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
      if (fn) { e.preventDefault(); fn(e); }
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
    if (fn) { e.preventDefault(); fn(e); }
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
