import { BoundType } from "../core/bound-type";
import { NumberRange } from "../number-range/number-range";
import { RangeMap } from "./range-map";
import { R, RefRange, RefRangeMap } from "./guava-ref";

/**
 * Randomised differential against an independent Guava reference model.
 *
 * WHY THIS IS IN THE SUITE AND NOT IN A SCRATCH DIR. "Based on Guava's
 * RangeMap" is the claim the README opens with, and until now nothing in the
 * repo checked it. A one-off verification in a temp file dies with the
 * session that wrote it; this keeps the guarantee honest across refactors.
 *
 * WHAT IS ASSERTED, and why the assertion is drawn this way:
 *
 * 1. **Point mapping must match exactly.** `get(k)` for every k is the
 *    semantic contract of a range map. Zero divergence tolerated.
 *
 * 2. **Structural divergence is allowed, but only in one direction.**
 *    range-ts's `putCoalescing` runs its second neighbour probe against the
 *    array the first probe already spliced, where Guava reads both against
 *    the unmutated map. So range-ts can merge MORE. It must never merge
 *    LESS — a missed merge would mean a feature silently absent, which is
 *    the bug class this differential exists to catch. So: every structural
 *    difference must show range-ts with FEWER entries than Guava.
 *
 * 3. **Throw behaviour must match.** Neither side may accept what the other
 *    rejects.
 *
 * Empty ranges (`[v..v)`, `(v..v]`) ARE in the input space on purpose —
 * Guava treats an empty `putCoalescing` as a bridge between two adjacent
 * same-value ranges, and that path is invisible to a generator that excludes
 * them.
 */

function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const VALS = [0, 1, 2, 3, 4];
/**
 * Probed at quarters, not halves. With integer-valued boundaries, halves
 * already cover every distinct region; quarters are here because they put
 * probes *inside* the intervals between boundaries, so a divergence that
 * shifts a boundary by half a step (rather than a whole one) shows up as a
 * point-mapping difference instead of sliding through. Cost is linear in
 * probe count and the whole suite still runs in well under a second.
 */
const POINTS = [0, 0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 2.25, 2.5, 2.75, 3, 3.25, 3.5, 3.75, 4];
const BT: [BoundType, BoundType][] = [
  [BoundType.CLOSED, BoundType.CLOSED],
  [BoundType.CLOSED, BoundType.OPEN],
  [BoundType.OPEN, BoundType.CLOSED],
  [BoundType.OPEN, BoundType.OPEN],
];

interface Gen {
  lo: number;
  loT: BoundType;
  hi: number;
  hiT: BoundType;
  empty: boolean;
}

function randRange(r: () => number): Gen {
  let lo = VALS[Math.floor(r() * VALS.length)];
  let hi = VALS[Math.floor(r() * VALS.length)];
  let [loT, hiT] = BT[Math.floor(r() * BT.length)];
  if (lo > hi) [lo, hi] = [hi, lo];
  // (v..v] is not a well-formed operand in Guava either; skip that one shape.
  if (lo === hi && loT === BoundType.OPEN && hiT === BoundType.OPEN) hiT = BoundType.CLOSED;
  return {
    lo,
    loT,
    hi,
    hiT,
    empty: lo === hi && (loT === BoundType.OPEN || hiT === BoundType.OPEN),
  };
}

const snapNew = (m: RangeMap<string, any, any>): string =>
  [...m.asMapOfRanges().entries()].map(([k, v]) => k.toString() + "=" + v).join(" | ") || "(empty)";

const TRIALS = 4000;
const STEPS = 6;

