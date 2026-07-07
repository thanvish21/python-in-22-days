#!/usr/bin/env python3
"""Smoke-test every lesson: JSON schema + compile/run all Python snippets."""
import json, os, sys, glob, tempfile, subprocess, textwrap

DATA = os.path.join(os.path.dirname(__file__), "data")
BLOCK_TYPES = {"text", "code", "tip", "quiz", "tryit", "surprise", "example", "assessment", "recapgame", "practice", "flashcards"}
errors, warnings, snippet_count = [], [], 0


def collect_code(day, data):
    """Yield (label, code) for every runnable snippet."""
    for i, b in enumerate(data.get("blocks", [])):
        t = b.get("type")
        if t == "code" and b.get("code"):
            yield (f"d{day} block{i} code", b["code"], bool(b.get("expectError")))
        if t == "tryit":
            if b.get("starter"):
                yield (f"d{day} block{i} tryit.starter", b["starter"], False)
            if b.get("solution"):
                yield (f"d{day} block{i} tryit.solution", b["solution"], False)
        if t == "example" and b.get("code"):
            yield (f"d{day} block{i} example.code", b["code"], bool(b.get("expectError")))
    c = data.get("challenge")
    if c:
        if c.get("starter"):
            yield (f"d{day} challenge.starter", c["starter"], False)
        if c.get("solution"):
            yield (f"d{day} challenge.solution", c["solution"], False)


def validate_question(day, label, q):
    opts = q.get("options", [])
    ai = q.get("answerIndex")
    if not isinstance(opts, list) or not opts:
        errors.append(f"day{day:02d} {label}: missing/non-empty options array")
        return
    if not isinstance(ai, int) or ai < 0 or ai >= len(opts):
        errors.append(f"day{day:02d} {label}: answerIndex {ai} out of range (0..{len(opts)-1})")


def check_schema(day, data):
    for k in ("day", "title", "blocks"):
        if k not in data:
            errors.append(f"day{day:02d}: missing key '{k}'")
    if data.get("day") != day:
        warnings.append(f"day{day:02d}: 'day' field is {data.get('day')}")
    for i, b in enumerate(data.get("blocks", [])):
        t = b.get("type")
        if t not in BLOCK_TYPES:
            errors.append(f"day{day:02d} block{i}: bad type '{t}'")
        if t == "quiz":
            validate_question(day, f"block{i}", b)
        if t == "assessment":
            questions = b.get("questions", [])
            if not isinstance(questions, list) or not questions:
                errors.append(f"day{day:02d} block{i}: assessment needs a non-empty questions array")
            else:
                for qi, q in enumerate(questions):
                    validate_question(day, f"block{i} assessment question{qi}", q)


def run_snippet(label, code, expect_error=False):
    """Compile always; execute when safe (no input(), run in temp dir for files)."""
    global snippet_count
    snippet_count += 1
    try:
        compile(code, label, "exec")
    except SyntaxError as e:
        errors.append(f"SYNTAX  {label}: {e.msg} (line {e.lineno})")
        return
    feeds = "5\n3\n7\nhello\nyes\n2\n"  # generic stdin for input()-based demos
    with tempfile.TemporaryDirectory() as tmp:
        try:
            r = subprocess.run([sys.executable, "-c", code], input=feeds,
                               capture_output=True, text=True, timeout=15, cwd=tmp)
            if r.returncode != 0:
                last = (r.stderr.strip().splitlines() or ["?"])[-1]
                is_starter = label.endswith(".starter")
                input_driven = "input(" in code and any(
                    x in r.stderr for x in ("EOFError", "ValueError: invalid literal", "StopIteration"))
                # A starter is incomplete by design (blanks / before-state) -> warning, not error.
                # But a runnable demo ('code') or a '.solution' MUST execute cleanly.
                if is_starter or input_driven or expect_error:
                    warnings.append(f"RUNTIME {label}: {last}")
                else:
                    errors.append(f"RUNTIME {label}: {last}")
        except subprocess.TimeoutExpired:
            errors.append(f"TIMEOUT {label}: ran >15s (possible infinite loop)")


def main():
    files = sorted(glob.glob(os.path.join(DATA, "day*.json")))
    for f in files:
        day = int(os.path.basename(f)[3:5])
        try:
            data = json.load(open(f))
        except Exception as e:
            errors.append(f"{os.path.basename(f)}: JSON parse error: {e}")
            continue
        check_schema(day, data)
        for label, code, expect_error in collect_code(day, data):
            run_snippet(label, code, expect_error)

    print(f"Files checked: {len(files)}  |  Snippets compiled/run: {snippet_count}")
    if warnings:
        print(f"\n⚠️  {len(warnings)} warnings (input-driven, expected):")
        for w in warnings[:12]:
            print("   ", w)
    if errors:
        print(f"\n❌ {len(errors)} ERRORS:")
        for e in errors:
            print("   ", e)
        sys.exit(1)
    print("\n✅ All lessons valid — schema OK, all runnable snippets compile & execute.")


if __name__ == "__main__":
    main()
