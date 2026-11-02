/**
 * Independent reference model of Guava's RangeMap, transcribed from Java source:
 *
 *   guava/src/com/google/common/collect/Cut.java
 *   guava/src/com/google/common/collect/Range.java
 *   guava/src/com/google/common/collect/TreeRangeMap.java
 *
 * This exists so the differential in `guava-differential.spec.ts` compares
 * range-ts against something derived from Guava's actual algorithm rather than
 * against our own reading of it. It is a JS transcription, not the JVM: it
 * proves our logic matches Guava's LOGIC, and it cannot prove anything about
 * Java-specific behaviour we do not model.
 *
 * Cut = { v, s }; s 0 = BelowValue (cut sits AT v), s 1 = AboveValue (just
 * above v). From Cut.java:
 *
 *   BelowValue.typeAsLowerBound() = CLOSED   AboveValue.typeAsLowerBound() = OPEN
 *   BelowValue.typeAsUpperBound() = OPEN     AboveValue.typeAsUpperBound() = CLOSED
 *   compareTo: Boolean.compare(this instanceof AboveValue, that instanceof AboveValue)
 *
 * => lower CLOSED -> (v,0)   lower OPEN  -> (v,1)
 *    upper CLOSED -> (v,1)   upper OPEN  -> (v,0)
 *
 * Re-cutting a cut:
 *   as LOWER bound: side 0 -> CLOSED, side 1 -> OPEN
 *   as UPPER bound: side 0 -> OPEN,   side 1 -> CLOSED
 */

export const CLOSED = "CLOSED";
export const OPEN = "OPEN";

export type Bound = typeof CLOSED | typeof OPEN;

/**
 * Point domain of the reference model. `number` for the continuous/numeric
 * differential, `bigint` for the exact-id differential. The model is
 * homogeneous: one map holds one domain, and the two are never mixed inside a
 * comparison (JS relational operators on `bigint` vs `number` are legal but
 * `bigint - number` throws, so mixing would be a silent trap).
 */
export type Point = number | bigint;

/** Plain-data range: deliberately NOT the library's own Range class. */
export interface RefRange {
  lo: Point;
  loT: Bound;
  hi: Point;
  hiT: Bound;
}

interface Cut {
  v: Point;
  s: number;
}

interface RefEntry extends RefRange {
  value: string;
}

const asLower = (side: number): Bound => (side === 0 ? CLOSED : OPEN);
const asUpper = (side: number): Bound => (side === 0 ? OPEN : CLOSED);

export const R = (lo: Point, loT: Bound, hi: Point, hiT: Bound): RefRange => ({
  lo,
  loT,
  hi,
  hiT,
});

export const lowerCut = (r: RefRange): Cut => ({ v: r.lo, s: r.loT === CLOSED ? 0 : 1 });
export const upperCut = (r: RefRange): Cut => ({ v: r.hi, s: r.hiT === CLOSED ? 1 : 0 });
/**
 * Written as a three-way compare rather than `a.v - b.v` so it is valid on
 * `bigint` (subtraction between a bigint and a number throws, and a bigint
 * difference would leak the operand type into every `> 0` test). Same ordering
 * for numbers. Not NaN-safe in the same way subtraction was: `NaN` sorts as
 * greater. The generator never produces NaN; a domain that can must not use
 * this model.
 */
export const cmpCut = (a: Cut, b: Cut): number => (a.v !== b.v ? (a.v < b.v ? -1 : 1) : a.s - b.s);

export const isEmpty = (r: RefRange): boolean => cmpCut(lowerCut(r), upperCut(r)) === 0;

export const contains = (r: RefRange, k: Point): boolean => {
  const lc = lowerCut(r);
  const lo = lc.s === 0 ? lc.v <= k : lc.v < k;
  const uc = upperCut(r);
  const hi = uc.s === 0 ? !(uc.v <= k) : !(uc.v < k);
  return lo && hi;
};

export const encloses = (a: RefRange, b: RefRange): boolean =>
  cmpCut(lowerCut(a), lowerCut(b)) <= 0 && cmpCut(upperCut(a), upperCut(b)) >= 0;

export const isConnected = (a: RefRange, b: RefRange): boolean =>
  cmpCut(lowerCut(a), upperCut(b)) <= 0 && cmpCut(lowerCut(b), upperCut(a)) <= 0;

export const span = (a: RefRange, b: RefRange): RefRange => {
  const lo = cmpCut(lowerCut(a), lowerCut(b)) <= 0 ? a : b;
  const hi = cmpCut(upperCut(a), upperCut(b)) >= 0 ? a : b;
  return R(lo.lo, lo.loT, hi.hi, hi.hiT);
};

