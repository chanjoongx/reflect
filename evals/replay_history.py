#!/usr/bin/env python3
"""
replay_history.py — replay reflect's PRODUCTION detector over real Claude Code
session history, offline.

Why this exists
---------------
experiments/ablation-with-without.md deferred the efficacy ablation for a sound
reason (N=2 self-experiment on one's own tool is unfalsifiable). But it left one
hypothesis on the table, untested:

    "Under vibecoding, the dominant revert signal is Tier 3 (user utterance),
     which accumulates too slowly to reliably cross cum_x100 >= 240."
                                        -- ablation-with-without.md, 2026-04-24

That claim is falsifiable, and it does not need a control group. It needs a
corpus. We now have one: ~1.6k local Claude Code sessions.

This replays the CANONICAL shell-hook logic (hooks/reflect-trigger.sh +
hooks/reflect-utterance.sh), not the TypeScript reference impl in
src/revert-detector.ts -- the two diverge (see that file's header).

Production semantics, reproduced exactly:
  Tier 1 = 100  : Bash cmd ^(git revert|git restore|git checkout HEAD --)
  Tier 2 =  70  : Bash cmd ^(rm |unlink ) AND NOT (node_modules|dist|build|.next|coverage)
  Tier 3 =  50  : UserPromptSubmit matching the negation regex, unless the
                  positive-negation exclusion fires first
  Accumulator   : monotonic cum_x100; fires at >= 240; resets to 0 on fire.
                  (No sliding window -- that's the reference impl only.)

Usage:
    python evals/replay_history.py --projects "$HOME/.claude/projects" --out evals/out
"""

from __future__ import annotations

import argparse
import io
import json
import re
import sys
from dataclasses import dataclass, field
from pathlib import Path

# Windows consoles default to cp949 here; the report contains em-dashes + Hangul.
for _s in ("stdout", "stderr"):
    _st = getattr(sys, _s)
    if hasattr(_st, "buffer"):
        setattr(sys, _s, io.TextIOWrapper(_st.buffer, encoding="utf-8", errors="replace"))

# ── Production constants (hooks/reflect-trigger.sh) ────────────────────────
THRESHOLD_X100 = 240
W_TIER1, W_TIER2, W_TIER3 = 100, 70, 50

# ── Production regexes, transcribed verbatim from the shell hooks ──────────
RE_TIER1 = re.compile(r"^(git revert|git restore|git checkout HEAD --)")
RE_TIER2 = re.compile(r"^(rm |unlink )")
RE_TIER2_EXCLUDE = re.compile(r"(node_modules|dist|build|\.next|coverage)")

# reflect-utterance.sh:95 — checked FIRST; suppresses the signal.
RE_T3_POSITIVE = re.compile(
    r"(i see why|you were right|good point|fair point|makes sense|"
    r"that makes sense|i understand|i agree|nice catch)",
    re.IGNORECASE,
)
# reflect-utterance.sh:103 — anchored at start of prompt.
RE_T3_ANCHORED = re.compile(
    r"^[ \t]*(no[ \t]+wait|no[ \t]+stop|no,|nope,|nah,|undo[ \t]+that|undo[ \t]+this|"
    r"revert[ \t]+that|revert[ \t]+this|that.s[ \t]+wrong|that.s[ \t]+not|stop[-—,.]|"
    r"don.t[ \t]|hold[ \t]+on|wait,|actually[ \t]+let.s[ \t]+not|please[ \t]+undo|"
    r"please[ \t]+revert)",
    re.IGNORECASE,
)
# reflect-utterance.sh:106 — unanchored.
RE_T3_ANYWHERE = re.compile(
    r"(rollback[ \t]+that|undo[ \t]+my[ \t]+last|revert[ \t]+the[ \t]+last|"
    r"back[ \t]+out[ \t]+of[ \t]+that)",
    re.IGNORECASE,
)

# ── COUNTERFACTUAL: what Tier 3 would catch if it spoke Korean ─────────────
# NOT shipped. Used only to measure the blind spot. Mirrors the English
# semantics: explicit negation / undo / stop-and-redirect, at prompt head.
RE_T3_KO_POSITIVE = re.compile(
    r"(맞아|맞네|좋은\s*지적|이해했|그렇네|납득|알겠)",
)
RE_T3_KO = re.compile(
    r"("
    r"아니(야|요|다|,|\s|$)|아냐|아닌데|그게\s*아니|틀렸|틀린데|"
    r"되돌려|돌려놔|취소|원복|롤백|"
    r"하지\s*마|하지마|그만|멈춰|스톱|"
    r"잠깐|잠시만|기다려|"
    r"다시\s*해|다시해|엎어|갈아|"
    r"왜\s*그렇게|누가\s*그렇게|그거\s*말고|그건\s*아니"
    r")",
)


