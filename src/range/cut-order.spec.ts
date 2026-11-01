import { BoundType } from "../core/bound-type";
import {
  BigIntPoint,
  BIGINT_MINUS_INFINITY,
  BIGINT_PLUS_INFINITY,
  bigintScalar,
} from "../core/scalars";
import { NumberRange } from "../number-range/number-range";
import { defineRange } from "./range";

const R = defineRange(bigintScalar);
const b = (n: number) => BigInt(n);

/**
 * Cut-order semantics: how a bound is COMPARED, as opposed to what it contains.
 *
 * A bound is not a point. `[3..` admits 3; `(3..` begins just above it. Two
 * bounds carrying the same value can therefore sit at different positions on the
 * line, and the position depends on BOTH the open/closed type AND whether the
 * bound is a lower or an upper one:
 *
 *   lower CLOSED(v) -> (v, 0)      lower OPEN(v) -> (v, 1)   (begins above v)
 *   upper CLOSED(v) -> (v, 1)      upper OPEN(v) -> (v, 0)   (ends below v)
 *
 * This is Guava's `Cut` ordering (`belowValue` / `aboveValue`). `encloses`,
 * `isConnected`, `intersection` and `span` are all decided on it. The reason
 * they cannot be decided with `contains`, which is how they were written before:
 * `contains` answers a question about the WHOLE range, so for an EMPTY range it
 * comes back false at both ends for reasons that have nothing to do with the bound
 * under test — and a range that plainly contains the empty one reads as not
 * enclosing it. Guava's own javadoc calls that case out by name, and the four
 * examples below are its four examples, transcribed.
 */
describe("cut order — how bounds compare", () => {
  describe("encloses an EMPTY range (Guava's javadoc cases, transcribed)", () => {
    it("encloses [4..4) from [3..6], even though the inner range is empty", () => {
      // Guava: "[3..6] encloses [4..4) (even though the latter is empty)".
      // Cuts: outer (3,0)..(6,1), inner (4,0)..(4,0). 3<=4 and 6>=4.
      expect(R.closed(b(3), b(6)).encloses(R.closedOpen(b(4), b(4)))).toBe(true);
      expect(R.all().encloses(R.open(b(4), b(4)))).toBe(true);
      expect(R.closed(b(3), b(6)).encloses(R.openClosed(b(4), b(4)))).toBe(true);
    });

    it("refuses (3..6] enclosing [3..6] — an open lower cut sits ABOVE a closed one", () => {
      // Guava: "(3..6] does not enclose [3..6]". Cuts: (3,1) vs (3,0); 1 > 0.
      expect(R.openClosed(b(3), b(6)).encloses(R.closed(b(3), b(6)))).toBe(false);
    });

    it("refuses [4..5] enclosing (3..6) — the bounds stick out whatever it contains", () => {
      // Guava: "[4..5] does not enclose (3..6) (even though it contains every
      // value contained by the latter range)".
      expect(R.closed(b(4), b(5)).encloses(R.open(b(3), b(6)))).toBe(false);
    });

    it("refuses [3..6] enclosing (1..1]", () => {
      // Guava: "[3..6] does not enclose (1..1] (even though it contains every
      // value contained by the latter range)".
      expect(R.closed(b(3), b(6)).encloses(R.openClosed(b(1), b(1)))).toBe(false);
    });
  });

  describe("an empty range is still connected to what it touches", () => {
    it("connects [0..2) to the empty [2..2), and the intersection IS that range", () => {
      // null means "not connected". Here they ARE connected and the intersection
      // is the empty range itself — a different fact, and the one a `contains`
      // based isConnected could not reach.
      const empty = R.closedOpen(b(2), b(2));
      expect(R.closedOpen(b(0), b(2)).isConnected(empty)).toBe(true);

      const i = R.closedOpen(b(0), b(2)).intersection(empty);
      expect(i).not.toBeNull();
      expect(i!.isEmpty()).toBe(true);
      expect(i!.toString()).toBe("[2..2)");
    });

    it("does not connect an empty range that is genuinely elsewhere", () => {
      expect(R.closedOpen(b(0), b(2)).isConnected(R.closedOpen(b(5), b(5)))).toBe(false);
      expect(R.closedOpen(b(5), b(5)).intersection(R.closed(b(0), b(2)))).toBeNull();
    });
  });

  describe("enclosure of an empty range tracks the cuts, not the emptiness", () => {
    it("accepts it inside a range whose cuts straddle the empty range's cuts", () => {
      expect(R.closed(b(0), b(10)).encloses(R.closedOpen(b(5), b(5)))).toBe(true);
      expect(R.closed(b(0), b(5)).encloses(R.closedOpen(b(5), b(5)))).toBe(true);
      expect(R.closedOpen(b(0), b(5)).encloses(R.closedOpen(b(5), b(5)))).toBe(true);
      expect(R.atLeast(b(0)).encloses(R.closedOpen(b(0), b(0)))).toBe(true);
    });

    it("refuses it when the outer cut starts above the inner one", () => {
      // (5..10] begins above 5; [5..5) begins AT 5.
      expect(R.open(b(5), b(10)).encloses(R.closedOpen(b(5), b(5)))).toBe(false);
      expect(R.atLeast(b(1)).encloses(R.closedOpen(b(0), b(0)))).toBe(false);
    });

    it("accepts an empty range whose own open lower cut matches an open outer cut", () => {
      // (5..5] cuts: (5,1)..(5,1). (5..10] cuts: (5,1)..(10,1). Equal lower.
      expect(R.open(b(5), b(10)).encloses(R.openClosed(b(5), b(5)))).toBe(true);
    });
  });
});

