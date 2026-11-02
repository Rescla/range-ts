import { BoundType } from "../core/bound-type";
import {
  BIGINT_MINUS_INFINITY,
  BIGINT_PLUS_INFINITY,
  bigintScalar,
  comparableScalar,
} from "../core/scalars";
import { defineRange } from "./range";

const R = defineRange(bigintScalar);
const b = (n: number) => BigInt(n);

/**
 * Bound-type semantics for the generic `Range<T>`: which end is included, what
 * counts as empty, what `encloses` means at a shared endpoint, and how the
 * factory helpers anchor a half-open range. These are the cases where an
 * off-by-one in OPEN vs CLOSED is silent at runtime and expensive later.
 */
describe("Range<T> bound semantics", () => {
  describe("factory helpers", () => {
    it("downTo anchors the lower end at an explicit bound type and runs to +infinity", () => {
      const closed = R.downTo(b(10), BoundType.CLOSED);
      expect(closed.toString()).toBe("[10..+∞)");
      expect(closed.contains(b(10))).toBe(true);
      expect(closed.contains(b(9))).toBe(false);
      expect(closed.isBoundedBelow()).toBe(true);
      expect(closed.isBoundedAbove()).toBe(false);

      const open = R.downTo(b(10), BoundType.OPEN);
      expect(open.toString()).toBe("(10..+∞)");
      expect(open.contains(b(10))).toBe(false);
      expect(open.contains(b(11))).toBe(true);
    });

    it("upTo anchors the upper end at an explicit bound type and runs from -infinity", () => {
      const closed = R.upTo(b(10), BoundType.CLOSED);
      expect(closed.toString()).toBe("(-∞..10]");
      expect(closed.contains(b(10))).toBe(true);
      expect(closed.contains(b(11))).toBe(false);
      expect(closed.isBoundedBelow()).toBe(false);
      expect(closed.isBoundedAbove()).toBe(true);

      const open = R.upTo(b(10), BoundType.OPEN);
      expect(open.toString()).toBe("(-∞..10)");
      expect(open.contains(b(10))).toBe(false);
      expect(open.contains(b(9))).toBe(true);
    });

    it("names the four closed/open combinations consistently", () => {
      expect(R.closed(b(1), b(2)).toString()).toBe("[1..2]");
      expect(R.closedOpen(b(1), b(2)).toString()).toBe("[1..2)");
      expect(R.open(b(1), b(2)).toString()).toBe("(1..2)");
      expect(R.openClosed(b(1), b(2)).toString()).toBe("(1..2]");
    });
  });

  describe("isEmpty", () => {
    it("is empty for [v..v), (v..v] and (v..v) but not for [v..v]", () => {
      expect(R.closedOpen(b(5), b(5)).isEmpty()).toBe(true);
      expect(R.openClosed(b(5), b(5)).isEmpty()).toBe(true);
      expect(R.open(b(5), b(5)).isEmpty()).toBe(true);
      expect(R.closed(b(5), b(5)).isEmpty()).toBe(false);
      expect(R.closed(b(5), b(5)).contains(b(5))).toBe(true);
    });

    it("is never empty just because the ends are unbounded", () => {
      expect(R.all().isEmpty()).toBe(false);
      expect(R.atLeast(b(0)).isEmpty()).toBe(false);
      expect(R.upTo(b(0), BoundType.OPEN).isEmpty()).toBe(false);
    });
  });

  describe("encloses", () => {
    it("holds when every point of the inner range is in the outer", () => {
      expect(R.closed(b(1), b(10)).encloses(R.closed(b(3), b(7)))).toBe(true);
      expect(R.closed(b(1), b(10)).encloses(R.closed(b(1), b(10)))).toBe(true);
      expect(R.all().encloses(R.closed(b(1), b(2)))).toBe(true);
      expect(R.atLeast(b(0)).encloses(R.closed(b(0), b(9)))).toBe(true);
    });

    it("fails when either end sticks out", () => {
      expect(R.closed(b(1), b(10)).encloses(R.closed(b(0), b(7)))).toBe(false);
      expect(R.closed(b(1), b(10)).encloses(R.closed(b(3), b(11)))).toBe(false);
      expect(R.closed(b(3), b(7)).encloses(R.closed(b(1), b(10)))).toBe(false);
    });

    it("respects an OPEN bound at a shared endpoint", () => {
      // Outer open at 1, inner closed at 1: 1 is in the inner but not the outer.
      expect(R.open(b(1), b(10)).encloses(R.closed(b(1), b(5)))).toBe(false);
      // Outer closed at 1, inner open at 1: nothing sticks out.
      expect(R.closed(b(1), b(10)).encloses(R.open(b(1), b(5)))).toBe(true);
      // Same at the upper end.
      expect(R.closedOpen(b(1), b(10)).encloses(R.closed(b(5), b(10)))).toBe(false);
      expect(R.closed(b(1), b(10)).encloses(R.closedOpen(b(5), b(10)))).toBe(true);
    });

    it("does not enclose a range that merely touches at one open end", () => {
      expect(R.closed(b(1), b(5)).encloses(R.closed(b(5), b(9)))).toBe(false);
      expect(R.closed(b(1), b(5)).encloses(R.openClosed(b(5), b(9)))).toBe(false);
    });
  });

  describe("intersection merges the tighter bound when endpoints are equal", () => {
    it("keeps the OPEN side at a shared lower endpoint", () => {
      const i = R.closed(b(1), b(10)).intersection(R.open(b(1), b(5)));
      expect(i).not.toBeNull();
      // lower: 1 CLOSED vs 1 OPEN -> OPEN; upper: 10 CLOSED vs 5 OPEN -> 5 OPEN.
      expect(i!.toString()).toBe("(1..5)");
    });

    it("keeps the OPEN side at a shared upper endpoint", () => {
      const i = R.closed(b(1), b(10)).intersection(R.closedOpen(b(5), b(10)));
      expect(i).not.toBeNull();
      expect(i!.toString()).toBe("[5..10)");
    });

    it("returns null for genuinely disjoint ranges", () => {
      expect(R.closed(b(1), b(5)).intersection(R.closed(b(6), b(9)))).toBeNull();
    });

    it("returns the empty range for a touching pair that shares no point", () => {
      // [1..5) and [5..9] are connected but share nothing: the merge is [5..5),
      // which is empty. It is not null — null means "not connected", which is a
      // different fact from "connected with no overlap".
      const i = R.closedOpen(b(1), b(5)).intersection(R.closed(b(5), b(9)));
      expect(i).not.toBeNull();
      expect(i!.isEmpty()).toBe(true);
      expect(i!.toString()).toBe("[5..5)");
    });
  });

  describe("span merges the looser bound when endpoints are equal", () => {
    it("keeps the more inclusive end", () => {
      // Upper bound is the HIGHER of the two, keeping that side's own bound type:
      // 5 CLOSED vs 9 OPEN -> 9 OPEN, not 9 CLOSED.
      expect(
        R.closed(b(1), b(5))
          .span(R.open(b(1), b(9)))
          .toString()
      ).toBe("[1..9)");
      expect(
        R.open(b(1), b(5))
          .span(R.closed(b(1), b(9)))
          .toString()
      ).toBe("[1..9]");
      expect(
        R.closedOpen(b(1), b(5))
          .span(R.closed(b(1), b(9)))
          .toString()
      ).toBe("[1..9]");
    });

    it("is the wider of two nested ranges", () => {
      expect(
        R.closed(b(1), b(10))
          .span(R.closed(b(3), b(4)))
          .toString()
      ).toBe("[1..10]");
      expect(
        R.closed(b(3), b(4))
          .span(R.closed(b(1), b(10)))
          .toString()
      ).toBe("[1..10]");
    });

    it("reaches the whole line when either side is unbounded", () => {
      expect(
        R.all()
          .span(R.closed(b(1), b(2)))
          .toString()
      ).toBe("(-∞..+∞)");
      expect(
        R.closed(b(1), b(2))
          .span(R.atLeast(b(9)))
          .toString()
      ).toBe("[1..+∞)");
    });
  });

  describe("isAdjacentTo needs a discrete scalar and matching bound types", () => {
    it("is true for [a..b] and [b+1..c]", () => {
      expect(R.closed(b(1), b(5)).isAdjacentTo(R.closed(b(6), b(9)))).toBe(true);
      expect(R.closed(b(6), b(9)).isAdjacentTo(R.closed(b(1), b(5)))).toBe(true);
    });

    it("is false when the shared end is open on either side", () => {
      // [1..5) and [5..9] overlap at no point but 5 is excluded from the first,
      // so they are not adjacent in the closed sense the method promises.
      expect(R.closedOpen(b(1), b(5)).isAdjacentTo(R.closed(b(5), b(9)))).toBe(false);
      expect(R.closed(b(1), b(5)).isAdjacentTo(R.openClosed(b(5), b(9)))).toBe(false);
    });

    it("is false for overlapping or gapped ranges", () => {
      expect(R.closed(b(1), b(6)).isAdjacentTo(R.closed(b(6), b(9)))).toBe(false);
      expect(R.closed(b(1), b(5)).isAdjacentTo(R.closed(b(8), b(9)))).toBe(false);
    });

    it("is false without a successor on the scalar rather than throwing", () => {
      const noStep = defineRange({
        compare: (x: number, y: number) => (x < y ? -1 : x > y ? 1 : 0),
        minusInfinity: -Infinity,
        plusInfinity: Infinity,
        isPlusInfinity: (x: number) => x === Infinity,
        isMinusInfinity: (x: number) => x === -Infinity,
      });
      expect(noStep.closed(1, 5).isAdjacentTo(noStep.closed(6, 9))).toBe(false);
    });

    it("throws across two scalars that do not order, instead of guessing", () => {
      // `isAdjacentTo` compares with THIS range's scalar against the other
      // range's endpoints. It used to do that with no cross-domain guard at
      // all, so a mismatched pair silently answered `false` where every other
      // range operation (`intersection`, `encloses`, `isConnected`) throws.
      // Same guard, same message, reached through the same helper.
      const N = defineRange(comparableScalar);
      const foreign = N.closed("9" as any, "10" as any);
      expect(() => R.closed(b(1), b(5)).isAdjacentTo(foreign as any)).toThrowError(
        /different Scalar implementations/
      );
    });

    it("does not throw for an unordered operand on the SAME scalar", () => {
      // The guard needs a scalar MISMATCH as well as an unordered result, so a
      // same-domain NaN stays a plain `false` rather than an exception.
      expect(R.closed(b(1), b(5)).isAdjacentTo(R.closed(NaN as any, b(9)))).toBe(false);
    });
  });

  describe("bound-type asymmetry — every guard must actually be checked", () => {
    // Each case below is constructed so that IGNORING one specific bound-type
    // check flips the answer. These are the off-by-one traps that a symmetric
    // test suite passes straight over.
    it("isAdjacentTo refuses when THIS upper end is open (a point is missing)", () => {
      // [1..5) covers {1,2,3,4}; [6..9] starts at 6; 5 is in neither.
      expect(R.closedOpen(b(1), b(5)).isAdjacentTo(R.closed(b(6), b(9)))).toBe(false);
    });

    it("isAdjacentTo refuses when the OTHER lower end is open", () => {
      // [1..5] ends at 5; (6..9] starts at 7; 6 is in neither.
      expect(R.closed(b(1), b(5)).isAdjacentTo(R.openClosed(b(6), b(9)))).toBe(false);
    });

    it("isAdjacentTo refuses when the OTHER upper end is open", () => {
      // other is [1..5): it tops out below 5, while this starts at 6.
      expect(R.closed(b(6), b(9)).isAdjacentTo(R.closedOpen(b(1), b(5)))).toBe(false);
    });

    it("isAdjacentTo refuses when THIS lower end is open", () => {
      expect(R.openClosed(b(6), b(9)).isAdjacentTo(R.closed(b(1), b(5)))).toBe(false);
    });

    it("isAdjacentTo is false where a step would run off an infinity", () => {
      expect(R.atLeast(b(1)).isAdjacentTo(R.atLeast(b(6)))).toBe(false);
      expect(R.atMost(b(5)).isAdjacentTo(R.atMost(b(9)))).toBe(false);
      expect(R.all().isAdjacentTo(R.all())).toBe(false);
    });

    it("intersection takes the OPEN lower bound whichever side supplies it", () => {
      // Equal lower endpoints: the merged bound must be OPEN if EITHER is OPEN,
      // regardless of which range is `this`. The upper end is untouched here
      // (5 CLOSED on the inner range either way).
      expect(
        R.open(b(1), b(10))
          .intersection(R.closed(b(1), b(5)))!
          .toString()
      ).toBe("(1..5]");
      expect(
        R.closed(b(1), b(10))
          .intersection(R.open(b(1), b(5)))!
          .toString()
      ).toBe("(1..5)");
    });

    it("intersection takes the OPEN upper bound whichever side supplies it", () => {
      expect(
        R.closedOpen(b(1), b(10))
          .intersection(R.closed(b(5), b(10)))!
          .toString()
      ).toBe("[5..10)");
      expect(
        R.closed(b(1), b(10))
          .intersection(R.closedOpen(b(5), b(10)))!
          .toString()
      ).toBe("[5..10)");
    });

    it("span merges an equal endpoint toward CLOSED (span is maximal)", () => {
      // Unlike intersection, which tightens, span widens: at an equal endpoint
      // CLOSED wins over OPEN because the span must contain every point either
      // range had.
      expect(
        R.open(b(1), b(5))
          .span(R.closed(b(1), b(9)))
          .toString()
      ).toBe("[1..9]");
      expect(
        R.closed(b(1), b(5))
          .span(R.open(b(1), b(9)))
          .toString()
      ).toBe("[1..9)");
      expect(
        R.closedOpen(b(1), b(5))
          .span(R.closed(b(1), b(9)))
          .toString()
      ).toBe("[1..9]");
      // Both-open at the shared end stays open — there is nothing to include.
      expect(
        R.open(b(1), b(5))
          .span(R.open(b(1), b(9)))
          .toString()
      ).toBe("(1..9)");
    });

    it("encloses still fails when an OPEN inner end lies outside the outer range", () => {
      // The OPEN branch of encloses widens acceptance to "same endpoint", but it
      // must not accept an open end that is genuinely outside.
      expect(R.closed(b(1), b(5)).encloses(R.open(b(0), b(3)))).toBe(false);
      expect(R.closed(b(1), b(5)).encloses(R.open(b(3), b(6)))).toBe(false);
      expect(R.closed(b(1), b(5)).encloses(R.open(b(1), b(5)))).toBe(true);
    });
  });

  describe("endpoint accessors refuse an unbounded end with a stated reason", () => {
    it("lowerEndpointOrThrow throws only when unbounded below", () => {
      expect(R.closed(b(1), b(5)).lowerEndpointOrThrow()).toBe(b(1));
      expect(() => R.atMost(b(5)).lowerEndpointOrThrow()).toThrowError(/unbounded below/);
    });

    it("upperEndpointOrThrow throws only when unbounded above", () => {
      expect(R.closed(b(1), b(5)).upperEndpointOrThrow()).toBe(b(5));
      expect(() => R.atLeast(b(1)).upperEndpointOrThrow()).toThrowError(/unbounded above/);
    });

    it("the sentinels themselves are never handed back as endpoints", () => {
      const all = R.all();
      expect(all.isBoundedBelow()).toBe(false);
      expect(all.isBoundedAbove()).toBe(false);
      expect(() => all.lowerEndpointOrThrow()).toThrowError(/unbounded below/);
      expect(() => all.upperEndpointOrThrow()).toThrowError(/unbounded above/);
      // ...and the infinities are still reachable as values the scalar owns.
      expect(bigintScalar.isMinusInfinity(all.lowerEndpoint)).toBe(true);
      expect(bigintScalar.isPlusInfinity(all.upperEndpoint)).toBe(true);
      expect(BIGINT_MINUS_INFINITY).not.toBe(BIGINT_PLUS_INFINITY);
    });
  });
});