@dataclass
class SessionResult:
    session_id: str
    project: str
    n_turns: int = 0          # tool calls + user prompts the hooks would see
    n_prompts: int = 0
    n_tool_calls: int = 0
    t1: int = 0
    t2: int = 0
    t3: int = 0
    fires: int = 0            # times cum_x100 crossed 240 (production)
    peak_cum: int = 0         # highest cum_x100 reached (shows "how close")
    # counterfactual
    t3_ko: int = 0            # Tier-3 hits a Korean-aware regex would have caught
    fires_ko: int = 0         # fires if Tier 3 also spoke Korean
    ko_prompt_share: float = 0.0
    samples_ko: list = field(default_factory=list)


def iter_events(path: Path):
    """Yield ('prompt', text) and ('tool', name, bash_cmd) in transcript order.

    Mirrors what the two hooks actually observe:
      - UserPromptSubmit  -> real user prompts (not tool_result echoes)
      - PostToolUse       -> tool calls, with Bash command text
    """
    with path.open("r", encoding="utf-8", errors="replace") as fh:
        for line in fh:
            line = line.strip()
            if not line:
                continue
            try:
                d = json.loads(line)
            except json.JSONDecodeError:
                continue

            typ = d.get("type")
            if d.get("isSidechain"):        # subagent traffic; hooks don't see it
                continue
            msg = d.get("message") or {}

            if typ == "user":
                content = msg.get("content")
                text = None
                if isinstance(content, str):
                    text = content
                elif isinstance(content, list):
                    # a real prompt has text blocks; tool_result echoes do not count
                    if any(b.get("type") == "tool_result" for b in content if isinstance(b, dict)):
                        continue
                    parts = [
                        b.get("text", "")
                        for b in content
                        if isinstance(b, dict) and b.get("type") == "text"
                    ]
                    text = "\n".join(p for p in parts if p)
                if text and text.strip():
                    yield ("prompt", text.strip())

            elif typ == "assistant":
                content = msg.get("content")
                if not isinstance(content, list):
                    continue
                for b in content:
                    if not isinstance(b, dict) or b.get("type") != "tool_use":
                        continue
                    name = b.get("name", "")
                    inp = b.get("input") or {}
                    cmd = inp.get("command", "") if isinstance(inp, dict) else ""
                    yield ("tool", name, cmd if isinstance(cmd, str) else "")


def tier3_english(prompt: str) -> bool:
    head = prompt[:200]
    if RE_T3_POSITIVE.search(head):
        return False
    return bool(RE_T3_ANCHORED.search(head) or RE_T3_ANYWHERE.search(head))


def tier3_korean(prompt: str) -> bool:
    head = prompt[:200]
    if RE_T3_KO_POSITIVE.search(head):
        return False
    return bool(RE_T3_KO.search(head))


def has_hangul(s: str) -> bool:
    return any("가" <= ch <= "힣" for ch in s)


