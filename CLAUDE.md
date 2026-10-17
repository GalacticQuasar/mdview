# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

`mdview <file.md>` renders Markdown and shows it in a chromeless Chromium `--app` window (Edge/Chrome) with vim-style navigation and live reload. Plain Node ESM, no build step, no tests, no linter. Dependencies: `markdown-it`, `markdown-it-github-alerts`, `highlight.js`, `github-markdown-css`.

## Commands

```sh
npm install
node mdview.mjs README.md                                # open a window
node mdview.mjs README.md --size 1400x1460 --pos 580,0   # window geometry
node mdview.mjs README.md --no-open                      # just print the URL (for testing)
node --check mdview.mjs && node --check page.js          # syntax check
```

The user's `~/.bashrc` wraps this as `mdview() { node ~/projects/mdview/mdview.mjs --size 1400x1460 --pos 580,0 "$@"; }`.

## Architecture

- **`mdview.mjs`**: the whole server and launcher. It renders with markdown-it, serves pages, watches files, and spawns the browser. Routes:
  - `/<path>.md` returns the full page; `?fragment` returns only the rendered HTML, which live reload swaps in.
  - `/__events?path=` is an SSE stream that sends `reload` when the file changes.
  - `/__quit` exits the server.
  - Anything else is served as a static file.
- **`page.js` / `page.css`**: inlined into every page. They're read once at startup and concatenated with the vendored CSS from `node_modules`, so restart mdview after editing them.
- **Serve root** is the file's git toplevel, or its directory if it isn't in a repo. Requests outside the root get a 403. Relative links to other `.md` files render inside the viewer.
- **Lifecycle:** the process exits when the window closes. It waits 1.5s after the last SSE client disconnects, which lets navigation between pages reconnect in time. If no client connects within 30s it exits too, so `--no-open` test servers die on their own.
- **File watching** watches the *directory*, not the file, because Neovim saves by rename.

## Non-obvious decisions (don't undo without reason)

- **WSL host binding:** in WSL NAT mode the server binds to the VM's `eth0` IP, not `127.0.0.1`. The Windows→WSL localhost relay takes 0.25–1.5s to pick up new ports, which made the window flash `ERR_CONNECTION_REFUSED`. This applies only when `wslinfo --networking-mode` reports `nat`. In mirrored mode that IP is the machine's LAN address, so mdview falls back to localhost there.
- **Browser choice:** on WSL, `findBrowser()` prefers Edge, with Chrome as the fallback. In a benchmark, Chrome loaded the page slightly sooner, but in real use its window sat blank for about 0.5s before drawing; Edge's blank time was about a fifth of that. Judge startup by when the page is drawn, not when it loads. On Linux and macOS, Chrome comes first. `MDVIEW_BROWSER` overrides all of this.
- **Separate browser profile** (`--user-data-dir`): without it, the window attaches to the user's running browser and ignores `--window-size`/`--window-position`. There's one folder per browser (named from the executable, e.g. `chrome`, `msedge`), because two browsers sharing one user-data-dir can corrupt it. Locations:
  - WSL: `%LOCALAPPDATA%\mdview\<browser>`, with `%LOCALAPPDATA%` looked up once via `cmd.exe` and cached in `.localappdata`
  - macOS: `~/Library/Caches/mdview/<browser>`
  - Linux: `$XDG_CACHE_HOME/mdview/<browser>`
- **No browser menus:** `page.js` blocks the right-click menu. Edge's "mini menu" (the toolbar over selected text) can't be blocked from the page, so when the browser is Edge, `disableMiniMenu()` writes `edge_quick_search.show_mini_menu: false` into the profile's `Default/Preferences` before each launch. Chrome has no such menu. That key was found by toggling the setting in `edge://settings` and diffing the file. Other Edge UI can likely be turned off the same way.
- **`<body class="markdown-body">`:** github-markdown-css scopes its theme variables to `.markdown-body`. Putting the class on `body` makes the background cover the whole window, which fixed mismatched side bands. Content is full width, and the scrollbar is hidden on purpose.
- **Smooth scrolling** is a custom `requestAnimationFrame` ease toward a target, not `behavior: 'smooth'`, so a held `j` extends the target instead of stuttering:
  - Each step moves at least 1px, so Chromium's pixel snapping can't stall the animation just short of the target.
  - The animation aborts if something else moves the page, like the wheel or the scrollbar.
- **Cursor hiding:** `scrollTo()` in `page.js` adds `hide-cursor` to `<html>`, so every keyboard scroll hides the cursor. Wheel scrolling deliberately doesn't. A `mousemove` only shows the cursor again if the screen position actually changed, because Chromium can fire `mousemove` when content scrolls under a still cursor.
- **Search** uses Chromium's non-standard `window.find`, then scrolls the match into view manually because `find` doesn't.

## Testing changes

There are no automated tests. To verify keybindings and rendering, start a server with `--no-open` and drive it with `playwright-cli open --browser=chromium <url>`; plain `open` fails because Chrome isn't installed in WSL. Then `press` keys and `eval 'scrollY'`. Use `set-color-scheme dark` and `screenshot` for visual checks. `.playwright-cli/` output is gitignored. Stop stray servers with `pkill -f '^node mdview'`.
