import { BoundType } from "../core/bound-type";
import { BigIntPoint, bigintScalar } from "../core/scalars";
import { defineRange } from "../range/range";
import { RangeMap } from "./range-map";
import { R, RefRange, RefRangeMap } from "./guava-ref";

/**
 * Exact-domain (`bigint` id) differential against the same Guava reference
 * model used by `guava-differential.spec.ts`.
 *
 * WHY A SECOND SUITE AND NOT WIDER NUMBERS IN THE FIRST. The numeric
 * differential runs on a continuous domain probed at halves, so a boundary
 * that is wrong by exactly one point is invisible there: on `[1..5]` vs
 * `[1..4]` the probe at 4.5 cannot tell, and the probes that can (the
 * integers) sit exactly where the OPEN/CLOSED decision is made — which is
 * where a continuous-domain test is weakest and an id-domain test is
 * strongest.
 *
 * This is also the domain the library is actually used on for record ids, and
 * the domain where the failure mode is worst in kind rather than in size: one
 * swallowed id is one lost record, silently, and it never shows up in a smoke
 * test because the map still looks consistent around it. The `bigintScalar`
 * fixes in this release (an unordered operand returning `0`, which made
 * `closed(1n, 10n).contains("x")` true) are exactly the class of bug a
 * spec-per-case misses and a differential over the whole domain does not.
 *
 * WHAT IS ASSERTED — same three contracts as the numeric suite:
 *
 * 1. Point mapping must match Guava exactly, at EVERY id in the domain.
 *    Nothing is sampled: on an 8-value domain full coverage is affordable,
 *    and partial coverage of an id domain is the thing being tested.
 * 2. Structural divergence allowed one way only — range-ts may merge MORE
 *    than Guava (documented second-probe difference), never LESS.
 * 3. Throw behaviour must match.
 *
 * COVERAGE LIMITS, stated rather than implied: the reference model is a
 * linear array, so it matches Guava's logic and not its asymptotics; and it
 * models the point domain only as far as `bigint` finite values go — the
 * `BIGINT_PLUS_INFINITY` / `BIGINT_MINUS_INFINITY` sentinels the scalar
 * supports are NOT in the generated input space.
 */

const RR = defineRange(bigintScalar);
const b = (n: number): bigint => BigInt(n);

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

// Ids 1..8. Small on purpose: every id is probed after every operation, so
// the cost is ops x |domain| and the value is that NO point is unobserved.
const IDS = [1, 2, 3, 4, 5, 6, 7, 8];
const POINTS: bigint[] = IDS.map(b);
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
  let lo = IDS[Math.floor(r() * IDS.length)];
  let hi = IDS[Math.floor(r() * IDS.length)];
  let [loT, hiT] = BT[Math.floor(r() * BT.length)];
  if (lo > hi) [lo, hi] = [hi, lo];
  if (lo === hi && loT === BoundType.OPEN && hiT === BoundType.OPEN) hiT = BoundType.CLOSED;
  return {
    lo,
    loT,
    hi,
    hiT,
    empty: lo === hi && (loT === BoundType.OPEN || hiT === BoundType.OPEN),
  };
}

const snapRef = (m: RefRangeMap): string => m.snapshot();
const snapMine = (m: RangeMap<string, BigIntPoint, any>): string =>
  [...m.asMapOfRanges().entries()].map(([k, v]) => k.toString() + "=" + v).join(" | ") || "(empty)";

/**
 * Build the library range from the generated bound types. Written as a switch
 * rather than a factory call because `RangeFactory` exposes the four named
 * shapes and no bound-type-parameterised constructor — which is deliberate on
 * its part, and here just means four lines.
 */
function makeRange(loT: BoundType, lo: bigint, hiT: BoundType, hi: bigint) {
  if (loT === BoundType.CLOSED) {
    return hiT === BoundType.CLOSED ? RR.closed(lo, hi) : RR.closedOpen(lo, hi);
  }
  return hiT === BoundType.CLOSED ? RR.openClosed(lo, hi) : RR.open(lo, hi);
}

