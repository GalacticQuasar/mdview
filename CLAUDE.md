# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

`mdview <file>` renders Markdown (other text files are shown verbatim) and shows it in a chromeless Chromium `--app` window (Edge/Chrome) with vim-style navigation and live reload. Plain Node ESM, no build step, no linter. Tests use Node's built-in `node:test`. Dependencies: `markdown-it`, `markdown-it-github-alerts`, `highlight.js`, `github-markdown-css`, `katex`.

## Commands

```sh
npm install
node mdview.mjs README.md                                # open a window
node mdview.mjs README.md --size 933x1013 --pos 387,0    # window geometry
node mdview.mjs README.md --no-open                      # just print the URL (for testing)
echo '# hi' | node mdview.mjs - --no-open                # read Markdown from stdin
node --check mdview.mjs && node --check render.mjs && node --check page.js   # syntax check
npm test                                                 # run mdview.test.mjs
```

The user's `~/.bashrc` wraps this as `mdview() { node ~/projects/mdview/mdview.mjs --size 933x1013 --pos 387,0 "$@"; }`. `--size`/`--pos` are in scaled pixels. The user's display is 2560×1600 at 150% Windows scaling, so it's 1707×1067 in scaled pixels, and screen-pixel numbers have to be divided by 1.5.

## Publishing

Published to npm as `@galacticquasar/mdview` (the command is still `mdview`, from `bin`). The unscoped `mdview` name belongs to an abandoned package (evanlucas/mdview, last published 2022); the user wants it and plans to ask for a transfer. `files` in `package.json` limits the package to the runtime files; check with `npm pack --dry-run`. To test it the way users get it: `npm pack`, then `npm install -g --prefix <tmp> <tarball>` and run `<tmp>/bin/mdview`. macOS and native Linux haven't been tested on real machines yet.

## Working with the user

- The user commits and pushes themselves. Don't commit unless asked; suggest a commit message when asked.
- Update `README.md` and `CLAUDE.md` along with code changes; the user asks for docs to be current before each commit.
- Keep decision history and benchmark results in this file, not in code comments.

## Architecture

- **`render.mjs`**: Markdown rendering: markdown-it with heading ids, alerts, math and frontmatter. `render(src, markdown)` takes text, not a path, and does no I/O, so tests import it directly. It was split out of `mdview.mjs` for that reason only, since `mdview.mjs` parses arguments and may exit as soon as it loads. Further splitting was judged not worth it for a file this size.
- **`mdview.mjs`**: the server and launcher. It reads files (or stdin) and hands them to `render()`, serves pages, watches files, and spawns the browser. Routes:
  - `/<path>.md`, and the path of the file named on the command line, return the full page; `?fragment` returns only the rendered HTML, which live reload swaps in.
  - `/__events?path=` is an SSE stream that sends `reload` when the file changes. `page.js` sends `path` URI-encoded and `searchParams.get` decodes it, so the server must not decode it again; it used to, which crashed the server on file names containing `%`.
  - `/__quit` exits the server.
  - `/__katex/fonts/<name>` serves KaTeX's font files.
  - `POST /__open` opens a link in the default browser (`rundll32` on WSL, `open` on macOS, `xdg-open` on Linux). It only accepts `http`, `https` and `mailto` links, and only from mdview's own pages (checked via the `Origin` header).
  - Anything else is served as a static file.
