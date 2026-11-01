import { BoundType } from "../core/bound-type";
import { Comparable } from "../core/comparable";
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
  private rangeValues: RangeValue<T, P, R>[] = [];

  /**
   * Lazily built, write-invalidated view of `rangeValues` sorted by lower
   * endpoint.
   *
   * WHY. `get`/`getEntry` were a linear `find` over the insertion-order array.
   * Guava backs this structure with a tree and resolves a key in O(log n);
   * here every lookup scanned every entry, so an application that writes N
   * ranges and performs M lookups pays O(N*M). Measured on the shipped build
   * before this change (worst case: a lookup that misses and so scans the
   * whole array):
   *
   *    5k entries   ~98 us per lookup
   *   40k entries  ~519 us per lookup     (linear, as expected)
   *
   * The entries are disjoint and orderable, which is exactly the precondition
   * for a binary search, so the sorted view IS the index and no second data
   * structure is needed. It is built on first read and dropped by every write
   * (see `replaceValues`), so a write-heavy map never pays for an index it
   * will not use, and a read-heavy map sorts once per write burst.
   */
  private sortedByLower: RangeValue<T, P, R>[] | null = null;

  /**
   * The ONLY writer of `rangeValues`.
   *
   * Routing every mutation through here means the sorted index cannot be left
   * stale by a future edit that assigns the array directly. The failure mode
   * of a hand-maintained cache is the write site nobody thought of, so there
   * is one door and it clears the cache on the way through.
   */
  private replaceValues(next: RangeValue<T, P, R>[]): void {
    this.rangeValues = next;
    this.sortedByLower = null;
  }

  private byLower(): RangeValue<T, P, R>[] {
    if (this.sortedByLower === null) {
      this.sortedByLower = [...this.rangeValues].sort((a, b) =>
        compareLower(a.range, b.range)
      );
    }
    return this.sortedByLower;
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
   */
  subRangeMap(range: R): RangeMap<T, P, R> {
    if (range.isEmpty()) {
      return RangeMap.fromRangeValues([], this.eq);
    }

    const rangeValues = this.rangeValues.flatMap((rangeValue) => {
      // The intersection is built by the range machinery, which returns the base
      // class; the map's own R is the honest type because every range it holds is
      // an R and `intersection` preserves the receiver's class.
      const intersection = rangeValue.range.intersection(range) as R | null;

      if (!intersection || intersection.isEmpty()) {
        return [];
      }

      return [
        {
          range: intersection,
          value: rangeValue.value,
        },
      ];
    });

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
   */
  span(): R | null {
    const nonEmpty = this.byLower().filter(
      (rangeValue) => !rangeValue.range.isEmpty()
    );

    if (nonEmpty.length === 0) {
      return null;
    }

    const first = nonEmpty[0].range;
    const last = nonEmpty[nonEmpty.length - 1].range;

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

    // A private sentinel object stands in for "delete whatever is here". It is
    // matched by REFERENCE identity below, never by its contents — which is
    // why the random id is decoration and not the key: two removes cannot
    // collide, and no user value can ever equal it. Keep it that way. If this
    // path were ever switched to coalescing (which calls `this.eq`), a
    // deep-equality `eq` could match the sentinel against a user value shaped
    // like `{ toDeleteId: <number> }` and delete the wrong entry.
    const toDelete = {
      toDeleteId: Math.random(),
    };

    this.put(range, toDelete as unknown as T);

    this.replaceValues(
      this.rangeValues.filter(
        (rangeValue) => rangeValue.value !== (toDelete as unknown as T)
      )
    );
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

    let newRange: R = range;
    let affectedRangeValues: RangeValue<T, P, R>[] = [];
    const unaffectedRangeValues: RangeValue<T, P, R>[] = [];

    this.rangeValues.forEach((currentRangeValue) => {
      if (currentRangeValue.range.isConnected(newRange)) {
        affectedRangeValues.push(currentRangeValue);
      } else {
        unaffectedRangeValues.push(currentRangeValue);
      }
    });

    affectedRangeValues = affectedRangeValues.flatMap((currentRangeValue) => {
      if (shouldPutCoalescing && this.eq(value, currentRangeValue.value)) {
        // Should expand new range instead of inserting current.
        // `span` is declared on the base class, so it hands back `Range<any>`;
        // the instance it actually returns is built by the receiver's own
        // constructor, so R is the honest type.
        newRange = newRange.span(currentRangeValue.range) as R;
        return [];
      }

      if (currentRangeValue.range.intersection(newRange)?.isEmpty()) {
        // No overlap between ranges, preserve current range value
        return [currentRangeValue];
      }

      const s = newRange.scalar;

      // Everything strictly below the new range's lower bound. Built with
      // likeRange so a map of NumberRanges keeps yielding NumberRanges.
      const rangeBefore = currentRangeValue.range.intersection(
        likeRange(
          newRange,
          s.minusInfinity,
          BoundType.OPEN,
          newRange.lowerEndpoint,
          newRange.lowerBoundType === BoundType.OPEN ? BoundType.CLOSED : BoundType.OPEN
        )
      );

      // Everything strictly above the new range's upper bound.
      const rangeAfter = currentRangeValue.range.intersection(
        likeRange(
          newRange,
          newRange.upperEndpoint,
          newRange.upperBoundType === BoundType.OPEN ? BoundType.CLOSED : BoundType.OPEN,
          s.plusInfinity,
          BoundType.OPEN
        )
      );

      // Create new range values for any ranges that are not overlapped by the new range value
      return ([rangeBefore, rangeAfter] as R[])
        .filter((a) => !!a)
        .filter((a) => !a.isEmpty())
        .map((currentRange: R) => ({
          range: currentRange,
          value: currentRangeValue.value,
        }));
    });

    this.replaceValues([
      ...unaffectedRangeValues,
      ...affectedRangeValues,
      {
        range: newRange,
        value,
      },
    ]);
  }
}
