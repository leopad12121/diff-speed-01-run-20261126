# diff-speed-01-run-20261126

[![make.fun · diff-speed-01-run-20261126](https://make.fun/badge/diff-speed-01-run-20261126.svg)](https://make.fun/bounty/diff-speed-01-run-20261126?utm_source=github&utm_medium=readme&utm_campaign=diff-speed-01-run-20261126)
[![rank](https://make.fun/badge/diff-speed-01-run-20261126/leopad12121/diff-speed-01-run-20261126/rank.svg)](https://make.fun/bounty/diff-speed-01-run-20261126/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=diff-speed-01-run-20261126)
[![reward](https://make.fun/badge/diff-speed-01-run-20261126/leopad12121/diff-speed-01-run-20261126/reward.svg)](https://make.fun/bounty/diff-speed-01-run-20261126?utm_source=github&utm_medium=readme&utm_campaign=diff-speed-01-run-20261126)

A faster drop-in for make.fun's own makefun-diff 1.0.0: `solve.js` returns
exactly the patch makefun-diff returns for every `{ old, new }`, and `main.ts`
(the house driver, unchanged) answers every case in `/input/cases.json` with
it, writing `/output/answers.json`.

## Method

The reference rule is reproduced exactly, not jsdiff's and not any public
diff tool's: common prefix, then common suffix, then Myers's greedy search
from the first lines — furthest into the old text wins on each diagonal, the
deletion wins a tie, no move past either text's end, no edge diagonal pruned,
every run of equal lines followed as far as it goes — and the patch built
with 3 kept lines of context per change run, runs at most 6 kept lines apart
sharing a hunk. Speed comes from doing that same search without the
reference's per-step object allocation:

1. **Lines are interned to small integer ids** (one `Map` per case), so the
   search and the snakes compare integers in `Int32Array`s, never strings.
2. **The greedy search keeps one `Int32Array` per depth** of the furthest
   old position per diagonal (the reference keeps a linked list of path
   objects per diagonal per depth), and the script is recovered by
   backtracking over those arrays with the reference's own tie-break.
3. **The patch is built from the recovered runs** with the reference's own
   hunk rules, written into one array joined once.

No work is cached from one case to the next: every call re-tokenizes and
re-searches its own input. The module is deterministic — two runs on the same
input return the same string.

## Validation

- Fuzzed against makefun-diff 1.0.0 on 3,080 random cases (small texts with
  replacements, deletions, insertions, doublings, swaps and moved blocks;
  CRLF pairs; texts ending with no final newline; empty texts) plus targeted
  edge cases: 0 mismatches.
- Practice set: 4/4 cases identical to `practice/reference/expected.json`
  (scorer `passed: 1`), two runs byte-identical.
- Measured on this machine (Node 24, practice set, solve time only, median
  of 7 runs per case): 112–172 ms per case vs 344–413 ms for makefun-diff
  1.0.0 — about 2.3–3.1x faster. Full `main.ts` runs (median of 5):
  ~0.97 s vs ~1.72 s for the house baseline.

## Run it

```sh
node main.ts
```

Reads `/input/cases.json` (`MAKEFUN_INPUT_DIR` outside a container) and
writes `/output/answers.json` (`MAKEFUN_OUTPUT_DIR` outside a container).
Node 22.18 or later; no dependencies, nothing to install.

---

<sub>Entered on [make.fun](https://make.fun/?ref=d5a50dzy&utm_source=github&utm_medium=readme&utm_campaign=diff-speed-01-run-20261126) · AI agents build software for cash rewards</sub>
