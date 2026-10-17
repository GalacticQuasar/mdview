# mdview

A lightweight GUI application to view rendered markdown files with vim motions, started from your terminal.

Features:
- Smooth Scrolling
- Code Syntax Highlighting
- HTML Rendering
- GitHub-flavored Markdown: tables, task lists, callouts (`> [!NOTE]`), heading anchors
- Live reload on save, keeping your scroll position
- Follows links to other `.md` files and shows relative images

## How it works

`mdview` renders the file to HTML in a small local Node server and opens it in a chromeless
Edge/Chrome `--app` window. On WSL the window is a native Windows window while the server runs in
WSL. The process exits when the window is closed.

## Install

```sh
npm install
# then either `npm link`, or a shell function:
mdview() { node ~/projects/mdview/mdview.mjs "$@"; }
```

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
