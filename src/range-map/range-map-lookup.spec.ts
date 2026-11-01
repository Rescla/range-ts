import { BoundType } from "../core/bound-type";
import { Comparable } from "../core/comparable";
import { BigIntPoint, bigintScalar, comparableScalar } from "../core/scalars";
import { NumberRange } from "../number-range/number-range";
import { Range, defineRange } from "../range/range";
import { RangeMap } from "./range-map";

const R = defineRange(bigintScalar);
const b = (n: number) => BigInt(n);

/**
 * Key lookup on RangeMap.
 *
 * `get`/`getEntry` were a linear `find` over the insertion-order array. They
 * are now a binary search over a lazily built, write-invalidated sorted view.
 * Two things have to be pinned for that to be trustworthy, because both are
 * places where a binary search is quietly wrong rather than obviously wrong:
 *
 * 1. THE CUT TIE. "Last entry whose lower endpoint does not exceed the key" is
 *    only the right answer if the comparison is cut-aware. With a value-only
 *    `<=` it picks the wrong entry and returns null for a key that IS present.
 *    This is not hypothetical — it is the first version of this search, and it
 *    failed the existing open-boundary tests:
 *
 *      entries [1..3]->a, (3..7)->b, [7..10]->a     key = 3
 *      value-only: last lower <= 3 -> (3..7) -> contains(3) false -> null  WRONG
 *      cut-aware:  last lower <= 3 -> [1..3] -> contains(3) true  -> "a"
 *
 * 2. CACHE INVALIDATION. A cached sorted view that survives a write answers
 *    from stale state. Every mutation goes through one writer that drops the
 *    cache; these tests read, write, and read again.
 */
describe("binary-search lookup agrees with a linear scan", () => {
  /** The reference implementation: what `get` did before, by definition. */
  const linearGet = <T>(entries: Array<[Range<any>, T]>, key: any): T | null => {
    for (const [range, value] of entries) {
      if (range.contains(key)) return value;
    }
    return null;
  };

  it("handles the open-boundary-middle case a value-only search gets wrong", () => {
    const m = new RangeMap<string, BigIntPoint>();
    m.put(R.closed(b(1), b(10)), "a");
    m.put(R.open(b(3), b(7)), "b");

    expect(m.get(b(3))).toBe("a");
    expect(m.get(b(4))).toBe("b");
    expect(m.get(b(6))).toBe("b");
    expect(m.get(b(7))).toBe("a");
    expect(m.get(b(1))).toBe("a");
    expect(m.get(b(10))).toBe("a");
    expect(m.get(b(0))).toBeNull();
    expect(m.get(b(11))).toBeNull();
  });

  it("handles two entries sharing a lower value, disjoint across the cut", () => {
    // [3..3] holds only 3; (3..7) excludes it. Both are non-empty and
    // disjoint, so both can be stored, and they tie on lower VALUE. The sort
    // must break that tie CLOSED-first or the search resolves to the wrong side.
    const m = new RangeMap<string, BigIntPoint>();
    m.put(R.closed(b(3), b(3)), "point");
    m.put(R.open(b(3), b(7)), "open");

    expect(m.get(b(3))).toBe("point");
    expect(m.get(b(4))).toBe("open");
    expect(m.get(b(2))).toBeNull();
    expect(m.get(b(7))).toBeNull();
  });

  it("returns null for an unordered key rather than a guess", () => {
    const m = new RangeMap<string>();
    m.put(NumberRange.closed(1, 10), "a");
    expect(m.get(NaN as any)).toBeNull();
    expect(m.get("5" as any)).toBeNull();
  });

  it("agrees with the linear reference over randomised disjoint maps", () => {
    const kinds = ["closed", "closedOpen", "open", "openClosed"] as const;
    let probes = 0;

    for (let trial = 0; trial < 200; trial++) {
      const m = new RangeMap<string>();
      const entries: Array<[Range<any>, string]> = [];
      let cursor = 0;

      for (let i = 0; i < 10; i++) {
        const lo = cursor + 1;
        const hi = lo + 1 + Math.floor(Math.random() * 4);
        cursor = hi + 1;
        const kind = kinds[Math.floor(Math.random() * kinds.length)];
        const range = (NumberRange as any)[kind](lo, hi);
        m.put(range, `v${i}`);
        entries.push([range, `v${i}`]);
      }

      for (let k = -2; k < cursor + 3; k++) {
        probes++;
        expect(m.get(k)).withContext(`trial ${trial} key ${k}`).toBe(linearGet(entries, k));
      }
    }

    expect(probes).toBeGreaterThan(5000);
  });
});

