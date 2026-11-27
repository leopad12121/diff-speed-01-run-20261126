// A faster drop-in for makefun-diff 1.0.0 (MIT, derived from jsdiff 9.0.0).
//
// run(input) returns exactly what makefun-diff 1.0.0's diffPatch returns for
// the same { old, new }: the same patch text, byte for byte. It reproduces the
// reference rule, not jsdiff's and not any public diff tool's:
//
//   * lines are cut after every "\n" (a "\r" is part of its line); a last line
//     with no "\n" is a line too; two lines are equal only as the same code
//     units, newline or its absence included.
//   * the common prefix of lines is kept, then the common suffix of the lines
//     left; between them Myers's greedy search from the first lines, keeping
//     on each diagonal the path reaching furthest into the old text, taking
//     the deletion when a deletion and an insertion reach the same point,
//     never moving past either text's end, pruning no edge diagonal, and
//     following every run of equal lines as far as it goes; the first path to
//     reach both ends is the script.
//   * the patch: "makefun-diff/1 old=N new=M hunks=H deleted=D inserted=I",
//     then per hunk "@ os ol ns nl" and one line per line it covers, "=" kept,
//     "-" deleted, "+" inserted; each change run lists its deletions before
//     its insertions, shows up to 3 kept lines before and after it, and two
//     runs at most 6 kept lines apart share a hunk. A line that ends its text
//     with no newline is written with one and followed by a line "%".
//     Identical texts are the first line alone.
//
// Speed comes from doing the same search without the reference's per-step
// object allocation:
//
//   * lines are interned to small integer ids (one Map per case), so the
//     search and the snakes compare integers in Int32Arrays, never strings;
//   * the greedy search keeps, per depth d, one Int32Array of the furthest
//     old position per diagonal (the reference keeps a linked list of path
//     objects per diagonal per depth), and the script is recovered by
//     backtracking over those arrays with the reference's own tie-break;
//   * the patch is built from the recovered runs with the reference's own
//     hunk rules, writing into one array joined once.
//
// No work is cached from one case to the next: every call re-tokenizes and
// re-searches its own input. The module is deterministic: two runs on the
// same input return the same string.

const UNDEF = -2147483648; // no path on this diagonal: below every real old position (-1 and up)

