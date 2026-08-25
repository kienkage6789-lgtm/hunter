#!/usr/bin/env python3
"""
extract_python_map.py — Extract module/class/function structure from a Python
project via AST, as raw material for a CODE_MAP.md.

Usage:
    python extract_python_map.py <project_root> [--exclude dir1,dir2,...] [--include-private]

Prints JSON to stdout, grouped by file (path relative to project_root):

{
  "path/to/file.py": {
    "module_docstring": "first line or null",
    "classes": [
      {
        "name": "ClassName",
        "bases": ["BaseClass"],
        "decorators": ["dataclass"],
        "docstring": "first line or null",
        "lineno": 12,
        "methods": [
          {"name": "method_name", "signature": "(self, x: int) -> None",
           "docstring": "...", "lineno": 15, "decorators": [], "is_async": false}
        ]
      }
    ],
    "functions": [
      {"name": "func_name", "signature": "(a, b=1) -> int",
       "docstring": "...", "lineno": 30, "decorators": [], "is_async": false}
    ]
  },
  "_errors": {"path/to/broken.py": "syntax error: ..."}
}

Only top-level functions/classes and direct class methods are captured — nested
helpers are treated as implementation detail, not part of the file's public
surface. Names starting with "_" are skipped by default (except __init__);
pass --include-private to keep them. Files that fail to parse are recorded
under "_errors" instead of crashing the run. Files with nothing to report
(no docstring, no classes, no functions — e.g. an empty __init__.py) are
omitted from the output entirely.
"""

import argparse
import ast
import json
import sys
from pathlib import Path

DEFAULT_EXCLUDES = {
    ".git", "__pycache__", ".venv", "venv", "env", "node_modules",
    "build", "dist", ".idea", ".vscode",
}


def is_excluded(rel_path: Path, excludes: set) -> bool:
    parts = rel_path.parts
    if any(part in excludes for part in parts):
        return True
    return any(part.endswith(".egg-info") for part in parts)


def first_line(docstring):
    if not docstring:
        return None
    return docstring.strip().splitlines()[0].strip()


def format_signature(node) -> str:
    args = node.args
    parts = []

    all_pos = list(args.posonlyargs) + list(args.args)
    pad = len(all_pos) - len(args.defaults)
    defaults = [None] * pad + list(args.defaults)

    for i, a in enumerate(all_pos):
        seg = a.arg
        if a.annotation is not None:
            seg += f": {ast.unparse(a.annotation)}"
        if defaults[i] is not None:
            seg += f" = {ast.unparse(defaults[i])}"
        parts.append(seg)
        if args.posonlyargs and i == len(args.posonlyargs) - 1:
            parts.append("/")

    if args.vararg:
        seg = f"*{args.vararg.arg}"
        if args.vararg.annotation is not None:
            seg += f": {ast.unparse(args.vararg.annotation)}"
        parts.append(seg)
    elif args.kwonlyargs:
        parts.append("*")

    for a, d in zip(args.kwonlyargs, args.kw_defaults):
        seg = a.arg
        if a.annotation is not None:
            seg += f": {ast.unparse(a.annotation)}"
        if d is not None:
            seg += f" = {ast.unparse(d)}"
        parts.append(seg)

    if args.kwarg:
        seg = f"**{args.kwarg.arg}"
        if args.kwarg.annotation is not None:
            seg += f": {ast.unparse(args.kwarg.annotation)}"
        parts.append(seg)

    sig = f"({', '.join(parts)})"
    if node.returns is not None:
        sig += f" -> {ast.unparse(node.returns)}"
    return sig


def extract_function(node, include_private):
    if not include_private and node.name.startswith("_") and node.name != "__init__":
        return None
    return {
        "name": node.name,
        "signature": format_signature(node),
        "docstring": first_line(ast.get_docstring(node)),
        "lineno": node.lineno,
        "decorators": [ast.unparse(d) for d in node.decorator_list],
        "is_async": isinstance(node, ast.AsyncFunctionDef),
    }


def extract_class(node, include_private):
    if not include_private and node.name.startswith("_"):
        return None
    methods = []
    for item in node.body:
        if isinstance(item, (ast.FunctionDef, ast.AsyncFunctionDef)):
            m = extract_function(item, include_private)
            if m:
                methods.append(m)
    return {
        "name": node.name,
        "bases": [ast.unparse(b) for b in node.bases],
        "decorators": [ast.unparse(d) for d in node.decorator_list],
        "docstring": first_line(ast.get_docstring(node)),
        "lineno": node.lineno,
        "methods": methods,
    }


def extract_file(path: Path, include_private):
    try:
        source = path.read_text(encoding="utf-8")
    except (UnicodeDecodeError, OSError) as e:
        return None, f"read error: {e}"
    try:
        tree = ast.parse(source, filename=str(path))
    except SyntaxError as e:
        return None, f"syntax error: {e}"

    classes, functions = [], []
    for node in tree.body:
        if isinstance(node, ast.ClassDef):
            c = extract_class(node, include_private)
            if c:
                classes.append(c)
        elif isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            f = extract_function(node, include_private)
            if f:
                functions.append(f)

    return {
        "module_docstring": first_line(ast.get_docstring(tree)),
        "classes": classes,
        "functions": functions,
    }, None


def main():
    parser = argparse.ArgumentParser(description="Extract Python project structure for a code map.")
    parser.add_argument("project_root", help="Root directory to scan")
    parser.add_argument("--exclude", default="", help="Comma-separated extra directory names to exclude")
    parser.add_argument("--include-private", action="store_true", help="Include names starting with _")
    args = parser.parse_args()

    root = Path(args.project_root).resolve()
    if not root.is_dir():
        print(f"Not a directory: {root}", file=sys.stderr)
        sys.exit(1)

    excludes = set(DEFAULT_EXCLUDES)
    if args.exclude:
        excludes |= {e.strip() for e in args.exclude.split(",") if e.strip()}

    result = {}
    errors = {}
    for path in sorted(root.rglob("*.py")):
        rel = path.relative_to(root)
        if is_excluded(rel, excludes):
            continue
        data, err = extract_file(path, args.include_private)
        if err:
            errors[str(rel)] = err
        elif data["classes"] or data["functions"] or data["module_docstring"]:
            result[str(rel)] = data

    if errors:
        result["_errors"] = errors

    print(json.dumps(result, indent=2, ensure_ascii=False))


if __name__ == "__main__":
    main()