describe("bound-type asymmetry, continued", () => {
  it("intersection of two CLOSED equal ends stays CLOSED", () => {
    // Guards the OPEN-merge in intersection: it must not fire when neither side
    // is open, or every closed intersection would silently lose its endpoint.
    expect(
      R.closed(b(1), b(10))
        .intersection(R.closed(b(5), b(10)))!
        .toString()
    ).toBe("[5..10]");
    expect(
      R.closed(b(1), b(10))
        .intersection(R.closed(b(1), b(5)))!
        .toString()
    ).toBe("[1..5]");
  });

  it("isAdjacentTo is false when a step runs off an infinity into a finite end", () => {
    // step(+infinity) throws; the null it yields must stop the comparison. If the
    // catch swallowed that into `undefined`, a bigint compare of undefined would
    // return 0 and this would wrongly report adjacency.
    expect(R.atLeast(b(1)).isAdjacentTo(R.closed(b(2), b(5)))).toBe(false);
    // The mirror case IS adjacent: (-∞..1] then [2..5] share no point and have
    // no gap, which is exactly what succ(1) === 2 asserts.
    expect(R.closed(b(2), b(5)).isAdjacentTo(R.atMost(b(1)))).toBe(true);
  });

  it("span merges an equal upper endpoint toward CLOSED from either side", () => {
    expect(
      R.open(b(1), b(10))
        .span(R.closed(b(5), b(10)))
        .toString()
    ).toBe("(1..10]");
    expect(
      R.closed(b(1), b(10))
        .span(R.open(b(5), b(10)))
        .toString()
    ).toBe("[1..10]");
    expect(
      R.closed(b(1), b(10))
        .span(R.closed(b(5), b(10)))
        .toString()
    ).toBe("[1..10]");
  });
});