/**
 * The one thing cut propagation cannot serve honestly: two ranges built over
 * DIFFERENT scalars whose comparison comes back unordered.
 *
 * There the caller is not asking a range question that happens to have a negative
 * answer — it is asking a question no scalar is answering. Propagating the `NaN`
 * makes every `<=` / `>=` / `===` read false, which is how a `bigint` endpoint
 * ends up reported as outside a range whose own endpoint it equals
 * (`comparableScalar.compare(10, 10n)` is `NaN`, so
 * `NumberRange.closed(0, 10).contains(10n)` is `false`). A wrong answer wearing
 * the costume of a negative one is the worst possible output, so that specific
 * case throws.
 *
 * The guard is deliberately narrow: it fires only on the UNORDERED result. Two
 * distinct-but-equivalent scalar objects that DO order the values compare
 * normally, so nothing that previously answered correctly changes behaviour.
 */
describe("ranges over different scalars are not silently comparable", () => {
  // The typed API already REFUSES these calls at compile time: `Range<BigIntPoint>`
  // is not assignable to a `NumberRange` parameter, and `bigint` does not satisfy
  // `Comparable`. That is the primary defence. The runtime guard below is for the
  // callers TypeScript cannot see — plain-JS consumers, `any`-cast call sites,
  // and data crossing a JSON boundary — so the tests have to cast to reach it.
  const asNumberRange = (r: unknown): NumberRange => r as unknown as NumberRange;

  it("throws rather than returning a meaningless negative from intersection", () => {
    const foreignBigint = asNumberRange(R.closed(b(10), b(20)));
    expect(() => NumberRange.closed(0, 10).intersection(foreignBigint)).toThrowError(
      /two different Scalar implementations/
    );
  });

  it("throws from encloses on the same unordered comparison", () => {
    const foreignBigint = asNumberRange(R.closed(b(0), b(5)));
    expect(() => NumberRange.closed(0, 10).encloses(foreignBigint)).toThrowError(
      /different point domains/
    );
  });

  it("throws from isConnected where the endpoints collide across types", () => {
    const foreignBigint = asNumberRange(R.closed(b(10), b(20)));
    // 0 vs 20 orders fine; 10n vs 10 is the unordered pair, and that is the
    // second comparison, so the guard is what stops it.
    expect(() => NumberRange.closed(0, 10).isConnected(foreignBigint)).toThrowError(
      /two different Scalar implementations/
    );
  });

  it("does NOT throw for a same-scalar unordered pair — the NaN contract still stands", () => {
    // NaN endpoints on ONE scalar are a documented non-answer, not a mixing bug.
    // They must keep propagating as false rather than throwing.
    expect(NumberRange.closed(NaN, 5).encloses(NumberRange.closed(1, 2))).toBe(false);
    expect(NumberRange.closed(NaN, 5).intersection(NumberRange.closed(1, 2))).toBeNull();
    expect(NumberRange.closed(NaN, 5).contains(1)).toBe(false);
  });

  it("does NOT throw where the two scalars do order the values", () => {
    // comparableScalar can order 0 against 30n and 10 against 20n, so every
    // comparison is decidable and this gets a real answer. The guard is about
    // unordered results, not about mixing per se.
    expect(NumberRange.closed(0, 5).isConnected(asNumberRange(R.closed(b(20), b(30))))).toBe(false);
  });
});

