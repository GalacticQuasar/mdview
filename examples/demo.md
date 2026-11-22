---
title: mdview demo
description: A tour of what mdview renders. Open it with `mdview examples/demo.md`.
---

# mdview demo

This file shows what mdview can render. Scroll with `j`/`k`, jump between headings with `]]`
and `[[`, and press `q` to close. Edit and save this file while it's open to see live reload.

> [!TIP]
> Hold `j` to glide down at a steady speed instead of stepping line by line.

## Text and lists

Markdown renders the way GitHub does: **bold**, *italic*, ~~strikethrough~~, `inline code`, and
[links](https://github.com/GalacticQuasar/mdview). Web links open in your default browser.

- [x] Task lists
- [x] Nested lists
  - like this one
- [ ] Things still to do

1. Numbered lists
2. work too

## Alerts

> [!NOTE]
> Useful information that readers should know, even when skimming.

> [!IMPORTANT]
> Key information readers need to succeed.

> [!WARNING]
> Urgent information that needs immediate attention.

## Tables

| Key | Action |
|---|---|
| `j` / `k` | scroll line down / up |
| `Ctrl-D` / `Ctrl-U` | half page down / up |
| `gg` / `G` | top / bottom |
| `/`, `n` / `N` | search, next / previous match |
| `H` / `L` | back / forward between linked files |

| Tool | Window | Vim keys | Live reload | Math |
|---|:-:|:-:|:-:|:-:|
| mdview | ✓ | ✓ | ✓ | ✓ |
| A browser tab previewer | | | ✓ | |
| A terminal renderer | | ✓ | | |

## Code

```js
// Syntax highlighting follows your system's light or dark theme.
function fibonacci(n) {
  let [a, b] = [0, 1];
  for (let i = 0; i < n; i++) [a, b] = [b, a + b];
  return a;
}
```

```python
from pathlib import Path

def word_count(path: str) -> int:
    """Count the words in a text file."""
    return len(Path(path).read_text().split())
```

```sh
git show HEAD~3:README.md | mdview -
```

## Math

Inline math uses dollar signs: the quadratic formula gives the roots of $ax^2 + bx + c = 0$ as
$x = \frac{-b \pm \sqrt{b^2 - 4ac}}{2a}$. Prices like $5 and $10 stay plain text.

Display math goes between `$$` lines:

$$
\int_{-\infty}^{\infty} e^{-x^2} \, dx = \sqrt{\pi}
$$

Or in a `math` code block, as on GitHub:

```math
\sum_{n=1}^{\infty} \frac{1}{n^2} = \frac{\pi^2}{6}
```

Bayes' theorem states $P(A \mid B) = \frac{P(B \mid A)\,P(A)}{P(B)}$, and an eigenvector
$\mathbf{v}$ of a matrix $A \in \mathbb{R}^{n \times n}$ satisfies $A\mathbf{v} = \lambda \mathbf{v}$.

## HTML

<details>
<summary>Click to expand</summary>

Inline HTML works too, including collapsible sections like this one and <kbd>Ctrl</kbd> + <kbd>D</kbd> keys.

</details>

## Links to other files

Links to other Markdown files open in the same window: try the [README](../README.md), then press
`H` to come back here, right where you left off.

---

The YAML frontmatter at the top of this file is shown as a highlighted block, the way it appears
in files like `SKILL.md`.