export const intersection = (a: RefRange, b: RefRange): RefRange | null => {
  if (!isConnected(a, b)) return null;
  const lo = cmpCut(lowerCut(a), lowerCut(b)) >= 0 ? a : b;
  const hi = cmpCut(upperCut(a), upperCut(b)) <= 0 ? a : b;
  return R(lo.lo, lo.loT, hi.hi, hi.hiT);
};

export const fmt = (r: RefRange): string =>
  `${r.loT === CLOSED ? "[" : "("}${r.lo}..${r.hi}${r.hiT === CLOSED ? "]" : ")"}`;

/**
 * TreeRangeMap over an array kept sorted by lowerCut (stands in for the TreeMap).
 * Linear scans instead of a tree: identical semantics, and the differential is
 * about ordering and coalescing logic, not asymptotics.
 */
export class RefRangeMap {
  e: RefEntry[] = [];

  constructor(private eq: (a: string, b: string) => boolean = (x, y) => x === y) {}

  private sorted(): void {
    this.e.sort((x, y) => cmpCut(lowerCut(x), lowerCut(y)));
  }

  private find(cut: Cut): number {
    return this.e.findIndex((x) => cmpCut(lowerCut(x), cut) === 0);
  }

  private floor(c: Cut): number {
    let best = -1;
    for (let i = 0; i < this.e.length; i++) if (cmpCut(lowerCut(this.e[i]), c) <= 0) best = i;
    return best;
  }

  private lower(c: Cut): number {
    let best = -1;
    for (let i = 0; i < this.e.length; i++) if (cmpCut(lowerCut(this.e[i]), c) < 0) best = i;
    return best;
  }

  private putAt(cut: Cut, range: RefRange, value: string): void {
    const rec: RefEntry = { ...range, value };
    const i = this.find(cut);
    if (i >= 0) this.e[i] = rec;
    else {
      this.e.push(rec);
      this.sorted();
    }
  }

  get(key: Point): string | null {
    const i = this.floor({ v: key, s: 0 }); // Cut.belowValue(key)
    if (i >= 0 && contains(this.e[i], key)) return this.e[i].value;
    return null;
  }

  put(range: RefRange, value: string): void {
    if (isEmpty(range)) return; // Guava: if (!range.isEmpty())
    this.remove(range);
    this.putAt(lowerCut(range), range, value);
  }

  /**
   * Guava's `putCoalescedHeuristics` + `coalescedRange`. NOTE: both probes read
   * the UNMUTATED map — Guava's javadoc on `coalescedRange` says it "does not
   * mutate the map" — and both key off the ORIGINAL range's bounds. range-ts's
   * equivalent splices as it goes, so its second probe can resolve further out
   * and merge more. That divergence is deliberate and documented on
   * `RangeMap.putCoalescing`; the differential asserts it stays structure-only.
   */
  putCoalescing(range: RefRange, value: string): void {
    if (this.e.length === 0) {
      this.put(range, value);
      return;
    }
    let coalesced = range;
    const lo = this.lower(lowerCut(range));
    if (lo >= 0) {
      const ent = this.e[lo];
      if (isConnected(ent, coalesced) && this.eq(value, ent.value))
        coalesced = span(coalesced, ent);
    }
    const hi = this.floor(upperCut(range));
    if (hi >= 0) {
      const ent = this.e[hi];
      if (isConnected(ent, coalesced) && this.eq(value, ent.value))
        coalesced = span(coalesced, ent);
    }
    this.put(coalesced, value);
  }

  remove(rm: RefRange): void {
    if (isEmpty(rm)) return;
    const below = this.lower(lowerCut(rm));
    if (below >= 0) {
      const ent = this.e[below];
      if (cmpCut(upperCut(ent), lowerCut(rm)) > 0) {
        if (cmpCut(upperCut(ent), upperCut(rm)) > 0) {
          const s = upperCut(rm).s;
          this.putAt(upperCut(rm), R(rm.hi, asLower(s), ent.hi, ent.hiT), ent.value);
        }
        const s = lowerCut(rm).s;
        const truncated = R(ent.lo, ent.loT, rm.lo, asUpper(s));
        const i = this.e.indexOf(ent);
        this.e[i] = { ...truncated, value: ent.value };
      }
    }
    const above = this.lower(upperCut(rm));
    if (above >= 0) {
      const ent = this.e[above];
      if (cmpCut(upperCut(ent), upperCut(rm)) > 0) {
        const s = upperCut(rm).s;
        this.putAt(upperCut(rm), R(rm.hi, asLower(s), ent.hi, ent.hiT), ent.value);
      }
    }
    this.e = this.e.filter(
      (x) => !(cmpCut(lowerCut(x), lowerCut(rm)) >= 0 && cmpCut(lowerCut(x), upperCut(rm)) < 0)
    );
  }

  snapshot(): string {
    const s = this.e
      .filter((x) => !isEmpty(x))
      .map((x) => fmt(x) + "=" + x.value)
      .join(" | ");
    return s === "" ? "(empty)" : s;
  }
}
