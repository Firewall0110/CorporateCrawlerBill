#!/usr/bin/env python3
"""A cheap structural sanity check for Luau sources.

This is NOT a parser and does not replace `selene` or `luau-analyze` — it is a fast gate
that catches the gross errors (an unbalanced `end`, a stray bracket) in environments where
the Roblox toolchain is not installed. CI runs the real linters; this runs everywhere.

It strips comments and every string form Luau has (including long brackets and backtick
interpolation) and then checks two invariants:

  * block openers == block closers, where openers are `function`, `if`, `do`, `repeat`
    (note `for`/`while` are NOT counted: each contributes exactly one `do`), and closers
    are `end` and `until`.
  * brackets balance.

Known limitation, stated rather than left to be discovered: Luau's `if ... then ... else`
EXPRESSION has no `end`, so a file using one will report a false imbalance. The checker
detects and reports that case instead of silently miscounting.
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

OPENERS = ("function", "if", "do", "repeat")
CLOSERS = ("end", "until")


def strip_noise(src: str) -> str:
    out = []
    i = 0
    n = len(src)
    while i < n:
        two = src[i : i + 2]

        # Long comment / long string:  --[[ ]]  or  [==[ ]==]
        m = re.match(r"--\[(=*)\[", src[i:]) or re.match(r"\[(=*)\[", src[i:])
        if m:
            eq = m.group(1)
            close = "]" + eq + "]"
            j = src.find(close, i + m.end())
            i = n if j == -1 else j + len(close)
            out.append(" ")
            continue

        if two == "--":  # line comment
            j = src.find("\n", i)
            i = n if j == -1 else j
            continue

        ch = src[i]
        if ch in "\"'`":  # quoted string (backtick = interpolation)
            quote = ch
            i += 1
            while i < n:
                if src[i] == "\\":
                    i += 2
                    continue
                if src[i] == quote:
                    i += 1
                    break
                i += 1
            out.append(' "" ')
            continue

        out.append(ch)
        i += 1
    return "".join(out)


def check(path: Path) -> list[str]:
    src = path.read_text(encoding="utf-8")
    problems: list[str] = []

    # `local x = if c then a else b` — an if-expression, which has no `end`.
    if re.search(r"[=(,]\s*if\s", src):
        problems.append("contains an if-EXPRESSION; block counting is unreliable for this file")
        return problems

    clean = strip_noise(src)
    words = re.findall(r"[A-Za-z_][A-Za-z0-9_]*", clean)

    opens = sum(words.count(w) for w in OPENERS)
    closes = sum(words.count(w) for w in CLOSERS)
    if opens != closes:
        problems.append(f"block imbalance: {opens} openers vs {closes} closers (diff {opens - closes})")

    for open_ch, close_ch, label in (("(", ")", "parens"), ("{", "}", "braces"), ("[", "]", "brackets")):
        a, b = clean.count(open_ch), clean.count(close_ch)
        if a != b:
            problems.append(f"{label} imbalance: {a} '{open_ch}' vs {b} '{close_ch}'")

    return problems


def main() -> int:
    roots = [Path(a) for a in sys.argv[1:]] or [Path("src")]
    files: list[Path] = []
    for root in roots:
        files.extend(sorted(root.rglob("*.luau")) if root.is_dir() else [root])

    failed = 0
    for f in files:
        problems = check(f)
        if problems:
            failed += 1
            print(f"FAIL {f}")
            for p in problems:
                print(f"     {p}")
        else:
            print(f"ok   {f}")

    print(f"\n{len(files) - failed}/{len(files)} files pass the structural check")
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
