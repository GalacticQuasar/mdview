# mdview

A lightweight GUI application to view rendered markdown files with vim motions, started from your terminal.

Features:
- Smooth Scrolling
- Code Syntax Highlighting
- HTML Rendering
- GitHub-flavored Markdown: tables, task lists, callouts (`> [!NOTE]`), heading anchors
- Live reload on save, keeping your scroll position
- Follows links to other `.md` files and shows relative images
- Mouse cursor hides while you scroll with the keyboard and comes back when you move the mouse

## How it works

`mdview` renders the file to HTML in a small local Node server and opens it in a chromeless
Chromium-based browser window (`--app` mode). The process exits when the window is closed.

Works on Linux, macOS, and WSL. It needs Node and one of these browsers:

- **WSL:** Edge or Chrome on the Windows side, so the window is a native Windows window while the
  server runs in WSL
- **macOS:** Chrome, Edge, Chromium, or Brave in `/Applications` or `~/Applications`
- **Linux:** Chrome, Chromium, or Edge in `/usr/bin`

## Install

```sh
npm install
```

Then make the `mdview` command available, either with `npm link` or by adding a function to your
shell's startup file (`~/.bashrc` for bash, `~/.zshrc` for zsh):

```sh
mdview() { node ~/projects/mdview/mdview.mjs "$@"; }
```

The function is also the place to set a default window size and position, so every window
opens the same way:

```sh
mdview() { node ~/projects/mdview/mdview.mjs --size 933x973 --pos 387,0 "$@"; }
```

Sizes and positions are in scaled pixels, not physical screen pixels. With display scaling
(e.g. 150% on Windows), divide your screen's pixel numbers by the scale factor: a
1400×1460 window at 150% is `--size 933x973`.

After editing, open a new terminal or reload the file (e.g. `source ~/.bashrc`).

## Usage

```sh
mdview README.md [--size 1400x1460] [--pos 580,0] [--no-open]
```

`--no-open` just prints the URL. Set `MDVIEW_BROWSER` to use a specific Chromium-based browser.

## Keys

| Key | Action |
|---|---|
| `j` / `k`, `Ctrl-E` / `Ctrl-Y` | scroll line down / up |
| `Ctrl-D` / `Ctrl-U` (or `d` / `u`) | half page down / up |
| `Ctrl-F` / `Ctrl-B`, `Space` | full page down / up |
| `gg` / `G` | top / bottom |
| `]]` / `[[` | next / previous heading |
| `/`, `n` / `N` | search, next / previous match |
| `H` / `L`, `Ctrl-O` / `Ctrl-I` | back / forward |
| `r` | re-render |
| `q` | quit |
