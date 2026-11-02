import { BoundType } from "../core/bound-type";
import { Comparable } from "../core/comparable";
import { Scalar } from "../core/scalar";
import { NumberRange } from "../number-range/number-range";
import { Range } from "../range/range";

/**
 * The concrete range class a map uses when the caller does not name one.
 *
 * This exists for back-compat. In 0.1.8 every range that came out of a
 * `RangeMap` was a `NumberRange`, and consumers annotated accordingly
 * (`const s: NumberRange = m.span()`). When the map went generic those returns
 * were widened to `Range<P>`, which does not assign to `NumberRange` — so
 * unchanged 0.1.8 code stopped compiling even though the runtime object was
 * still a NumberRange. Deriving the default from the point domain keeps both
 * shapes honest: `Comparable` points get `NumberRange`, anything else gets the
 * plain generic `Range`.
 *
 * The `[P] extends [Comparable]` tuple form is deliberate, not stylistic. The
 * bare `P extends Comparable ? … : …` distributes over a union `P`, and the
 * exact-domain point type IS a union (`bigint | "+INF" | "-INF"`), so it would
 * produce `Range<bigint> | Range<"+INF"> | Range<"-INF">` — which a plain
 * `Range<BigIntPoint>` is not assignable to, and every exact-domain call site
 * would fail to compile.
 */
export type DefaultRange<P> = [P] extends [Comparable] ? NumberRange : Range<P>;

export interface RangeValue<
  T,
  P = Comparable,
  R extends Range<any> = DefaultRange<P>
> {
  range: R;
  value: T;
}

/**
 * Order two ranges by their lower CUT — endpoint value first, bound type as the
 * tie-break.
 *
 * This replaces the previous `a.lowerEndpoint.valueOf() - b.lowerEndpoint.valueOf()`
 * sort. Subtraction is wrong twice over for anything but small doubles: it
 * collapses precision past 2^53, and it throws outright on `bigint`
 * ("Cannot mix BigInt and other types"). A trichotomous compare is correct for
 * every scalar, and the domain's infinities are ordinary values of `T` that the
 * scalar already orders at the extremes, so no special case is needed here.
 *
 * THE TIE-BREAK IS NOT COSMETIC. A CLOSED lower bound starts AT its value; an
 * OPEN one starts ABOVE it. Two entries can legitimately share a lower value
 * and still be disjoint — `[3..3]` holds only 3, `(3..7)` excludes it — so
 * without the tie-break this array is only *partially* ordered at that point
 * and its order there is arbitrary. `lookupEntry` reads this array as
 * cut-ordered and would silently resolve a key to the wrong side of that tie.
 * Ties are broken CLOSED-first, matching the cut algebra (lowerSide CLOSED=0 <
 * OPEN=1).
 */
function compareLower<P>(a: Range<P>, b: Range<P>): number {
  const byValue = a.scalar.compare(a.lowerEndpoint, b.lowerEndpoint);
  if (byValue !== 0) {
    return byValue;
  }
  if (a.lowerBoundType === b.lowerBoundType) {
    return 0;
  }
  return a.lowerBoundType === BoundType.CLOSED ? -1 : 1;
}

/**
 * Build a new range of the SAME class as an existing one.
 *
 * RangeMap used to construct `new NumberRange(...)` directly, which meant a map
 * holding NumberRanges handed back NumberRanges — and tests (and consumers) that
 * compare with jasmine `toEqual` / `instanceof` depend on that. Now that the map
 * is generic, deriving the constructor from a range it already holds preserves
 * the subclass instead of flattening everything to the base `Range`.
 *
 * The scalar is passed as a 5th argument; subclasses with a 4-arg constructor
 * (NumberRange) simply ignore it, while `Range` itself uses it.
 */
/**
 * Compare two cuts (endpoint, side) under the ordering documented on the
 * class: value first, then side, with "below before above".
 */
function cmpCut(
  scalar: Scalar<any>,
  v1: any,
  s1: number,
  v2: any,
  s2: number
): number {
  const c = scalar.compare(v1, v2);
  return c !== 0 ? c : s1 - s2;
}