describe("the sorted index is invalidated by every write", () => {
  it("reflects a put that follows a read", () => {
    const m = new RangeMap<string>();
    m.put(NumberRange.closed(1, 5), "a");
    expect(m.get(3)).toBe("a"); // builds the index

    m.put(NumberRange.closed(7, 9), "b");
    expect(m.get(8)).toBe("b"); // must not answer from the stale index
    expect(m.get(3)).toBe("a");
  });

  it("reflects a put that overwrites a previously read key", () => {
    const m = new RangeMap<string>();
    m.put(NumberRange.closed(1, 10), "a");
    expect(m.get(5)).toBe("a");

    m.put(NumberRange.closed(4, 6), "b");
    expect(m.get(5)).toBe("b");
    expect(m.get(2)).toBe("a");
    expect(m.get(8)).toBe("a");
  });

  it("reflects a remove that follows a read", () => {
    const m = new RangeMap<string>();
    m.put(NumberRange.closed(1, 10), "a");
    expect(m.get(5)).toBe("a");

    m.remove(NumberRange.closed(4, 6));
    expect(m.get(5)).toBeNull();
    expect(m.get(2)).toBe("a");
    expect(m.get(8)).toBe("a");
  });

  it("keeps coalescing correct across a read boundary", () => {
    // Ranges must be CONNECTED to coalesce, so these touch at 5 rather than
    // sitting apart — [1..3] and [5..7] would correctly stay two entries.
    const m = new RangeMap<string>();
    m.put(NumberRange.closed(1, 5), "same");
    expect(m.get(2)).toBe("same"); // builds the index
    m.putCoalescing(NumberRange.closed(5, 9), "same");
    expect(m.get(6)).toBe("same");
    expect(m.asMapOfRanges().size).toBe(1);
    expect(String(m.span())).toBe("[1..9]");
  });

  it("keeps non-connected equal values as separate entries across a read boundary", () => {
    const m = new RangeMap<string>();
    m.put(NumberRange.closed(1, 3), "same");
    expect(m.get(2)).toBe("same");
    m.putCoalescing(NumberRange.closed(5, 7), "same");
    expect(m.asMapOfRanges().size).toBe(2);
  });

  it("keeps span() correct across a read boundary", () => {
    const m = new RangeMap<string>();
    m.put(NumberRange.closed(1, 5), "a");
    expect(String(m.span())).toBe("[1..5]");
    m.put(NumberRange.closed(9, 12), "b");
    expect(String(m.span())).toBe("[1..12]");
  });
});

