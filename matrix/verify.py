#!/usr/bin/env python3
"""Smoke-test every tier: JSON schema + compile all snippets + run each
reference solution against its own tests (per data/SCHEMA.md)."""
import glob
import json
import os
import re
import subprocess
import sys

DATA = os.path.join(os.path.dirname(__file__), "data")
BLOCK_TYPES = {"text", "code", "tip", "quiz", "tryit"}
ENGINES = {"pyodide", "backend"}
MATCH_MODES = {"exact", "trim", "includes", "regex"}
errors, warnings, snippet_count = [], [], 0


def compile_snippet(label, code):
    global snippet_count
    snippet_count += 1
    try:
        compile(code, label, "exec")
    except SyntaxError as e:
        errors.append(f"SYNTAX  {label}: {e.msg} (line {e.lineno})")


def check_blocks(tier, blocks):
    for i, b in enumerate(blocks):
        t = b.get("type")
        if t not in BLOCK_TYPES:
            errors.append(f"tier{tier} block{i}: bad type '{t}'")
        if t == "quiz":
            opts = b.get("options", [])
            ai = b.get("answerIndex")
            if not isinstance(ai, int) or ai < 0 or ai >= len(opts):
                errors.append(f"tier{tier} block{i}: answerIndex {ai} out of range (0..{len(opts) - 1})")
        if t == "code" and b.get("code"):
            compile_snippet(f"tier{tier} block{i} code", b["code"])
        if t == "tryit":
            for key in ("starter", "solution"):
                if b.get(key):
                    compile_snippet(f"tier{tier} block{i} tryit.{key}", b[key])


def output_matches(mode, expected, actual):
    if mode == "exact":
        return actual == expected
    if mode == "includes":
        return expected in actual
    if mode == "regex":
        return re.search(expected, actual) is not None
    return actual.strip() == expected.strip()  # trim (default)


def check_problem(tier, p):
    pid = p.get("id", f"tier{tier}?")
    for k in ("id", "title", "instructions", "starter", "solution", "tests"):
        if not p.get(k):
            errors.append(f"{pid}: missing key '{k}'")
    if p.get("engine") not in ENGINES:
        errors.append(f"{pid}: bad engine '{p.get('engine')}'")

    if p.get("starter"):
        compile_snippet(f"{pid} starter", p["starter"])
    if p.get("solution"):
        compile_snippet(f"{pid} solution", p["solution"])
    if p.get("complexity", {}).get("codeTemplate"):
        compile_snippet(f"{pid} complexity.codeTemplate",
                        p["complexity"]["codeTemplate"].replace("{N}", "1000"))

    tests = p.get("tests", [])
    if not any(not t.get("hidden") for t in tests):
        errors.append(f"{pid}: needs at least 1 visible test")
    if not any(t.get("hidden") for t in tests):
        errors.append(f"{pid}: needs at least 1 hidden test")

    # The reference solution must pass its own tests, otherwise no learner can.
    for t in tests:
        name = f"{pid} test '{t.get('name', '?')}'"
        mode = t.get("matchMode", "trim")
        if mode not in MATCH_MODES:
            errors.append(f"{name}: bad matchMode '{mode}'")
            continue
        if not p.get("solution"):
            continue
        try:
            r = subprocess.run([sys.executable, "-c", p["solution"]],
                               input=t.get("stdin", ""), capture_output=True,
                               text=True, timeout=30)
        except subprocess.TimeoutExpired:
            errors.append(f"TIMEOUT {name}: solution ran >30s")
            continue
        if r.returncode != 0:
            last = (r.stderr.strip().splitlines() or ["?"])[-1]
            errors.append(f"RUNTIME {name}: {last}")
        elif not output_matches(mode, t.get("expectStdout", ""), r.stdout):
            errors.append(f"OUTPUT  {name}: got {r.stdout.strip()!r}, expected {t.get('expectStdout')!r} ({mode})")


def check_manifest(tier_files):
    path = os.path.join(DATA, "tiers.json")
    try:
        manifest = json.load(open(path))
    except Exception as e:
        errors.append(f"tiers.json: JSON parse error: {e}")
        return
    listed = {t.get("tier") for t in manifest.get("tiers", [])}
    on_disk = {int(os.path.basename(f)[4:5]) for f in tier_files}
    if listed != on_disk:
        errors.append(f"tiers.json lists tiers {sorted(listed)} but data/ has {sorted(on_disk)}")


def main():
    files = sorted(glob.glob(os.path.join(DATA, "tier[0-9]*.json")))
    if not files:
        print("❌ No tier files found in", DATA)
        sys.exit(1)
    check_manifest(files)
    problems = 0
    for f in files:
        tier = int(os.path.basename(f)[4:5])
        try:
            data = json.load(open(f))
        except Exception as e:
            errors.append(f"{os.path.basename(f)}: JSON parse error: {e}")
            continue
        for k in ("tier", "language", "title", "blocks", "problems"):
            if k not in data:
                errors.append(f"tier{tier}: missing key '{k}'")
        if data.get("tier") != tier:
            warnings.append(f"tier{tier}: 'tier' field is {data.get('tier')}")
        check_blocks(tier, data.get("blocks", []))
        for p in data.get("problems", []):
            problems += 1
            check_problem(tier, p)

    print(f"Tiers checked: {len(files)}  |  Problems: {problems}  |  Snippets compiled: {snippet_count}")
    if warnings:
        print(f"\n⚠️  {len(warnings)} warnings:")
        for w in warnings[:12]:
            print("   ", w)
    if errors:
        print(f"\n❌ {len(errors)} ERRORS:")
        for e in errors:
            print("   ", e)
        sys.exit(1)
    print("\n✅ All tiers valid — schema OK, snippets compile, every reference solution passes its own tests.")


if __name__ == "__main__":
    main()