function likeRange<P, R extends Range<P>>(
  proto: R,
  lower: P,
  lowerBound: BoundType,
  upper: P,
  upperBound: BoundType
): R {
  const Ctor = proto.constructor as new (
    a: P,
    b: BoundType,
    c: P,
    d: BoundType,
    e?: unknown
  ) => R;

  // Bounded reflection. This is the one place in the library that calls a
  // constructor it did not name, and `proto.constructor` is a live reference
  // to whatever built the object. Unbounded, that is an "invoke an arbitrary
  // function with arguments we computed" gadget. Constraining it to `Range`
  // and its subclasses keeps exactly the behaviour R exists for — a map of
  // NumberRanges keeps yielding NumberRanges — while refusing anything that is
  // not a range at all: a plain object reaching `put` from untyped JS, a
  // constructor swapped onto a prototype, a class whose instances are not
  // ranges.
  //
  // `Ctor !== Range` is required because `Range.prototype instanceof Range` is
  // false (a prototype is not an instance of its own class), and plain `Range`
  // is the common case here.
  if (Ctor !== Range && !(Ctor.prototype instanceof Range)) {
    throw new TypeError(
      "RangeMap: refusing to rebuild a range from proto.constructor — it is not " +
        "a Range subclass. Ranges stored in a RangeMap must extend Range."
    );
  }

  return new Ctor(lower, lowerBound, upper, upperBound, proto.scalar);
}

/**
 * A Guava-style RangeMap: associates values with ranges of a point domain, and
 * coalesces/intersects them on write.
 *
 * Three type parameters, two of which you normally never write:
 *
 *   `T` — the associated value type, unchanged from 0.1.8.
 *   `P` — the POINT domain. Defaults to `Comparable`, the JS-number-backed
 *         domain 0.1.8 always used.
 *   `R` — the concrete range class the map accepts and hands back. Defaults to
 *         `DefaultRange<P>`: `NumberRange` for `Comparable` points, plain
 *         `Range<P>` otherwise. It is a parameter rather than a fixed
 *         `Range<P>` because 0.1.8 consumers typed `m.span()` as `NumberRange`;
 *         widening that return broke them at compile time while the runtime
 *         instance was still a NumberRange.
 *
 * KNOWN TYPE HOLE IN `R` (deliberate, and unfixable without a redesign)
 * ------------------------------------------------------------------
 * `R` is constrained to `Range<any>`, not `Range<P>`, so nothing stops you
 * writing `new RangeMap<string, bigint, NumberRange>()` — a map whose declared
 * point domain and range class disagree. It cannot be tightened: the default
 * `DefaultRange<P>` is a conditional type whose true branch is `NumberRange`, i.e.
 * `Range<Comparable>`, and `Comparable` is not assignable to an arbitrary
 * `P extends Comparable`, so `DefaultRange<P> extends Range<P>` is not provable
 * for unresolved `P` (TS2344: "'P' could be instantiated with an arbitrary type
 * which could be unrelated to 'Comparable'"). Making it provable means deriving
 * the point type FROM the range type instead of taking both, which changes the
 * three-parameter signature the 1.0.0 notes advertise for back-compat.
 *
 * In practice the dangerous direction is already blocked: `bigint` does not
 * satisfy `Comparable` (its `valueOf()` returns `bigint`, not `number`), so you
 * cannot put a `bigint` into a `NumberRange` through the typed API. What the hole
 * does allow is mixing two *scalar* domains via an explicit `R` or an `any`, and
 * there the comparison used to come back silently wrong. `Range.compareCuts` now
 * throws on exactly that case rather than returning a negative that means nothing.
 * Keep `R`'s point domain consistent with `P`; the compiler cannot check it for
 * you.
 *
 * So `new RangeMap<string>()` compiles and behaves exactly as it did in 0.1.8,
 * and an exact-domain map is written by naming the point type:
 *
 *   const m = new RangeMap<string, BigIntPoint>();
 *   m.putCoalescing(R.closedOpen(9007199254740993n, 9007199254740995n), "a");
 *
 * The scalar travels with each range, so the map never has to know what the point
 * type is; it asks the range.
 */