describe("likeRange will not construct from a non-Range constructor", () => {
  it("refuses a plain object reaching put", () => {
    const m = new RangeMap();
    const fake = {
      lowerEndpoint: 1,
      lowerBoundType: "CLOSED",
      upperEndpoint: 5,
      upperBoundType: "CLOSED",
      scalar: comparableScalar,
    };
    expect(() => m.put(fake as any, "z")).toThrow();
  });

  it("refuses a constructor that is not a Range subclass", () => {
    // A third-party subclass's prototype is not frozen by this library, so a
    // swapped constructor is a reachable shape even with frozen instances.
    // likeRange reads proto.constructor; the guard bounds it to Range and its
    // subclasses, so a foreign function is refused rather than invoked with
    // arguments the library computed.
    class ThirdParty extends Range<Comparable> {
      constructor(lo: number, hi: number) {
        super(lo, BoundType.CLOSED, hi, BoundType.CLOSED, comparableScalar);
      }
    }

    const m = new RangeMap<string, any, any>();
    m.put(new ThirdParty(1, 5), "a");
    m.put(new ThirdParty(9, 12), "b");
    const held = (m.getEntry(3) as any)[0];
    expect(held instanceof ThirdParty).toBe(true);

    let invoked = false;
    const Foreign = function (this: any) {
      invoked = true;
    } as any;
    Object.defineProperty(ThirdParty.prototype, "constructor", {
      value: Foreign,
      configurable: true,
    });

    expect(() => m.span()).toThrowError(/not a Range subclass/);
    expect(invoked).toBe(false);
  });

  it("still preserves a legitimate subclass through the guard", () => {
    const m = new RangeMap<string>();
    m.put(NumberRange.closed(1, 5), "a");
    m.put(NumberRange.closed(9, 12), "b");
    expect(m.span() instanceof NumberRange).toBe(true);
  });
});

/**
 * The sort ORDER is pinned directly, not only through lookup results.
 *
 * A comparator bug that returns 0 where it should return -1 is invisible to a
 * `get` test whenever the search still lands on the right entry by luck, and it
 * is invisible to a test that inserts in already-sorted order. Both cases are
 * covered here explicitly, because the tie-break in `compareLower` is the part
 * of the new search that a value-only comparison got wrong.
 */
describe("the lower-bound sort order is pinned, not just the lookup result", () => {
  const order = (m: RangeMap<any, any, any>) =>
    [...m.asMapOfRanges()].map(([k, v]) => `${k}->${v}`).join(", ");

  it("orders by lower value even when inserted high-to-low", () => {
    // Kills the mutant that drops the byValue comparison and falls through to
    // the bound-type tie-break: two entries with the SAME bound type but
    // different values then compare equal, and a stable sort silently keeps
    // insertion order.
    const m = new RangeMap<string, BigIntPoint>();
    m.put(R.closed(b(5), b(9)), "high");
    m.put(R.closed(b(1), b(3)), "low");
    expect(order(m)).toBe("[1..3]->low, [5..9]->high");
  });

  it("orders tied lower values CLOSED-first, both insertion orders", () => {
    const a = new RangeMap<string, BigIntPoint>();
    a.put(R.open(b(3), b(7)), "open");
    a.put(R.closed(b(3), b(3)), "point");
    expect(order(a)).toBe("[3..3]->point, (3..7)->open");

    const z = new RangeMap<string, BigIntPoint>();
    z.put(R.closed(b(3), b(3)), "point");
    z.put(R.open(b(3), b(7)), "open");
    expect(order(z)).toBe("[3..3]->point, (3..7)->open");
  });
});

/**
 * `put` of an empty range is documented as a no-op in the 1.0.0 notes. It had
 * no test, so the guard that makes it true was unverified.
 */
describe("putting an empty range is a no-op", () => {
  it("stores nothing", () => {
    const m = new RangeMap<string>();
    m.put(NumberRange.closed(1, 10), "a");
    m.put(NumberRange.closedOpen(5, 5), "ghost");
    expect(m.asMapOfRanges().size).toBe(1);
    expect(m.get(5)).toBe("a");
  });

  it("does not stretch span() across a phantom endpoint", () => {
    const m = new RangeMap<string>();
    m.put(NumberRange.closedOpen(0, 1), "a");
    m.put(NumberRange.closedOpen(100, 100), "b");
    expect(m.asMapOfRanges().size).toBe(1);
    expect(m.span()!.toString()).toBe("[0..1)");
    expect(m.get(100)).toBeNull();
  });

  it("is a no-op through putCoalescing too", () => {
    const m = new RangeMap<string>();
    m.put(NumberRange.closed(1, 10), "a");
    m.putCoalescing(NumberRange.closedOpen(5, 5), "b");
    expect(m.asMapOfRanges().size).toBe(1);
    expect(m.get(5)).toBe("a");
  });
});
