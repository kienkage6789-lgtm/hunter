---
name: code-map
description: Generate and maintain a CODE_MAP.md that indexes a project's files, modules, classes, and functions with short purpose descriptions, so any AI assistant (or the user) can orient in a codebase in seconds instead of re-reading every file. Use this skill whenever the user asks to map, index, catalog, or document code structure; whenever they say things like "code map", "sơ đồ code", "cấu trúc code", "liệt kê function/class", "tra cứu code nhanh", "tổng quan project"; whenever starting substantial work on an existing multi-file codebase that has no map yet; and after a session adds or restructures several files or functions, to keep the map from going stale. Includes a bundled script for fast, accurate signature extraction from Python projects via AST; other languages are mapped by direct reading.
---

# Code Map

## Why this exists

The point of a code map isn't documentation for its own sake — it's cutting the cost of
re-orientation. Every time an AI assistant (or a human) opens an unfamiliar file just to answer
"does this already exist" or "where does X happen," that's time spent rediscovering something
that was already known once. A good `CODE_MAP.md` turns that into a lookup: scan one file, find
the right module and function name, then read only what's actually needed.

That means the map should optimize for scanning speed, not completeness. A wall of every private
helper is worse than a map of the project's actual public surface — the functions and classes
other code, or another AI session, would plausibly want to call or reference.

## When to generate or update

- The user explicitly asks for a code map, index, or structure overview.
- You're about to make non-trivial changes to a codebase of meaningful size (roughly 5+ files)
  that has no `CODE_MAP.md` yet — generate one first rather than navigating blind.
- You've just added, removed, or substantially changed functions/classes/files in a session —
  update the relevant section instead of regenerating the whole file. Preserve everything you
  didn't touch, including any manual notes the user added to the map.

Don't regenerate the whole map from scratch on every small edit — that wastes effort and risks
losing hand-written notes. Patch just the part that changed.

## Step 1: Decide scope and exclusions

Walk the project from its root, but skip anything that isn't source the project owns: `.git`,
`__pycache__`, `.venv`/`venv`/`env`, `node_modules`, `build`, `dist`, `.idea`, `.vscode`,
`*.egg-info`, and anything the project's own `.gitignore` already excludes.

If the project is large (rough guide: more than ~20 source files), don't cram everything into one
file. Instead:
- Write a root `CODE_MAP.md` with the folder-level breakdown and what each folder is for.
- Write one `MAP.md` per major package/folder with file-level detail, linked from the root map.

This mirrors how the map should be read: skim the top level first, then drill into the one part
that's actually needed.

## Step 2: Extract structure

**For Python files**, run the bundled script instead of reading every file by hand — it's faster
and won't miss a signature:

```
python scripts/extract_python_map.py <project_root> --exclude .venv,node_modules,build
```

It prints JSON grouped by file: module docstring, and for every top-level function/class (plus
methods) — name, full signature, decorators, async flag, first line of docstring, and line
number. Private names (leading `_`, except `__init__`) are skipped by default; pass
`--include-private` to keep them. Files that fail to parse are reported under an `_errors` key
instead of crashing the run.

Use that JSON as raw material, not something to paste in verbatim. Where a docstring already
states the purpose clearly, reuse it — reworded to fit the one-line format below. Where there's
no docstring, open just that function and write a one-line purpose from what it actually does;
don't guess from the name alone.

**For other languages** (JS/TS, C#, Pine Script, MQL5, etc.) there's no bundled parser — read
each file directly and extract the same fields by hand: the exported/public functions, classes,
or components, their signatures, and a one-line purpose.

Either way, the test for "does this belong in the map" is: would another session plausibly need
to find this without reading the file first? Constructors, one-off private helpers, and
boilerplate usually don't clear that bar — leave them out.

## Step 3: Write CODE_MAP.md

Use this structure. It's designed to be skimmed top-to-bottom, most-useful-first:

~~~markdown
# Code Map — <project name>

_Last updated: <date>_

## Overview
<2-4 sentences: what this project does, and its overall shape — e.g. "PyQt6 desktop app with a
Gemini-backed chat core and a separate animation state machine for the character widget.">

## File Tree
```
project/
├── main.py
├── core/
│   ├── quality_metrics.py
│   └── supplier_manager.py
└── gui/
    └── main_window.py
```

## Modules

### core/quality_metrics.py
Tính toán PPM, NG rate và các chỉ số chất lượng.

| Function/Class | Signature | Purpose |
|---|---|---|
| `calculate_ppm` | `(defects: int, units: int) -> float` | Tính PPM từ số lỗi và tổng sản phẩm |
| `QualityReport.is_ok` | `(self) -> bool` | True nếu PPM dưới ngưỡng cho phép |

### core/supplier_manager.py
...

## Notes
<Anything a fresh reader would want, that doesn't fit the table — key external dependencies,
non-obvious architectural decisions, known rough edges.>
~~~

Keep the "Purpose" column to one line per entry. If a function genuinely needs more than a line
to explain, that's usually a sign it's doing too much — say so honestly in Notes rather than
writing a paragraph to compensate.

## Step 4: Save it

Save `CODE_MAP.md` (and any per-package `MAP.md` files) in the project root or the relevant
package folder — not in a separate docs location — so it stays next to the code it describes and
is easy to find next time.

## A note on languages

Signature extraction is only automated for Python right now, since that's the fastest win for the
common case — most projects lean on one or two primary languages, and hand-reading the rest for a
handful of exported functions is still far cheaper than building and maintaining a parser for
every language a project might touch. For a project that's heavily JS/TS, C#, or something else,
lean more on manual extraction for those files and keep the rest of the workflow identical.
