# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

`mdview <file.md>` renders Markdown and shows it in a chromeless Chromium `--app` window (Edge/Chrome) with vim-style navigation and live reload. Plain Node ESM, no build step, no tests, no linter. Dependencies: `markdown-it`, `markdown-it-github-alerts`, `highlight.js`, `github-markdown-css`.

## Commands

```sh
npm install
node mdview.mjs README.md                                # open a window
node mdview.mjs README.md --size 933x1013 --pos 387,0    # window geometry
node mdview.mjs README.md --no-open                      # just print the URL (for testing)
node --check mdview.mjs && node --check page.js          # syntax check
```

The user's `~/.bashrc` wraps this as `mdview() { node ~/projects/mdview/mdview.mjs --size 933x1013 --pos 387,0 "$@"; }`. `--size`/`--pos` are in scaled pixels. The user's display is 2560×1600 at 150% Windows scaling, so it's 1707×1067 in scaled pixels, and screen-pixel numbers have to be divided by 1.5.

## Working with the user

- The user commits and pushes themselves. Don't commit unless asked; suggest a commit message when asked.
- Update `README.md` and `CLAUDE.md` along with code changes; the user asks for docs to be current before each commit.
- Keep decision history and benchmark results in this file, not in code comments.

## Architecture

- **`mdview.mjs`**: the whole server and launcher. It renders with markdown-it, serves pages, watches files, and spawns the browser. Routes:
  - `/<path>.md` returns the full page; `?fragment` returns only the rendered HTML, which live reload swaps in.
  - `/__events?path=` is an SSE stream that sends `reload` when the file changes.
  - `/__quit` exits the server.
  - `POST /__open` opens a link in the default browser (`rundll32` on WSL, `open` on macOS, `xdg-open` on Linux). It only accepts `http`, `https` and `mailto` links, and only from mdview's own pages (checked via the `Origin` header).
  - Anything else is served as a static file.
- **`page.js` / `page.css`**: inlined into every page. They're read once at startup and concatenated with the vendored CSS from `node_modules`, so restart mdview after editing them.
- **`icon.svg`**: also read once at startup, and embedded as a `data:` favicon. Edge uses it for the app window's title bar and taskbar icon. It switches stroke color with `prefers-color-scheme` so it stays visible in light mode. It's Lucide's "view" icon, chosen by the user; keep the ISC license comment inside it.
- **Serve root** is the file's git toplevel, or its directory if it isn't in a repo. Requests outside the root get a 403.
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
- **Smooth scrolling** has two modes, both custom `requestAnimationFrame` loops rather than `behavior: 'smooth'`. Both abort if something else moves the page, like the wheel or the scrollbar.
  - **Taps and jumps** (`scrollTo()`) ease toward a target, covering a fixed fraction of the remaining distance per frame. That fraction is `EASE` (0.25) by default and `EASE_HALF_PAGE` (0.16) for `Ctrl-D`/`Ctrl-U`, which travel far enough that the default lurched. Both values were tuned by feel with the user. Each step moves at least 1px, so Chromium's pixel snapping can't stall the animation just short of the target.
  - **Held line keys** (`j`/`k`, `Ctrl-E`/`Ctrl-Y`, via `holdLine()`) switch to a constant speed from the first auto-repeat until key-up. They ignore the repeats themselves and ease speed in and out. Easing toward a target bumped 60px per repeat made the speed pulse at the key-repeat rate (16% frame-to-frame variation, now about 1%). To check smoothness, log `scrollY` every frame while simulating repeats.
- **The window's history must stay at one entry.** Browsers only let a page close its own window (`q`) when there's nothing to go back to. Once a link added a history entry, `q` stopped the server but left a dead window. So the click handler in `page.js` never adds history entries:
  - `#anchor` links scroll with `scrollTo()` and update the URL with `history.replaceState`.
  - Links to other `.md` files load with `location.replace`. mdview keeps its own back/forward stacks in `sessionStorage` for `H`/`L` and `Ctrl-O`/`Ctrl-I`, including scroll positions.
  - Everything else goes to `/__open`.

  Never use `history.pushState`, plain navigation or `history.back()`. If closing still fails, or the server dies, the page shows "mdview has stopped".
- **Cursor hiding:** the keydown handler in `page.js` adds `hide-cursor` to `<html>` for every bound key, so keyboard scrolling hides the cursor. This lives in the key handler, not in `scrollTo()`, so clicking an anchor link doesn't hide the cursor. Wheel scrolling deliberately doesn't. A `mousemove` only shows the cursor again if the screen position actually changed, because Chromium can fire `mousemove` when content scrolls under a still cursor.
- **Search** uses Chromium's non-standard `window.find`, then scrolls the match into view manually because `find` doesn't.

## Testing changes

There are no automated tests. To verify keybindings and rendering, start a server with `--no-open` and drive it with `playwright-cli open --browser=chromium <url>`; plain `open` fails because Chrome isn't installed in WSL. Then `press` keys and `eval 'scrollY'`. Use `set-color-scheme dark` and `screenshot` for visual checks. `.playwright-cli/` output is gitignored. Stop stray servers with `pkill -f '^node mdview'`; a looser pattern can match and kill the shell running the command.

Pitfalls:
- `playwright-cli click` scrolls the element into view first, which ruins scroll-position tests. Trigger clicks in the page instead, with `eval 'document.querySelector(...).click(), 1'`.
- Under Playwright `history.length` starts at 2 (`about:blank` first). Check that it never increases; in the real app window it starts at 1.
- Stub `/__open` with `playwright-cli route "**/__open" --status=204`, or clicking a web link launches the user's real browser.
- Behavior that depends on the real window, like `window.close()`, the taskbar icon or paint timing, can't be verified headlessly. Ask the user to check it.