/** makefun-diff 1.0.0's answer for one case's input. */
export function run(input) {
  if (input === null || typeof input !== 'object' || typeof input.old !== 'string' || typeof input.new !== 'string') {
    throw new TypeError('makefun-diff: the input is { old, new }, two strings');
  }

  // ---- tokenize: lines as integer ids -------------------------------------
  // A line's identity is its text plus whether it ends in "\n": the id packs
  // both as base * 2 + hasNewline, where base interns the line's text without
  // its "\n". Two lines share an id exactly when they are the same code units,
  // newline or its absence included.
  const interned = new Map();
  const parts = [];
  const intern = (text) => {
    let base = interned.get(text);
    if (base === undefined) {
      base = parts.length;
      interned.set(text, base);
      parts.push(text);
    }
    return base;
  };
  const tokenize = (text) => {
    const split = text.split('\n');
    const last = split.length - 1;
    const out = new Int32Array(last + (split[last] !== '' ? 1 : 0));
    for (let i = 0; i < last; i++) out[i] = intern(split[i]) * 2 + 1;
    if (split[last] !== '') out[last] = intern(split[last]) * 2;
    return out;
  };
  const a = tokenize(input.old);
  const b = tokenize(input.new);
  const n = a.length;
  const m = b.length;

  // ---- common prefix, then common suffix of what is left ------------------
  let prefix = 0;
  while (prefix < n && prefix < m && a[prefix] === b[prefix]) prefix++;
  let suffix = 0;
  while (suffix < n - prefix && suffix < m - prefix && a[n - 1 - suffix] === b[m - 1 - suffix]) suffix++;
  const N = n - prefix - suffix;
  const M = m - prefix - suffix;

  // ---- Myers's greedy search on the middle, with backtracking -------------
  // runs: [kind, count] in order, kind 0 = keep, 1 = delete, 2 = insert.
  // Vs[d] is the furthest old position (last old line consumed, -1 for none)
  // reached on each diagonal k in [-d, d] at depth d, after its snake; index
  // j = k + d. A run of the search is one edit plus the snake that follows it.
  const runs = [];
  if (N > 0 || M > 0) {
    const Vs = [];
    let v0 = new Int32Array(1);
    let x = -1;
    let y = -1;
    while (x + 1 < N && y + 1 < M && a[prefix + x + 1] === b[prefix + y + 1]) { x++; y++; }
    v0[0] = x;
    Vs.push(v0);
    let D = 0;
    let K = 0;
    let done = x + 1 >= N && y + 1 >= M;
    for (let d = 1; !done && d <= N + M; d++) {
      const prev = Vs[d - 1];
      const cur = new Int32Array(2 * d + 1);
      cur.fill(UNDEF);
      for (let j = 0; j <= 2 * d; j += 2) {
        const k = j - d;
        // The deletion's path lives on diagonal k - 1 at depth d - 1 (prev index
        // j - 2), the insertion's on k + 1 (prev index j); either is absent
        // outside its diagonal range.
        const rem = j >= 2 ? prev[j - 2] : UNDEF;
        const add = j <= 2 * d - 2 ? prev[j] : UNDEF;
        const canRemove = rem !== UNDEF && rem + 1 < N;
        const canAdd = add !== UNDEF && add - k < M;
        if (!canRemove && !canAdd) continue;
        // The candidate further into the old text wins; the deletion wins a tie.
        let xx;
        if (canRemove && (!canAdd || rem + 1 >= add)) xx = rem + 1;
        else xx = add;
        let yy = xx - k;
        while (xx + 1 < N && yy + 1 < M && a[prefix + xx + 1] === b[prefix + yy + 1]) { xx++; yy++; }
        cur[j] = xx;
        if (xx + 1 >= N && yy + 1 >= M) { D = d; K = k; done = true; break; }
      }
      Vs.push(cur);
    }
    if (!done) throw new Error('makefun-diff: the search ended without reaching both ends');

    // Backtrack from (N - 1, M - 1) at depth D: at each depth the snake first,
    // then the edit that led to it, using the same tie-break the search did.
    const rev = [];
    let cx = N - 1;
    let cy = M - 1;
    for (let d = D; d >= 1; d--) {
      const k = cx - cy;
      const prev = Vs[d - 1];
      const rem = k - 1 >= -(d - 1) && k - 1 <= d - 1 ? prev[k - 1 + (d - 1)] : UNDEF;
      const add = k + 1 >= -(d - 1) && k + 1 <= d - 1 ? prev[k + 1 + (d - 1)] : UNDEF;
      const canRemove = rem !== UNDEF && rem + 1 < N;
      const canAdd = add !== UNDEF && add - k < M;
      let del;
      if (canRemove && (!canAdd || rem + 1 >= add)) del = true;
      else if (canAdd) del = false;
      else throw new Error('makefun-diff: backtrack found no predecessor');
      let px;
      let py;
      let snake;
      if (del) {
        px = rem;
        py = rem - (k - 1);
        snake = cx - (rem + 1);
      } else {
        px = add;
        py = add - (k + 1);
        snake = cx - add;
      }
      if (snake > 0) rev.push([0, snake]);
      rev.push([del ? 1 : 2, 1]);
      cx = px;
      cy = py;
    }
    if (cx + 1 > 0) rev.push([0, cx + 1]); // the d = 0 snake from the first lines
    for (let i = rev.length - 1; i >= 0; i--) {
      const seg = rev[i];
      const lastRun = runs.length > 0 ? runs[runs.length - 1] : undefined;
      if (lastRun !== undefined && lastRun[0] === seg[0]) lastRun[1] += seg[1];
      else runs.push([seg[0], seg[1]]);
    }
  }

  // ---- the patch ------------------------------------------------------------
  const KEEP = 0;
  const DELETE = 1;
  const INSERT = 2;
  // The change runs: each a stretch of deletions and insertions between two
  // kept lines, at old line o and new line p.
  const changes = [];
  let o = 0;
  let p = 0;
  let deleted = 0;
  let inserted = 0;
  const allRuns = runs;
  let mi = 0;
  let stage = prefix > 0 ? 0 : 1;
  const nextRun = () => {
    if (stage === 0) { stage = 1; return [KEEP, prefix]; }
    if (stage === 1) {
      if (mi < allRuns.length) return allRuns[mi++];
      stage = 2;
    }
    if (stage === 2) {
      stage = 3;
      if (suffix > 0) return [KEEP, suffix];
    }
    return undefined;
  };
  // Walk prefix, then the middle runs, then suffix, without building a copy.
  let r = nextRun();
  while (r !== undefined) {
    const kind = r[0];
    const count = r[1];
    if (kind === KEEP) {
      o += count;
      p += count;
    } else {
      let c = changes.length > 0 ? changes[changes.length - 1] : undefined;
      if (c === undefined || c.o + c.dels !== o || c.p + c.ins !== p) {
        c = { o, p, dels: 0, ins: 0 };
        changes.push(c);
      }
      if (kind === DELETE) {
        c.dels += count;
        o += count;
        deleted += count;
      } else {
        c.ins += count;
        p += count;
        inserted += count;
      }
    }
    r = nextRun();
  }

  // The hunks: change runs at most 6 kept lines apart share one.
  const hunks = [];
  for (const c of changes) {
    const h = hunks.length > 0 ? hunks[hunks.length - 1] : undefined;
    const prevChange = h !== undefined ? h[h.length - 1] : undefined;
    if (prevChange !== undefined && c.o - (prevChange.o + prevChange.dels) <= 6) h.push(c);
    else hunks.push([c]);
  }

  const written = (op, id) => {
    const line = parts[id >> 1];
    return (id & 1) === 1 ? `${op}${line}\n` : `${op}${line}\n%\n`;
  };
  const out = [`makefun-diff/1 old=${n} new=${m} hunks=${hunks.length} deleted=${deleted} inserted=${inserted}\n`];
  for (const h of hunks) {
    const first = h[0];
    const last = h[h.length - 1];
    const oldStart = Math.max(0, first.o - 3);
    const newStart = first.p - (first.o - oldStart);
    const after = Math.min(3, n - (last.o + last.dels));
    const oldEnd = last.o + last.dels + after;
    const newEnd = last.p + last.ins + after;
    out.push(`@ ${oldStart + 1} ${oldEnd - oldStart} ${newStart + 1} ${newEnd - newStart}\n`);
    let at = oldStart;
    for (const c of h) {
      for (; at < c.o; at++) out.push(written('=', a[at]));
      for (let i = 0; i < c.dels; i++) out.push(written('-', a[c.o + i]));
      for (let i = 0; i < c.ins; i++) out.push(written('+', b[c.p + i]));
      at = c.o + c.dels;
    }
    for (; at < oldEnd; at++) out.push(written('=', a[at]));
  }
  return out.join('');
}
