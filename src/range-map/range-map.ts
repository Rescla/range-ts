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
 * Order two ranges by their lower endpoint.
 *
 * This replaces the previous `a.lowerEndpoint.valueOf() - b.lowerEndpoint.valueOf()`
 * sort. Subtraction is wrong twice over for anything but small doubles: it
 * collapses precision past 2^53, and it throws outright on `bigint`
 * ("Cannot mix BigInt and other types"). A trichotomous compare is correct for
 * every scalar, and the domain's infinities are ordinary values of `T` that the
 * scalar already orders at the extremes, so no special case is needed here.
 */
function compareLower<P>(a: Range<P>, b: Range<P>): number {
  return a.scalar.compare(a.lowerEndpoint, b.lowerEndpoint);
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

  private static fromRangeValues<T, P, RR extends Range<any>>(
    values: RangeValue<T, P, RR>[],
    eq?: (a: T, b: T) => boolean
  ): RangeMap<T, P, RR> {
    const rangeMap = new RangeMap<T, P, RR>(eq);
    rangeMap.rangeValues = values;
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
   */
  get(value: P): T | null {
    const foundRangeValue = this.rangeValues.find((currentRangeValue) =>
      currentRangeValue.range.contains(value)
    );
    if (foundRangeValue) {
      return foundRangeValue.value;
    }
    return null;
  }

  /**
   * Returns a sorted copy of current values in this RangeMap
   */
  asMapOfRanges(): Map<R, T> {
    const newMap = new Map<R, T>();
    this.rangeValues
      .filter((range) => !range.range.isEmpty())
      .sort((a, b) => compareLower(a.range, b.range))
      .forEach((currentRangeValue) => {
        newMap.set(currentRangeValue.range, currentRangeValue.value);
      });
    return newMap;
  }

  /**
   * Returns a sorted map with the provided value as the key
   */
  asMapOfValues(): Map<T, R[]> {
    const newMap = new Map<T, R[]>();
    this.rangeValues
      .filter((range) => !range.range.isEmpty())
      .sort((a, b) => compareLower(a.range, b.range))
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
   */
  getEntry(key: P): [R, T] | null {
    const foundRangeValue = this.rangeValues.find((currentRangeValue) =>
      currentRangeValue.range.contains(key)
    );
    if (foundRangeValue) {
      return [foundRangeValue.range, foundRangeValue.value];
    }
    return null;
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
    const nonEmpty = this.rangeValues.filter(
      (rangeValue) => !rangeValue.range.isEmpty()
    );

    if (nonEmpty.length === 0) {
      return null;
    }

    const sortedRangeValues = [...nonEmpty].sort((a, b) =>
      compareLower(a.range, b.range)
    );

    const first = sortedRangeValues[0].range;
    const last = sortedRangeValues[sortedRangeValues.length - 1].range;

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

    const toDelete = {
      toDeleteId: Math.random(),
    };

    this.put(range, toDelete as unknown as T);

    this.rangeValues = this.rangeValues.filter(
      (rangeValue) => rangeValue.value !== (toDelete as unknown as T)
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

    this.rangeValues = [
      ...unaffectedRangeValues,
      ...affectedRangeValues,
      {
        range: newRange,
        value,
      },
    ];
  }
}