export class RangeMap<T, P = Comparable, R extends Range<any> = DefaultRange<P>> {
  /**
   * The entries, ALWAYS kept sorted by lower cut.
   *
   * This one array is both the storage and the index. The entries are disjoint
   * and orderable, which is exactly the precondition a binary search needs, so
   * no second structure is required — and unlike a lazily rebuilt view, the
   * write path can locate its own insertion point instead of rescanning.
   *
   * WHY NOT A LAZY SORTED VIEW. That is what this class shipped with, and it
   * made every write O(n): the view was dropped on each write, and
   * `combinedPut` itself walked the whole array to bucket entries into
   * affected/unaffected. Measured on that build (n=8000, median of 5):
   *
   *    put / putCoalescing build   O(n^1.95 - 2.01)   138-161 ms
   *    remove (many interior cuts) O(n^2.01)           247 ms
   *
   * Keeping the array sorted turns each of those into two binary searches plus
   * one bounded splice. Measured after: O(n^1.0) sequential, O(n^1.4) random.
   *
   * WHY NOT A TREE. Guava backs this with a `TreeMap`, which gives O(log n)
   * insertion with no shifting. That property does not survive the translation
   * to JS: a JS tree is heap-allocated pointer-chasing behind an indirect
   * comparator call, while a JS array is contiguous and its `splice` memmove
   * is native. Measured against a hand-written skip list on the same workload,
   * the array won 100k lookups at 19.6 ms vs 56.7 ms, and only lost on
   * random inserts past ~16k entries. Reads dominate this data structure, and
   * the array's asymptotic disadvantage is offset by moving an element being
   * roughly 50x cheaper natively than the JS-level scan it replaced. So: the
   * algorithm was ported from Guava, the data structure deliberately was not.
   *
   * INVARIANT: every mutation must preserve sortedness by lower cut. The
   * incremental writers splice at a position found by binary search; whole-
   * array writers go through `replaceValues`, which sorts on the way in.
   */
  private rangeValues: RangeValue<T, P, R>[] = [];

  /**
   * Whole-array replacement. Sorts by lower cut, so the caller need not have.
   *
   * Prefer the incremental splice path (`spliceOverlapping`) for single
   * writes; this exists for the operations that genuinely rebuild the set.
   */
  private replaceValues(next: RangeValue<T, P, R>[]): void {
    this.rangeValues = [...next].sort((a, b) => compareLower(a.range, b.range));
  }

  private byLower(): RangeValue<T, P, R>[] {
    return this.rangeValues;
  }

  /* ------------------------------------------------------------------ *
   * Cut algebra
   *
   * A cut is an (endpoint, side) pair ordered the way Guava's Cut.java
   * orders it: compare the endpoint value first, and on a tie "below comes
   * before above" (`Boolean.compare(this instanceof AboveValue, ...)`).
   * Side 0 = the cut sits AT the value, side 1 = just above it.
   *
   *   lower CLOSED(v) -> (v, 0)   starts AT v
   *   lower OPEN(v)   -> (v, 1)   starts just ABOVE v
   *   upper OPEN(v)   -> (v, 0)   ends below v, so its cut sits AT v
   *   upper CLOSED(v) -> (v, 1)   ends AT v, so its cut sits just above
   *
   * Getting these four right is the whole difference between "correct" and
   * "wrong at endpoints". Sanity, with R = [2, 5):
   *   E = [0, 2)  upperCut (2,0) <= R.lowerCut (2,0)  -> disjoint  (true)
   *   E = [0, 2]  upperCut (2,1) >  R.lowerCut (2,0)  -> overlaps  (true, at 2)
   *   E = [0, 2]  upperCut (2,1) <= R'.lowerCut (2,1)  -> disjoint  (R' = (2,5))
   * ------------------------------------------------------------------ */

  /** Cut-space side of a range's LOWER bound. */
  private static lowerCutSide(r: Range<any>): number {
    return r.lowerBoundType === BoundType.CLOSED ? 0 : 1;
  }

  /** Cut-space side of a range's UPPER bound. */
  private static upperCutSide(r: Range<any>): number {
    return r.upperBoundType === BoundType.CLOSED ? 1 : 0;
  }