/**
 * `Scalar.succ` is documented to throw at values with no successor, and
 * `isAdjacentTo` is documented to treat that as "not adjacent" rather than
 * propagating. That promise is only real if the catch yields `null` specifically:
 * `undefined` would pass the `!== null` test, and a bigint compare of `undefined`
 * returns 0, which reads as ADJACENT. These tests pin the difference.
 */
describe("a throwing succ means NOT adjacent", () => {
  const throwingStep = defineRange({
    compare: bigintScalar.compare,
    minusInfinity: BIGINT_MINUS_INFINITY,
    plusInfinity: BIGINT_PLUS_INFINITY,
    isPlusInfinity: bigintScalar.isPlusInfinity,
    isMinusInfinity: bigintScalar.isMinusInfinity,
    succ: (v: BigIntPoint): BigIntPoint => {
      if (v === b(7)) {
        throw new Error("this domain has no successor for 7");
      }
      return bigintScalar.succ!(v);
    },
  });

  it("is false where succ throws, not true-by-undefined-compare", () => {
    // step(7) throws. If the catch produced `undefined`, compare(undefined, 8n)
    // would be 0 and this would report adjacency.
    expect(throwingStep.closed(b(1), b(7)).isAdjacentTo(throwingStep.closed(b(8), b(9)))).toBe(
      false
    );
  });

  it("is still true where the step works, so the false above is the catch and not a broken scalar", () => {
    expect(throwingStep.closed(b(1), b(3)).isAdjacentTo(throwingStep.closed(b(4), b(5)))).toBe(
      true
    );
  });

  it("does not propagate the throw out of isAdjacentTo", () => {
    expect(() =>
      throwingStep.closed(b(1), b(7)).isAdjacentTo(throwingStep.closed(b(8), b(9)))
    ).not.toThrow();
  });

  it("reaches the same answer through the shipped scalar at its own infinities", () => {
    // (-∞..+∞] has a CLOSED upper end sitting on +∞, so the adjacency probe
    // actually calls succ(+∞), which bigintScalar rejects.
    const closedAtPlusInf = R.upTo(BIGINT_PLUS_INFINITY, BoundType.CLOSED);
    expect(closedAtPlusInf.isAdjacentTo(R.closed(b(5), b(9)))).toBe(false);
  });

  it("does not read the failed step as equal to a ZERO lower endpoint", () => {
    // The load-bearing case. Dropping the `nxt !== null` guard makes the code
    // call `bigintScalar.compare(null, 0n)`, and that returns 0 — "equal" —
    // because null is neither infinity and neither of the two ordering
    // comparisons hold. So a failed succ plus a zero endpoint becomes a FALSE
    // POSITIVE adjacency, which is worse than the 5-endpoint case above (where
    // compare(null, 5n) is -1 and the answer happens to stay correct).
    const closedAtPlusInf = R.upTo(BIGINT_PLUS_INFINITY, BoundType.CLOSED);
    expect(closedAtPlusInf.isAdjacentTo(R.closed(b(0), b(5)))).toBe(false);
  });

  it("same trap on the mirrored branch, where the OTHER range's step is the one that fails", () => {
    // (-∞..-∞] tops out at -∞ with a CLOSED bound, so succ(-∞) is what throws,
    // and this.lowerEndpoint is 0 — the same 0-vs-null collision, other side up.
    const closedAtMinusInfUpper = R.upTo(BIGINT_MINUS_INFINITY, BoundType.CLOSED);
    expect(R.closed(b(0), b(5)).isAdjacentTo(closedAtMinusInfUpper)).toBe(false);
  });
});