- **`page.js` / `page.css`**: inlined into every page. They're read once at startup and concatenated with the vendored CSS from `node_modules`, so restart mdview after editing them.
- **`icon.svg`**: also read once at startup, and embedded as a `data:` favicon. Edge uses it for the app window's title bar and taskbar icon. It switches stroke color with `prefers-color-scheme` so it stays visible in light mode. It's Lucide's "view" icon, chosen by the user; keep the ISC license comment inside it.
- **Which files open:** `.md`, `.markdown`, `.mdown` and `.mkd` (`isMarkdown()`) render as Markdown. Any other file opens as verbatim text in a `<pre class="plain-text">`, wrapped and in the normal page, so keys and live reload still work. Parsing `.txt` as Markdown was rejected because it collapses line breaks and interprets `*`, `$` and `#`. The CLI refuses directories, and refuses non-Markdown files with a NUL byte in the first 8KB (`isBinary()`, git's heuristic). The server only gives this page treatment to Markdown and to the file named on the command line (`target === file`); other paths stay static files, so a link from a Markdown page to a `.txt` still goes to `/__open`.
- **Stdin (`mdview -`):** the input is read once at startup and served as a virtual `stdin.md` in the current directory, so `root` and relative links work as if a file were there (a real `stdin.md` in that directory is shadowed). It's always rendered as Markdown, with no binary check, and the SSE stream skips the file watcher. If stdin is a terminal, mdview errors instead of waiting for Ctrl-D. To launch it detached with piped input (as a Claude Code plugin would), `sh -c 'nohup node mdview.mjs - <&0 &'` doesn't work: dash points a background job's stdin at `/dev/null` before applying `<&0`. Save the pipe first: `sh -c 'exec 3<&0; nohup node mdview.mjs - <&3 3<&- >/dev/null 2>&1 &'`.
- **Claude Code plugin (`claude-plugin/`):** adds `/mdview`, which opens Claude's last response. It's a hooks module (`hooks/register.ts`, the plugin API's `$`, not Node): `$.command.register` in `session.start`, and a `command.run` hook that answers `{ text, isTextDisplayOnly }` without calling `next`, so the model never runs. History of the choice: a `UserPromptSubmit` hook that blocks the prompt was considered first, but it runs on every prompt and leaves an "Original prompt" block message; a custom command in `~/.claude/commands/` always invokes the model.
  - What the model sees: in an interactive session the run is stored as `system` rows (`subtype: local_command`) and the command line reaches the model; `isTextDisplayOnly` keeps the output ("Opened in mdview.") out. Dropping it was tried so `/mdview` would show in rewind like `/copy`, and it didn't: rewind never lists a plugin command, whatever the answer holds, because only built-ins like `/copy` are stored as `user` rows with a `promptId`. Recording follows who answered, not the command name: a plugin `command.run` hook that answered `/copy md` for the built-in `/copy` was stored as `system` rows too, while a plain `/copy` in the same session got `user` rows. Headless `claude -p` stores plugin commands as `user` rows, which is what misled that attempt, so check row formats in a real session. Hiding the command line isn't possible either: `prompt.submit` doesn't fire for a plugin's own command, and `session.append` can rewrite the row but not drop it (an emptied one is stored as `(no content)`).
  - It takes the newest assistant message with text (`$.session.messages({ last: 200 })`), skipping Claude Code's `No response requested.` placeholder. Joining every text in the turn was tried and dropped: it pulls in the progress notes between tool calls.
  - It pipes that text to `mdview -` via `$.process.run(['sh', '-c', 'exec 3<&0; nohup node "$@" - <&3 3<&- … &', …], { stdin })`, so mdview outlives the call (see the stdin entry for the fd 3 trick). `$.process.spawn` was rejected because it kills the child when the module reloads.
  - It runs the `mdview` command from `PATH` (the npm package's `bin`), so it works from `/plugin install`, which copies the plugin into a cache. It used to run `$.plugin.root/../mdview.mjs`, which only worked when loaded from this repo. For development, `npm link` puts the checkout on `PATH`. Once mdview is detached its errors go to `/dev/null` and `sh` exits 0, so the launch script does `command -v mdview || exit 127` first, and the plugin turns 127 into an install hint instead of a false "Opened in mdview." Window geometry comes from the `args` `userConfig` field (`pluginConfigs.mdview.options.args` in settings), since the plugin can't see the user's bash function.
  - It's distributed through `.claude-plugin/marketplace.json` at the repo root (`/plugin marketplace add GalacticQuasar/mdview`), not through npm; `files` in `package.json` leaves `claude-plugin/` out of the npm package.
  - Check with `claude plugin validate claude-plugin` and `claude plugin validate .` (the marketplace) (the LICENSE and icon complaints are only for the public plugin directory). End-to-end test without a window: `MDVIEW_BROWSER=<script that logs its args> claude -p -c --fork-session --no-session-persistence --plugin-dir claude-plugin /mdview` continues the latest session, runs the command, and the logged `--app=` URL can be fetched with `?fragment`.
- **YAML frontmatter:** `render()` cuts a leading `---`…`---` block off before markdown-it sees it, and shows it as a highlight.js YAML `<pre class="frontmatter">` above the body. Otherwise markdown-it renders it as an `<hr>` and a setext `<h2>`. The user chose a code block over GitHub's table rendering, because a table would need a YAML parser and gets cramped with long `description`s. Empty frontmatter is dropped. The YAML isn't validated, so a file that opens with a `---` thematic break and has another `---` line later is also treated as frontmatter.
- **Math:** GitHub's syntax is parsed by small custom markdown-it rules in `render.mjs` and rendered server-side with `katex.renderToString`, so live-reload fragments need no client JS:
  - `$…$` and `` $`…`$ `` are inline. `$$…$$` inside a paragraph renders as display math.
  - A line starting with `$$` begins a display block, which ends at a line ending with `$$`.
  - ` ```math ` fences are display math (the `fence` renderer is wrapped).

  A lone `$` opens math only if a non-space follows, and must close at the *next* unescaped `$`, which must come after a non-space and not be followed by a digit. Otherwise it's plain text, so prices like "$5 and $10" stay text. `markdown-it-texmath` was tried and dropped: it outputs custom `<eq>`/`<section>` tags, and combining its `dollars` and `gitlab` modes registers duplicate rule names. KaTeX errors render inline in red (`throwOnError: false`). `katex.min.css` is inlined with its `url(fonts/…)` rewritten to `/__katex/fonts/`, a route that serves `node_modules/katex/dist/fonts` (basename only).
- **Vendored files** (the CSS and KaTeX fonts) are located with `createRequire(import.meta.url).resolve('<pkg>/<file>')`, not `HERE/node_modules`, because a package manager may hoist dependencies out of mdview's folder. Resolve real files, not `<pkg>/package.json`: `markdown-it-github-alerts` doesn't export its `package.json`.
- **Serve root** is the file's git toplevel, or its directory if it isn't in a repo. Requests outside the root get a 403, `/__events` paths included, and a malformed `%`-escape gets a 400 (it used to throw and kill the server).
- **Lifecycle:** the process exits when the window closes. It waits 1.5s after the last SSE client disconnects, which lets navigation between pages reconnect in time. If no client connects within 30s it exits too, so `--no-open` test servers die on their own.
- **File watching** watches the *directory*, not the file, because Neovim saves by rename. If that directory is missing or the watcher errors, there are just no reloads: the SSE stream stays open, because it also drives the lifecycle. A throw there used to kill the server.

## Non-obvious decisions (don't undo without reason)

- **WSL host binding:** in WSL NAT mode the server binds to the VM's `eth0` IP, not `127.0.0.1`. The Windows→WSL localhost relay takes 0.25–1.5s to pick up new ports, which made the window flash `ERR_CONNECTION_REFUSED`. This applies only when `wslinfo --networking-mode` reports `nat`. In mirrored mode that IP is the machine's LAN address, so mdview falls back to localhost there.
- **Browser choice:** on WSL, `findBrowser()` prefers Edge, with Chrome as the fallback. In a benchmark, Chrome loaded the page slightly sooner, but in real use its window sat blank for about 0.5s before drawing; Edge's blank time was about a fifth of that. Judge startup by when the page is drawn, not when it loads. On Linux and macOS, Chrome comes first. `MDVIEW_BROWSER` overrides all of this.
- **Separate browser profile** (`--user-data-dir`): without it, the window attaches to the user's running browser and ignores `--window-size`/`--window-position`. There's one folder per browser (named from the executable, e.g. `chrome`, `msedge`), because two browsers sharing one user-data-dir can corrupt it. Locations:
  - WSL: `%LOCALAPPDATA%\mdview\<browser>`, with `%LOCALAPPDATA%` looked up once via `cmd.exe` and cached in `$XDG_CACHE_HOME/mdview/localappdata`. It used to be cached in `.localappdata` in mdview's own folder, which is read-only after a global npm install
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
- **Progress bar:** `#mdview-progress` is a 3px fixed strip on the right edge in the theme's border grey (`--borderColor-default`; the user found the blue accent too eye-catching), filled from the top with `transform: scaleY(scrollY / maxY)`, so updating it never triggers layout. It's updated on `scroll`, `resize`, and by a `ResizeObserver` on `#content`, which catches live reloads and images that load late. It's hidden when the page doesn't scroll. Because `#content` has 50vh of bottom padding, 100% means scrolled to the very bottom (as `G` does), not that the last line has come into view.
- **Image `height` attributes are a cap, not a size.** GitHub adds `height: auto; max-height: <height>px` as an inline style to any `<img>` with a `height` attribute. `page.css` does the same with `img[height] { height: auto; max-height: attr(height px) }` (typed `attr()` needs Chromium 133+). Without it, `<img width="2400" height="600">` kept its 600px height while `max-width: 100%` shrank its width, which squashed the image.
- **Search** uses Chromium's non-standard `window.find`, then scrolls the match into view manually because `find` doesn't.

## Testing changes

`npm test` runs `mdview.test.mjs` (about 2s). It covers `render()` (heading ids, the math rules, frontmatter, alerts, plain text) and the server through real `--no-open` processes on a temp directory (pages, `?fragment`, static files, the 403 outside the root, malformed `%`-escapes, the event stream for missing directories and `%` in names, stdin, refusing binary and missing files). Add a test when changing those. Each test was checked by breaking the code it covers; "$5 and $10" alone didn't exercise the digit rule (the space rule already stops it), hence "$5-$10". Requests in the server tests use `http.get`, because `fetch` normalizes `..` away before the server sees it.

CI (`.github/workflows/ci.yml`) runs the syntax check and `npm test` on Ubuntu and macOS with Node 20, 22 and 24 (20 is the `engines` minimum), then installs the `npm pack` tarball and checks that it serves a page with math rendered, which catches files missing from `files` and dependency-path problems. It has no browser, so it can't catch window or key problems on macOS.

Browser behavior (keys, scrolling, history, cursor) has no automated tests. To verify keybindings and rendering, start a server with `--no-open` and drive it with `playwright-cli open --browser=chromium <url>`; plain `open` fails because Chrome isn't installed in WSL. Then `press` keys and `eval 'scrollY'`. Use `set-color-scheme dark` and `screenshot` for visual checks. `.playwright-cli/` output is gitignored. Stop stray servers with `pkill -f '^node mdview'`; a looser pattern can match and kill the shell running the command.

Pitfalls:
- `playwright-cli click` scrolls the element into view first, which ruins scroll-position tests. Trigger clicks in the page instead, with `eval 'document.querySelector(...).click(), 1'`.
- Under Playwright `history.length` starts at 2 (`about:blank` first). Check that it never increases; in the real app window it starts at 1.
- Stub `/__open` with `playwright-cli route "**/__open" --status=204`, or clicking a web link launches the user's real browser.
- Behavior that depends on the real window, like `window.close()`, the taskbar icon or paint timing, can't be verified headlessly. Ask the user to check it.