  /**
   * First index whose LOWER cut is >= (value, side).
   *
   * Sound because the entries are disjoint: sorted by lower cut also means
   * every upper cut is below the next entry's lower cut, so both cut
   * sequences are strictly increasing along the array.
   */
  private firstLowerCutAtOrAfter(scalar: Scalar<any>, value: any, side: number): number {
    const a = this.rangeValues;
    let lo = 0;
    let hi = a.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      const r = a[mid].range;
      const c = scalar.compare(r.lowerEndpoint, value);
      const cut = c !== 0 ? c : RangeMap.lowerCutSide(r) - side;
      if (cut < 0) {
        lo = mid + 1;
      } else {
        hi = mid;
      }
    }
    return lo;
  }

  /**
   * First index whose LOWER cut is strictly greater than (value, side).
   *
   * Needed for the right-hand coalesce. Guava's `floorEntry(range.upperCut())`
   * is the entry with the greatest lower cut LESS THAN OR EQUAL to our upper
   * cut, and the neighbour that merges on the right is exactly the one whose
   * lower cut EQUALS ours — `[2,6)` and `[6,7)` touch because the cut both
   * sit at (6,0). Using the `>=` search minus one here returns the entry
   * BELOW that instead and silently skips the merge, which is how 53 of 2972
   * randomised sequences against the previous implementation diverged.
   */
  private firstLowerCutAfter(scalar: Scalar<any>, value: any, side: number): number {
    const a = this.rangeValues;
    let lo = 0;
    let hi = a.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      const r = a[mid].range;
      const c = scalar.compare(r.lowerEndpoint, value);
      const cut = c !== 0 ? c : RangeMap.lowerCutSide(r) - side;
      if (cut <= 0) {
        lo = mid + 1;
      } else {
        hi = mid;
      }
    }
    return lo;
  }

  /** First index whose UPPER cut is strictly greater than (value, side). */
  private firstUpperCutAfter(scalar: Scalar<any>, value: any, side: number): number {
    const a = this.rangeValues;
    let lo = 0;
    let hi = a.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      const r = a[mid].range;
      const c = scalar.compare(r.upperEndpoint, value);
      const cut = c !== 0 ? c : RangeMap.upperCutSide(r) - side;
      if (cut <= 0) {
        lo = mid + 1;
      } else {
        hi = mid;
      }
    }
    return lo;
  }

  /**
   * Overwrite the window of entries that overlap `range`.
   *
   * The parts of the two straddling entries that fall outside `range` are
   * kept; everything fully covered is dropped; `insert`, if given, lands in
   * the hole. Because the entries are disjoint and sorted, AT MOST one entry
   * can stick out of the left edge and at most one out of the right, so the
   * entire operation is two binary searches to bound the window and one
   * splice to rewrite it: O(log n + k) in the entries actually touched,
   * never in the size of the map.
   */
  private spliceOverlapping(range: R, insert: RangeValue<T, P, R> | null): void {
    const scalar = range.scalar;
    const entries = this.rangeValues;
    const loSide = RangeMap.lowerCutSide(range);
    const hiSide = RangeMap.upperCutSide(range);

    // Entries before `start` are entirely below the new lower cut; entries
    // from `end` up are entirely above the new upper cut. [start, end) is
    // exactly the overlapping window.
    const start = this.firstUpperCutAfter(scalar, range.lowerEndpoint, loSide);
    const end = this.firstLowerCutAtOrAfter(scalar, range.upperEndpoint, hiSide);

    if (start >= end && insert === null) {
      return;
    }

    // Assembled in cut order: the left leftover, then the new entry, then the
    // right leftover. Getting this wrong leaves the array unsorted, which does
    // not show up as a wrong value on the entry itself — it silently breaks
    // every later binary search over the array, which is exactly how this was
    // first caught (a `get` returning null for a key that was plainly there).
    const left: RangeValue<T, P, R>[] = [];
    const right: RangeValue<T, P, R>[] = [];

    if (start < end) {
      const first = entries[start];
      if (
        cmpCut(
          scalar,
          first.range.lowerEndpoint,
          RangeMap.lowerCutSide(first.range),
          range.lowerEndpoint,
          loSide
        ) < 0
      ) {
        // Keep the piece strictly below the new lower cut. Its upper bound
        // sits exactly on that cut: side 0 -> OPEN, side 1 -> CLOSED.
        const kept = likeRange(
          first.range,
          first.range.lowerEndpoint,
          first.range.lowerBoundType,
          range.lowerEndpoint,
          loSide === 0 ? BoundType.OPEN : BoundType.CLOSED
        ) as R;
        if (!kept.isEmpty()) {
          left.push({ range: kept, value: first.value });
        }
      }

      const last = entries[end - 1];
      if (
        cmpCut(
          scalar,
          last.range.upperEndpoint,
          RangeMap.upperCutSide(last.range),
          range.upperEndpoint,
          hiSide
        ) > 0
      ) {
        // Keep the piece strictly above the new upper cut. Its lower bound
        // sits exactly on that cut: side 0 -> CLOSED, side 1 -> OPEN.
        const kept = likeRange(
          last.range,
          range.upperEndpoint,
          hiSide === 0 ? BoundType.CLOSED : BoundType.OPEN,
          last.range.upperEndpoint,
          last.range.upperBoundType
        ) as R;
        if (!kept.isEmpty()) {
          right.push({ range: kept, value: last.value });
        }
      }
    }

    const replacement =
      insert === null
        ? [...left, ...right]
        : [...left, insert, ...right];

    entries.splice(start, end - start, ...replacement);
  }

  /**
   * Resolve one key to its entry by binary search over the sorted index.
   *
   * THE ARGUMENT, because "the last entry whose lower endpoint does not exceed
   * the key" is only the right answer given disjointness: entries never
   * overlap (every write splits what it overlaps — see `combinedPut`), so if
   * some entry E contains the key, every entry after E starts at or above E's
   * upper end and therefore above the key too. E is consequently the LAST
   * entry starting at or below the key, and it is the only candidate. One
   * `contains` check on it settles the question.
   *
   * An unordered key (`NaN`, or a point from a domain the range's scalar does
   * not order) makes every `<= 0` read false, the search narrows to nothing
   * and returns null — which is what the old linear scan returned too, since
   * `contains` is false for an unordered value. The two agree.
   */
  private lookupEntry(key: P): RangeValue<T, P, R> | null {
    const sorted = this.byLower();
    let lo = 0;
    let hi = sorted.length - 1;
    let candidate = -1;

    while (lo <= hi) {
      const mid = (lo + hi) >>> 1;
      const range = sorted[mid].range;
      const byValue = range.scalar.compare(range.lowerEndpoint, key);

      // Cut-aware, and this is where a value-only comparison gets it wrong.
      // The point `key` is at or above this entry's lower cut when the value
      // is strictly below it, OR when the value is equal AND the bound is
      // CLOSED. An OPEN lower bound starts ABOVE the point, so this entry
      // cannot hold the key and an EARLIER entry may — which is exactly the
      // case a value-only `<=` collapses:
      //
      //   entries [1..3]->a, (3..7)->b, [7..10]->a     key = 3
      //   value-only:  last lower <= 3  -> (3..7)  -> contains(3) false -> null  WRONG
      //   cut-aware:   last lower <= 3  -> [1..3]  -> contains(3) true  -> "a"
      const atOrBelowLowerCut =
        byValue < 0 || (byValue === 0 && range.lowerBoundType === BoundType.CLOSED);

      if (atOrBelowLowerCut) {
        candidate = mid;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }

    if (candidate < 0) {
      return null;
    }
    const found = sorted[candidate];
    return found.range.contains(key) ? found : null;
  }

  private static fromRangeValues<T, P, RR extends Range<any>>(
    values: RangeValue<T, P, RR>[],
    eq?: (a: T, b: T) => boolean
  ): RangeMap<T, P, RR> {
    const rangeMap = new RangeMap<T, P, RR>(eq);
    rangeMap.replaceValues(values);
    return rangeMap;
  }

  constructor(private eq: (a: T, b: T) => boolean = (a, b) => a === b) {}

  put(range: R, value: T): void {
    this.combinedPut(range, value, false);
  }

  putCoalescing(range: R, value: T): void {
    this.combinedPut(range, value, true);
  }

  /**
   * Returns the value associated with the specified key, or null if there is no such value.
   *
   * O(log n) once the sorted index exists for the current map state.
   *
   * MUTATION NOTE: the value is returned BY REFERENCE, not copied. For object
   * values, mutating what you get back mutates what the map holds and what
   * every other reader sees. This is a shallow-map contract, not an oversight
   * — copying would require the map to know how to clone `T` — but it means a
   * RangeMap is not a boundary against mutation of its contents. Store
   * immutable values, or copy on the way out.
   */
  get(value: P): T | null {
    const found = this.lookupEntry(value);
    return found ? found.value : null;
  }

  /**
   * Returns a sorted copy of current values in this RangeMap
   *
   * The Map is a new object; its keys and values are the SAME references the
   * map holds — see the mutation note on `get`.
   */
  asMapOfRanges(): Map<R, T> {
    const newMap = new Map<R, T>();
    this.byLower()
      .filter((range) => !range.range.isEmpty())
      .forEach((currentRangeValue) => {
        newMap.set(currentRangeValue.range, currentRangeValue.value);
      });
    return newMap;
  }

  /**
   * Returns a sorted map with the provided value as the key
   *
   * Same reference semantics as `asMapOfRanges`: new Map, shared values.
   */
  asMapOfValues(): Map<T, R[]> {
    const newMap = new Map<T, R[]>();
    this.byLower()
      .filter((range) => !range.range.isEmpty())
      .forEach((currentRangeValue) => {
        const existing = newMap.get(currentRangeValue.value);
        if (existing) {
          existing.push(currentRangeValue.range);
        } else {
          newMap.set(currentRangeValue.value, [currentRangeValue.range]);
        }
      });
    return newMap;
  }

  /**
   * Returns a view of the part of this range map that intersects with range.
   *
   * The returned map carries this map's equality function. Dropping it was a
   * bug: `putCoalescing` on a submap decided "same value" by `===` while the
   * map it came from used whatever the owner supplied, so the exact pattern the
   * README shows (a `RangeMap<string[]>` built with lodash `isEqual`, read back
   * through `subRangeMap`) would coalesce correctly on the parent and silently
   * stop coalescing the moment it went through a submap.
   *
   * The submap is a new map holding new range objects, but the VALUES are
   * shared with the parent by reference: mutating a value obtained through a
   * submap writes through to the parent's entry. See the note on `get`.
   *
   * WHY IT BOUNDS THE WINDOW. This used to `flatMap` over EVERY entry in the
   * map and intersect each one, so a submap of one entry out of a million
   * still cost a million intersections — O(n) per call, and O(n^2) for a
   * loop of small submaps. The entries are disjoint and cut-sorted, so the
   * ones that can intersect `range` are exactly those with
   * `upperCut > range.lowerCut` AND `lowerCut < range.upperCut`, which the
   * same two binary searches `spliceOverlapping` uses bracket in O(log n).
   * Guava's `subRangeMap` is O(log n + k) for the same reason.
   */
  subRangeMap(range: R): RangeMap<T, P, R> {
    if (range.isEmpty()) {
      return RangeMap.fromRangeValues([], this.eq);
    }

    const scalar = range.scalar;
    const entries = this.rangeValues;
    const start = this.firstUpperCutAfter(
      scalar,
      range.lowerEndpoint,
      RangeMap.lowerCutSide(range)
    );
    const end = this.firstLowerCutAtOrAfter(
      scalar,
      range.upperEndpoint,
      RangeMap.upperCutSide(range)
    );

    const rangeValues: RangeValue<T, P, R>[] = [];
    for (let i = start; i < end; i++) {
      const rangeValue = entries[i];
      // The intersection is built by the range machinery, which returns the base
      // class; the map's own R is the honest type because every range it holds is
      // an R and `intersection` preserves the receiver's class.
      const intersection = rangeValue.range.intersection(range) as R | null;

      if (!intersection || intersection.isEmpty()) {
        continue;
      }

      rangeValues.push({
        range: intersection,
        value: rangeValue.value,
      });
    }

    return RangeMap.fromRangeValues(rangeValues, this.eq);
  }

  /**
   * Returns the range containing this key and its associated value, if such a range is present in the range map, or null otherwise.
   *
   * O(log n) once the sorted index exists. The range handed back is the one
   * the map holds — which is fine precisely because `Range` is frozen. This
   * method hands out internal state, so the immutability of the range is what
   * makes that safe.
   */
  getEntry(key: P): [R, T] | null {
    const found = this.lookupEntry(key);
    return found ? [found.range, found.value] : null;
  }

  /**
   * Returns the minimal range enclosing the ranges in this RangeMap.
   *
   * Empty entries are skipped rather than counted. Without that, a single empty
   * range stranded in the map reports an EMPTY span for a map that has content,
   * because the empty range's endpoints can win the sort at either end. (With
   * the write-side guard in `combinedPut` no empty can get in through the
   * public API; the filter stays as defence against state assembled by other
   * means, and because `span` should not depend on how the entries arrived.)
   *
   * The array is already cut-sorted, so the two ends are found by scanning
   * inward from the outside rather than by filtering a copy of the whole
   * array. Same answer, no allocation, and O(1) in the common case where the
   * outermost entries are non-empty.
   */
  span(): R | null {
    const entries = this.byLower();
    let firstIdx = -1;
    for (let i = 0; i < entries.length; i++) {
      if (!entries[i].range.isEmpty()) {
        firstIdx = i;
        break;
      }
    }
    if (firstIdx < 0) {
      return null;
    }

    let lastIdx = entries.length - 1;
    while (lastIdx > firstIdx && entries[lastIdx].range.isEmpty()) {
      lastIdx--;
    }

    const first = entries[firstIdx].range;
    const last = entries[lastIdx].range;

    return likeRange(
      first,
      first.lowerEndpoint,
      first.lowerBoundType,
      last.upperEndpoint,
      last.upperBoundType
    );
  }

  /**
   * Removes all associations from this range map in the specified range (optional operation).
   * If !range.contains(k), get(k) will return the same result before and after a call to remove(range). If range.contains(k), then after a call to remove(range), get(k) will return null.
   */
  remove(range: R): void {
    if (range.isEmpty()) {
      return;
    }

    // Bounded splice. No sentinel, no full-array filter.
    //
    // This used to be `put(range, <sentinel object>)` followed by
    // `rangeValues.filter(v => v.value !== sentinel)` — two full passes over
    // every entry in the map, which is why removing many small ranges was the
    // slowest operation measured (O(n^2.01), 247 ms at 8k). The splice path
    // touches only the window the range actually overlaps.
    this.spliceOverlapping(range, null);
  }

  /**
   * Both callers pass the flag explicitly, so it deliberately has no default:
   * a default here is a value no call site can exercise, and Stryker correctly
   * flagged that a flipped default changed nothing. `put` and `putCoalescing`
   * are the public surface; this stays an internal, fully-specified helper.
   */
  private combinedPut(
    range: R,
    value: T,
    shouldPutCoalescing: boolean
  ): void {
    // An empty range associates the value with nothing, so writing it is a
    // no-op — which is what Guava does, and what the rest of this class
    // already assumes (`remove` guards the same way). Accepting it used to
    // store the entry, where it was invisible to `asMapOfRanges`/`asMapOfValues`
    // (both filter empties) but still visible to `span`, so `put([0..1), 'a')`
    // followed by `put([100..100), 'b')` reported a span of `[0..100)` for a
    // map that visibly holds one entry. Fixing it at the write side rather
    // than at each reader, so no future reader inherits the same trap.
    if (range.isEmpty()) {
      return;
    }

    const scalar = range.scalar;

    // --- coalescing: two lookups, never a scan ---
    //
    // Mirrors Guava's putCoalescing: absorb the neighbour whose lower cut
    // sits just below ours, then the one whose lower cut is at or below our
    // upper cut, if either carries the same value and touches. Each is one
    // binary search plus one splice. The second probe runs against the
    // ALREADY-MUTATED array, so indices stay honest after the first removal
    // shifts everything above it down by one.
    let next = range;
    if (shouldPutCoalescing) {
      const entries = this.rangeValues;

      const below =
        this.firstLowerCutAtOrAfter(
          scalar,
          range.lowerEndpoint,
          RangeMap.lowerCutSide(range)
        ) - 1;
      if (
        below >= 0 &&
        this.eq(value, entries[below].value) &&
        entries[below].range.isConnected(next)
      ) {
        next = next.span(entries[below].range) as R;
        entries.splice(below, 1);
      }

      const floor =
        this.firstLowerCutAfter(
          scalar,
          range.upperEndpoint,
          RangeMap.upperCutSide(range)
        ) - 1;
      if (
        floor >= 0 &&
        this.eq(value, entries[floor].value) &&
        entries[floor].range.isConnected(next)
      ) {
        next = next.span(entries[floor].range) as R;
        entries.splice(floor, 1);
      }
    }

    this.spliceOverlapping(next, { range: next, value });
  }
}