const TRIALS = 3000;
const STEPS = 6;

describe("differential vs Guava reference model — exact (bigint id) domain", () => {
  let ops = 0;
  let pointDiffs: string[] = [];
  let throwDiffs: string[] = [];
  let structDiff = 0;
  let overMerge = 0;
  let underMerge: string[] = [];
  let emptyBridgeOps = 0;
  let emptyBridgeMerges = 0;
  // Single-point events are counted separately because they are the failure
  // mode this suite exists for: a write that covers exactly one id more or
  // less than Guava's would be a lost/stranded record.
  let singlePointOps = 0;

  beforeAll(() => {
    for (let trial = 0; trial < TRIALS; trial++) {
      const r = rng(77000 + trial);
      const ref = new RefRangeMap();
      const mine = new RangeMap<string, BigIntPoint>();
      const log: string[] = [];

      for (let step = 0; step < STEPS; step++) {
        const kind = r();
        const x = randRange(r);
        const v = String.fromCharCode(97 + Math.floor(r() * 3));
        const op = kind < 0.35 ? "put" : kind < 0.85 ? "putCoalescing" : "remove";
        const label = `${op}(${x.loT === BoundType.CLOSED ? "[" : "("}${x.lo}..${x.hi}${
          x.hiT === BoundType.CLOSED ? "]" : ")"
        }, ${v})${x.empty ? "  [EMPTY]" : ""}`;

        const refRange: RefRange = R(b(x.lo), x.loT, b(x.hi), x.hiT);
        let errRef: string | null = null;
        let errMine: string | null = null;

        try {
          if (op === "remove") ref.remove(refRange);
          else (ref as any)[op](refRange, v);
        } catch (e: any) {
          errRef = String(e.message).slice(0, 60);
        }
        try {
          const nr = makeRange(x.loT, b(x.lo), x.hiT, b(x.hi));
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
        if (errRef) continue;
        ops++;

        if (x.lo === x.hi && x.loT === BoundType.CLOSED && x.hiT === BoundType.CLOSED) {
          singlePointOps++;
        }

        // 1. point mapping over the WHOLE domain — hard contract.
        let pd: string | null = null;
        for (const k of POINTS) {
          const a = ref.get(k);
          const c = mine.get(k);
          if (a !== c) {
            pd = `get(${k}): ref=${a} mine=${c}`;
            break;
          }
        }
        if (pd) {
          if (pointDiffs.length < 3)
            pointDiffs.push(
              `${log.join("\n    ")}\n    ${pd}\n    ref : ${snapRef(ref)}\n    mine: ${snapMine(mine)}`
            );
          break;
        }

        // 2. structure — allowed, over-merge only.
        const sa = snapRef(ref);
        const sb = snapMine(mine);
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
    expect(ops).toBeGreaterThan(TRIALS * STEPS * 0.4);
  });

  it("exercises single-point (closed, lo==hi) writes", () => {
    // Without these the suite would not test the one-id case it was written for.
    expect(singlePointOps).toBeGreaterThan(0);
  });

  it("matches Guava's point mapping exactly on every id", () => {
    expect({ ops, pointDiffs }).toEqual({ ops, pointDiffs: [] });
  });

  it("matches Guava's throw behaviour exactly", () => {
    expect(throwDiffs).toEqual([]);
  });

  it("never merges LESS than Guava (structural diffs are over-merge only)", () => {
    expect({ structDiff, overMerge, underMerge }).toEqual({
      structDiff,
      overMerge,
      underMerge: [],
    });
  });

  afterAll(() => {
    console.log(
      `[guava-differential-exact] ops=${ops} singlePoint=${singlePointOps} ` +
        `structDiff=${structDiff} (over-merge=${overMerge}, under-merge=${underMerge.length}) ` +
        `emptyBridge=${emptyBridgeMerges}/${emptyBridgeOps}`
    );
  });
});
