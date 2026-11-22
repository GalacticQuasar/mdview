# mdview

[![CI](https://github.com/GalacticQuasar/mdview/actions/workflows/ci.yml/badge.svg)](https://github.com/GalacticQuasar/mdview/actions/workflows/ci.yml)

**A Markdown viewer you launch from the terminal.** `mdview README.md` opens the file, rendered the
way GitHub renders it, in its own minimal window. You navigate with vim keys, and the window reloads
whenever you save. It uses the Chrome or Edge you already have, so there's no Electron and nothing
heavy to install.

<!-- TODO: demo GIF -->

```sh
npm install -g @galacticquasar/mdview
mdview README.md
```

## Why

Most Markdown previewers either open a tab in your normal browser (grip, markserv), only work from
inside an editor (markdown-preview.nvim, VS Code), or render in the terminal (glow), with no real
typography, images or math. mdview gives you a dedicated window that feels like a native viewer:

- **Vim navigation** that's pleasant to use: smooth scrolling, holding `j` glides at a constant
  speed, `gg`/`G`, `]]`/`[[` to jump between headings, `/` to search, jump history with `Ctrl-O`/`Ctrl-I`,
  and `q` to close.
- **Rendered like GitHub:** GitHub-flavored Markdown, syntax highlighting, alerts (`> [!NOTE]`),
  math, and light and dark themes that follow your system.
- **Live reload** on save, keeping your scroll position. It works with editors that save by
  renaming the file, like Neovim.
- **Works well on WSL.** The server runs in Linux and the window is a native Windows Edge or Chrome
  window. It also works around the WSL localhost relay delay, so the window doesn't flash a
  connection error.
- **Takes pipes:** `git show HEAD~3:README.md | mdview -`.
- **Claude Code plugin:** `/mdview` opens Claude's last response in a window ([details below](#claude-code-plugin)).

## Features

- GitHub-flavored Markdown: tables, task lists, alerts (`> [!NOTE]`), heading anchors, inline HTML
- Syntax highlighting for code blocks
- Math (KaTeX) with GitHub's syntax: `$inline$`, `` $`inline`$ ``, `$$` blocks and ` ```math ` blocks
- YAML frontmatter (as in `SKILL.md` files) shown as a highlighted block at the top
- Follows links to other `.md` files and shows relative images; web links open in your default browser
- Other text files (`.txt`, logs, `LICENSE`, ...) are shown as-is, with the same keys and live reload
- A thin progress bar on the right edge shows how far down the file you are
- The mouse cursor hides while you scroll with the keyboard

## Requirements

- Node.js 20 or later
- A Chromium-based browser:
  - **WSL:** Edge or Chrome installed on Windows
  - **macOS:** Chrome, Edge, Chromium or Brave in `/Applications` or `~/Applications`
  - **Linux:** Chrome, Chromium or Edge in `/usr/bin`

  Set `MDVIEW_BROWSER` to the path of any other Chromium-based browser.

mdview runs the browser with its own profile, so it never touches your normal browser session.

## Usage

```sh
mdview <file | -> [--size WxH] [--pos X,Y] [--no-open]
```

```sh
mdview README.md                          # open a file
mdview notes.txt                          # non-Markdown text files are shown verbatim
git show HEAD~3:README.md | mdview -      # read Markdown from stdin
mdview README.md --size 900x1000 --pos 400,0
```

| Option | Meaning |
|---|---|
| `-` | Read Markdown from stdin. Relative links and images resolve from the current directory. There's no live reload. |
| `--size WxH` | Window size |
| `--pos X,Y` | Window position |
| `--no-open` | Just start the server and print the URL |
| `--version`, `--help` | |

Files ending in `.md`, `.markdown`, `.mdown` or `.mkd` are rendered as Markdown. Any other text
file is shown verbatim, and binary files are refused. mdview exits when you close the window.

### Default window size

Sizes and positions are in scaled pixels, not physical screen pixels. With display scaling, divide
your screen's pixel numbers by the scale factor: a 1400×1460 window at 150% scaling is
`--size 933x973`. To make every window open the same way, wrap mdview in a function in your shell's
startup file (`~/.bashrc`, `~/.zshrc`):

```sh
mdview() { command mdview --size 933x973 --pos 387,0 "$@"; }
```

## Keys

| Key | Action |
|---|---|
| `j` / `k`, `Ctrl-E` / `Ctrl-Y` | scroll line down / up (hold to glide) |
| `Ctrl-D` / `Ctrl-U` (or `d` / `u`) | half page down / up |
| `Ctrl-F` / `Ctrl-B`, `Space` | full page down / up |
| `gg` / `G` | top / bottom |
| `]]` / `[[` | next / previous heading |
| `/`, `n` / `N` | search, next / previous match |
| `H` / `L`, `Ctrl-O` / `Ctrl-I` | back / forward between linked files |
| `r` | re-render |
| `q` | quit |

## Claude Code plugin

The repo includes a [Claude Code](https://claude.com/claude-code) plugin that adds a `/mdview`
command. It opens Claude's last response in mdview, which is handy for reading long answers,
tables and math. It runs without calling the model, so it costs no tokens.

Install mdview first (see above), then in Claude Code:

```
/plugin marketplace add GalacticQuasar/mdview
/plugin install mdview@mdview
```

On Claude Code 2.1.275 or later, one step works too:
`/plugin install mdview --marketplace GalacticQuasar/mdview`.

To pass a window size or position, set the plugin's `args` option in `/config`, or in
`~/.claude/settings.json`:

```json
{ "pluginConfigs": { "mdview": { "options": { "args": "--size 933x1013 --pos 387,0" } } } }
```

## How it works

`mdview` renders the file to HTML in a small local Node server and opens it in a Chromium `--app`
window, which has no tabs or address bar. The server only serves files inside the file's git
repository (or its folder, outside a repo), and it pushes reloads to the page over server-sent
events.

## Development

```sh
git clone https://github.com/GalacticQuasar/mdview
cd mdview
npm install
npm link        # puts this checkout on your PATH as `mdview`
npm test
```

Rendering lives in `render.mjs`, the server and launcher in `mdview.mjs`, and the in-page code in
`page.js` and `page.css`. To work on the Claude Code plugin, load it from the checkout with
`claude --plugin-dir ./claude-plugin`.

## License

MIT