def replay(path: Path, project: str, threshold: int = THRESHOLD_X100) -> SessionResult:
    r = SessionResult(session_id=path.stem, project=project)
    cum = 0            # production: monotonic, reset on fire
    cum_ko = 0         # counterfactual accumulator
    ko_prompts = 0

    for ev in iter_events(path):
        r.n_turns += 1
        sig = 0
        sig_ko = 0

        if ev[0] == "prompt":
            r.n_prompts += 1
            text = ev[1]
            if has_hangul(text):
                ko_prompts += 1
            if tier3_english(text):
                r.t3 += 1
                sig = W_TIER3
                sig_ko = W_TIER3
            elif tier3_korean(text):
                r.t3_ko += 1
                sig_ko = W_TIER3          # counterfactual only
                if len(r.samples_ko) < 3:
                    r.samples_ko.append(text[:70].replace("\n", " "))

        else:  # tool
            r.n_tool_calls += 1
            _, name, cmd = ev
            if name == "Bash" and cmd:
                if RE_TIER1.search(cmd):
                    r.t1 += 1
                    sig = sig_ko = W_TIER1
                elif RE_TIER2.search(cmd) and not RE_TIER2_EXCLUDE.search(cmd):
                    r.t2 += 1
                    sig = sig_ko = W_TIER2

        if sig:
            cum += sig
            r.peak_cum = max(r.peak_cum, cum)
            if cum >= threshold:
                r.fires += 1
                cum = 0
        if sig_ko:
            cum_ko += sig_ko
            if cum_ko >= threshold:
                r.fires_ko += 1
                cum_ko = 0

    r.ko_prompt_share = ko_prompts / r.n_prompts if r.n_prompts else 0.0
    return r


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--projects", required=True)
    ap.add_argument("--out", default="evals/out")
    ap.add_argument("--min-turns", type=int, default=10,
                    help="skip trivial sessions (default: 10 observed events)")
    args = ap.parse_args()

    root = Path(args.projects)
    outdir = Path(args.out)
    outdir.mkdir(parents=True, exist_ok=True)

    files = sorted(root.rglob("*.jsonl"))
    print(f"[replay] {len(files)} session files under {root}", file=sys.stderr)

    results: list[SessionResult] = []
    for i, f in enumerate(files, 1):
        if i % 200 == 0:
            print(f"[replay] {i}/{len(files)}", file=sys.stderr)
        try:
            r = replay(f, project=f.parent.name)
        except Exception as e:  # noqa: BLE001
            print(f"[replay] SKIP {f.name}: {e}", file=sys.stderr)
            continue
        if r.n_turns >= args.min_turns:
            results.append(r)

    # ── Aggregate ──────────────────────────────────────────────────────────
    n = len(results)
    tot_t1 = sum(r.t1 for r in results)
    tot_t2 = sum(r.t2 for r in results)
    tot_t3 = sum(r.t3 for r in results)
    tot_t3ko = sum(r.t3_ko for r in results)
    tot_fires = sum(r.fires for r in results)
    tot_fires_ko = sum(r.fires_ko for r in results)
    fired = sum(1 for r in results if r.fires > 0)
    fired_ko = sum(1 for r in results if r.fires_ko > 0)
    tot_prompts = sum(r.n_prompts for r in results)
    tot_tools = sum(r.n_tool_calls for r in results)
    ko_share = (
        sum(r.ko_prompt_share * r.n_prompts for r in results) / tot_prompts
        if tot_prompts else 0.0
    )

    print()
    print("=" * 66)
    print(f"  reflect — production detector replayed on {n} real sessions")
    print("=" * 66)
    print(f"  tool calls observed : {tot_tools:,}")
    print(f"  user prompts        : {tot_prompts:,}   (Korean: {ko_share:.0%})")
    print()
    print("  SIGNALS (production, as shipped)")
    print(f"    Tier 1  git revert/restore/checkout  w=1.0 : {tot_t1:>6,}")
    print(f"    Tier 2  rm/unlink (non-artifact)     w=0.7 : {tot_t2:>6,}")
    print(f"    Tier 3  user negation (ENGLISH)      w=0.5 : {tot_t3:>6,}")
    print()
    print(f"  FIRES (cum_x100 >= {THRESHOLD_X100})")
    print(f"    total fires        : {tot_fires:,}")
    print(f"    sessions that fired: {fired}/{n}  ({fired/n:.1%})" if n else "")
    print()
    print("  COUNTERFACTUAL — if Tier 3 also matched Korean")
    print(f"    Tier 3 (KO) missed by production      w=0.5 : {tot_t3ko:>6,}")
    print(f"    total fires        : {tot_fires_ko:,}  ({tot_fires_ko - tot_fires:+,})")
    print(f"    sessions that fired: {fired_ko}/{n}  ({fired_ko/n:.1%})" if n else "")
    print("=" * 66)

    # ── Threshold sweep (production signals only) ──────────────────────────
    print("\n  THRESHOLD SWEEP (production signals)")
    print(f"  {'thr':>5} {'fires':>7} {'sessions fired':>16}")
    for thr in (100, 140, 170, 200, 240, 300, 350):
        f_tot = f_sess = 0
        for r in results:
            cum, fires = 0, 0
            for _ in range(r.t1):
                cum += W_TIER1
                if cum >= thr:
                    fires += 1
                    cum = 0
            for _ in range(r.t2):
                cum += W_TIER2
                if cum >= thr:
                    fires += 1
                    cum = 0
            for _ in range(r.t3):
                cum += W_TIER3
                if cum >= thr:
                    fires += 1
                    cum = 0
            f_tot += fires
            f_sess += 1 if fires else 0
        star = "  <- shipped" if thr == THRESHOLD_X100 else ""
        print(f"  {thr:>5} {f_tot:>7,} {f_sess:>10}/{n}{star}")

    # ── Dump ───────────────────────────────────────────────────────────────
    rows = [
        {
            "session_id": r.session_id, "project": r.project,
            "turns": r.n_turns, "prompts": r.n_prompts, "tool_calls": r.n_tool_calls,
            "t1": r.t1, "t2": r.t2, "t3_en": r.t3, "t3_ko_missed": r.t3_ko,
            "fires": r.fires, "fires_if_ko": r.fires_ko, "peak_cum": r.peak_cum,
            "ko_prompt_share": round(r.ko_prompt_share, 3),
        }
        for r in results
    ]
    (outdir / "sessions.json").write_text(
        json.dumps(rows, ensure_ascii=False, indent=1), encoding="utf-8"
    )

    samples = [s for r in results for s in r.samples_ko][:25]
    (outdir / "missed_korean_negations.txt").write_text(
        "\n".join(samples), encoding="utf-8"
    )
    print(f"\n  -> {outdir/'sessions.json'}")
    print(f"  -> {outdir/'missed_korean_negations.txt'}  ({len(samples)} samples)")

    top = sorted(results, key=lambda r: r.t3_ko, reverse=True)[:5]
    if any(t.t3_ko for t in top):
        print("\n  Sessions with the most MISSED Korean negations:")
        for t in top:
            print(f"    {t.t3_ko:>3} missed | fires {t.fires} -> {t.fires_ko} | {t.project[:42]}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