describe("differential vs Guava reference model", () => {
  let ops = 0;
  let pointDiffs: string[] = [];
  let throwDiffs: string[] = [];
  let structDiff = 0;
  let overMerge = 0;
  let underMerge: string[] = [];
  let emptyBridgeOps = 0;
  let emptyBridgeMerges = 0;

  beforeAll(() => {
    for (let trial = 0; trial < TRIALS; trial++) {
      const r = rng(55000 + trial);
      const ref = new RefRangeMap();
      const mine = new RangeMap<string>();
      const log: string[] = [];

      for (let step = 0; step < STEPS; step++) {
        const kind = r();
        const x = randRange(r);
        // Four distinct values, not two. A two-value alphabet makes equal-value
        // neighbours the common case, which is good for exercising coalescing
        // but poor for exercising the case that actually breaks: a *different*
        // value sitting between two same-value ones, where an over-eager merge
        // would swallow a mapping that should have survived.
        const v = String.fromCharCode(97 + Math.floor(r() * 4));
        const op = kind < 0.35 ? "put" : kind < 0.85 ? "putCoalescing" : "remove";
        const label = `${op}(${x.loT === BoundType.CLOSED ? "[" : "("}${x.lo}..${x.hi}${
          x.hiT === BoundType.CLOSED ? "]" : ")"
        }, ${v})${x.empty ? "  [EMPTY]" : ""}`;

        const refRange: RefRange = R(x.lo, x.loT, x.hi, x.hiT);
        let errRef: string | null = null;
        let errMine: string | null = null;

        try {
          if (op === "remove") ref.remove(refRange);
          else (ref as any)[op](refRange, v);
        } catch (e: any) {
          errRef = String(e.message).slice(0, 60);
        }
        try {
          const nr = new NumberRange(x.lo, x.loT, x.hi, x.hiT);
          if (op === "remove") mine.remove(nr);
          else (mine as any)[op](nr, v);
        } catch (e: any) {
          errMine = String(e.message).slice(0, 60);
        }

        log.push(label);

        if (!!errRef !== !!errMine) {
          if (throwDiffs.length < 3)
            throwDiffs.push(`${log.join("\n    ")}\n    ref=${errRef} mine=${errMine}`);
          break;
        }
        if (errRef) continue; // both rejected — consistent
        ops++;

        // 1. point mapping — hard contract
        let pd: string | null = null;
        for (const k of POINTS) {
          const a = ref.get(k);
          const b = mine.get(k);
          if (a !== b) {
            pd = `get(${k}): ref=${a} mine=${b}`;
            break;
          }
        }
        if (pd) {
          if (pointDiffs.length < 3)
            pointDiffs.push(
              `${log.join("\n    ")}\n    ${pd}\n    ref : ${ref.snapshot()}\n    mine: ${snapNew(mine)}`
            );
          break;
        }

        // 2. structure — allowed, but over-merge only
        const sa = ref.snapshot();
        const sb = snapNew(mine);
        if (sa !== sb) {
          structDiff++;
          const na = sa.split(" | ").length;
          const nb = sb.split(" | ").length;
          if (nb < na) overMerge++;
          else if (nb > na && underMerge.length < 3)
            underMerge.push(`${log.join("\n    ")}\n    ref : ${sa}\n    mine: ${sb}`);

          if (x.empty && op === "putCoalescing") {
            emptyBridgeOps++;
            if (nb < na) emptyBridgeMerges++;
          }
        }
      }
    }
  });

  it("compares a meaningful number of operations", () => {
    // Guards against the differential silently degenerating to zero work,
    // which would make every assertion below vacuously true.
    expect(ops).toBeGreaterThan(TRIALS * STEPS * 0.4);
  });

  it("matches Guava's point mapping exactly", () => {
    expect({ ops, pointDiffs }).toEqual({ ops, pointDiffs: [] });
  });

  it("matches Guava's throw behaviour exactly", () => {
    expect(throwDiffs).toEqual([]);
  });

  it("never merges LESS than Guava (structural diffs are over-merge only)", () => {
    expect({
      structDiff,
      overMerge,
      underMerge,
    }).toEqual({ structDiff, overMerge, underMerge: [] });
  });

  it("performs the empty-range bridge Guava performs", () => {
    // The bridge must actually fire sometimes, or "it works" is unverified.
    expect(emptyBridgeOps).toBeGreaterThan(0);
    expect(emptyBridgeMerges).toBeGreaterThan(0);
  });

  afterAll(() => {
    // Printed so a future reader sees the shape of the divergence, not just
    // a green tick or a bare count.
    console.log(
      `[guava-differential] ops=${ops} structDiff=${structDiff} ` +
        `(over-merge=${overMerge}, under-merge=${underMerge.length}) ` +
        `emptyBridge=${emptyBridgeMerges}/${emptyBridgeOps}`
    );
  });
});
