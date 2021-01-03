import { BoundType } from "../core/bound-type";
import { Range } from "./range";

describe("Range", () => {
  describe("toString", () => {
    it("should print open ranges", () => {
      expect(Range.open(4, 9).toString()).toBe("(4..9)");
    });

    it("should print closed ranges", () => {
      expect(Range.closed(4, 9).toString()).toBe("[4..9]");
    });

    it("should print closed open ranges", () => {
      expect(Range.closedOpen(4, 9).toString()).toBe("[4..9)");
    });

    it("should print all", () => {
      expect(Range.all().toString()).toBe("(-∞..+∞)");
    });
  });

  describe("contains", () => {
    describe("closed open", () => {
      it("should match on a closed endpoint", () => {
        expect(Range.closedOpen(2, 4).contains(2)).toBeTrue();
      });

      it("should not match on an open endpoint", () => {
        expect(Range.closedOpen(2, 4).contains(4)).toBeFalse();
      });

      it("should match on a number inside", () => {
        expect(Range.closedOpen(2, 4).contains(3)).toBeTrue();
      });

      it("should not match on a number before", () => {
        expect(Range.closedOpen(2, 4).contains(1)).toBeFalse();
      });

      it("should not match on a number after", () => {
        expect(Range.closedOpen(2, 4).contains(5)).toBeFalse();
      });
    });

    describe("closed", () => {
      it("should match on a closed lower endpoint", () => {
        expect(Range.closed(2, 4).contains(2)).toBeTrue();
      });

      it("should match on a closed upper endpoint", () => {
        expect(Range.closed(2, 4).contains(4)).toBeTrue();
      });

      it("should match on a number inside", () => {
        expect(Range.closed(2, 4).contains(3)).toBeTrue();
      });

      it("should not match on a number before", () => {
        expect(Range.closed(2, 4).contains(1)).toBeFalse();
      });

      it("should not match on a number after", () => {
        expect(Range.closed(2, 4).contains(5)).toBeFalse();
      });
    });

    describe("atMost", () => {
      it("should match equal to the bound", () => {
        expect(Range.atMost(5).contains(5)).toBeTrue();
      });

      it("should match below", () => {
        expect(Range.atMost(5).contains(4)).toBeTrue();
      });

      it("should not match above", () => {
        expect(Range.atMost(5).contains(6)).toBeFalse();
      });
    });

    describe("atLeast", () => {
      it("should match equal to the bound", () => {
        expect(Range.atLeast(5).contains(5)).toBeTrue();
      });

      it("should not match below", () => {
        expect(Range.atLeast(5).contains(4)).toBeFalse();
      });

      it("should match above", () => {
        expect(Range.atLeast(5).contains(6)).toBeTrue();
      });
    });
  });

  describe("isConnected", () => {
    it("should be false when there is a gap between two closed open ranges", () => {
      expect(
        Range.closedOpen(2, 4).isConnected(Range.closedOpen(5, 7))
      ).toBeFalse();
      expect(
        Range.closedOpen(5, 7).isConnected(Range.closedOpen(2, 4))
      ).toBeFalse();
    });

    it("should be true when two closed open ranges overlap", () => {
      expect(
        Range.closedOpen(2, 4).isConnected(Range.closedOpen(3, 4))
      ).toBeTrue();
      expect(
        Range.closedOpen(3, 4).isConnected(Range.closedOpen(2, 4))
      ).toBeTrue();
    });

    it("should be true when a closed and open range touch on the same value", () => {
      expect(
        Range.closedOpen(2, 4).isConnected(Range.closedOpen(4, 6))
      ).toBeTrue();
      expect(
        Range.closedOpen(4, 6).isConnected(Range.closedOpen(2, 4))
      ).toBeTrue();
    });

    it("should be false when two open ranges do not touch", () => {
      expect(
        Range.upTo(4, BoundType.OPEN).isConnected(Range.atLeast(6))
      ).toBeFalse();
      expect(
        Range.atLeast(6).isConnected(Range.upTo(4, BoundType.OPEN))
      ).toBeFalse();
    });

    it("should be true when one closedOpen range encloses the other", () => {
      expect(
        Range.closedOpen(2, 10).isConnected(Range.closedOpen(4, 6))
      ).toBeTrue();
      expect(
        Range.closedOpen(4, 6).isConnected(Range.closedOpen(2, 10))
      ).toBeTrue();
    });
  });

  describe("intersecting", () => {
    it("should intersect with closedOpen and atLeast", () => {
      const result = Range.closedOpen(2, 4).intersection(Range.atLeast(3));
      expect(result?.toString()).toBe("[3..4)");
    });

    it("should intersect with closedOpen and atMost", () => {
      const result = Range.closedOpen(2, 4).intersection(Range.atMost(3));
      expect(result?.toString()).toBe("[2..3]");
    });

    it("should be able to handle an empty range", () => {
      const result = Range.closedOpen(2, 4).intersection(
        Range.closedOpen(4, 6)
      );
      expect(result?.toString()).toBe("[4..4)");
    });

    it("should be able to handle a range containing one value", () => {
      const result = Range.closed(2, 4).intersection(Range.closedOpen(4, 6));
      expect(result?.toString()).toBe("[4..4]");
    });
  });

  describe("span", () => {
    it("should work for two non connecting closedOpen ranges", () => {
      const range1 = Range.closedOpen(1, 5);
      const range2 = Range.closedOpen(8, 12);

      const result = range1.span(range2);

      expect(result.toString()).toBe("[1..12)");
    });

    it("should work for two overlapping closedOpen ranges", () => {
      const range1 = Range.closedOpen(1, 10);
      const range2 = Range.closedOpen(7, 12);

      const result = range1.span(range2);

      expect(result.toString()).toBe("[1..12)");
    });

    it("should work for a closedOpen and open range", () => {
      const range1 = Range.closedOpen(1, 5);
      const range2 = Range.atLeast(7);

      const result = range1.span(range2);

      expect(result.toString()).toBe("[1..+∞)");
    });

    it("should work for with two non connecting open ranges", () => {
      const range1 = Range.atMost(4);
      const range2 = Range.atLeast(7);

      const result = range1.span(range2);

      expect(result.toString()).toBe("(-∞..+∞)");
      expect(result.lowerBoundType).toBe(BoundType.OPEN);
      expect(result.lowerEndpoint).toBe(Number.NEGATIVE_INFINITY);
      expect(result.upperBoundType).toBe(BoundType.OPEN);
      expect(result.upperEndpoint).toBe(Number.POSITIVE_INFINITY);
    });

    describe("overlaps", () => {
      it("should be false when there is no overlap", () => {
        // first before second
        expect(
          Range.closedOpen(2, 4).overlaps(Range.closedOpen(6, 8))
        ).toBeFalse();
        expect(
          Range.closedOpen(2, 4).overlaps(Range.closedOpen(4, 8))
        ).toBeFalse();
        expect(Range.closed(2, 4).overlaps(Range.closedOpen(5, 8))).toBeFalse();

        // first after second
        expect(
          Range.closedOpen(10, 20).overlaps(Range.closedOpen(21, 30))
        ).toBeFalse();
        expect(
          Range.closedOpen(10, 20).overlaps(Range.closedOpen(25, 30))
        ).toBeFalse();
        expect(
          Range.closedOpen(10, 20).overlaps(Range.closed(20, 30))
        ).toBeFalse();
      });

      it("should be true when the ranges overlap in any way", () => {
        // first overlaps start of second
        expect(
          Range.closedOpen(10, 20).overlaps(Range.closedOpen(19, 30))
        ).toBeTrue();
        expect(
          Range.closedOpen(10, 20).overlaps(Range.closedOpen(18, 30))
        ).toBeTrue();
        expect(
          Range.closed(10, 20).overlaps(Range.closedOpen(20, 30))
        ).toBeTrue();
        expect(
          Range.closed(10, 20).overlaps(Range.closedOpen(19, 30))
        ).toBeTrue();

        // first totally overlaps second
        expect(
          Range.closedOpen(10, 20).overlaps(Range.closedOpen(10, 20))
        ).toBeTrue();
        expect(
          Range.closedOpen(10, 20).overlaps(Range.closedOpen(11, 19))
        ).toBeTrue();
        expect(
          Range.closed(10, 20).overlaps(Range.closedOpen(10, 20))
        ).toBeTrue();
        expect(
          Range.closed(10, 20).overlaps(Range.closedOpen(11, 20))
        ).toBeTrue();
        expect(
          Range.closed(10, 20).overlaps(Range.closedOpen(10, 19))
        ).toBeTrue();

        // first overlaps end of second
        expect(
          Range.closedOpen(20, 30).overlaps(Range.closedOpen(10, 21))
        ).toBeTrue();
        expect(
          Range.closedOpen(20, 30).overlaps(Range.closedOpen(11, 22))
        ).toBeTrue();
        expect(
          Range.closed(20, 30).overlaps(Range.closedOpen(10, 21))
        ).toBeTrue();
        expect(
          Range.closed(20, 30).overlaps(Range.closedOpen(11, 22))
        ).toBeTrue();
        expect(
          Range.closedOpen(20, 30).overlaps(Range.closed(10, 20))
        ).toBeTrue();
        expect(
          Range.closedOpen(20, 30).overlaps(Range.closed(11, 21))
        ).toBeTrue();
        expect(Range.closed(20, 30).overlaps(Range.closed(10, 20))).toBeTrue();
        expect(Range.closed(20, 30).overlaps(Range.closed(11, 21))).toBeTrue();

        // first inside of second
        expect(
          Range.closedOpen(20, 30).overlaps(Range.closedOpen(20, 29))
        ).toBeTrue();
        expect(
          Range.closedOpen(20, 30).overlaps(Range.closedOpen(20, 30))
        ).toBeTrue();
        expect(
          Range.closedOpen(20, 30).overlaps(Range.closedOpen(20, 31))
        ).toBeTrue();
        expect(
          Range.closedOpen(20, 30).overlaps(Range.closedOpen(19, 31))
        ).toBeTrue();

        expect(
          Range.closed(20, 30).overlaps(Range.closedOpen(20, 30))
        ).toBeTrue();
        expect(
          Range.closed(20, 30).overlaps(Range.closedOpen(19, 30))
        ).toBeTrue();
        expect(
          Range.closed(20, 30).overlaps(Range.closedOpen(20, 31))
        ).toBeTrue();

        expect(Range.closed(20, 30).overlaps(Range.closed(20, 30))).toBeTrue();
        expect(Range.closed(20, 30).overlaps(Range.closed(19, 31))).toBeTrue();
        expect(Range.closed(20, 30).overlaps(Range.closed(19, 30))).toBeTrue();
        expect(Range.closed(20, 30).overlaps(Range.closed(20, 31))).toBeTrue();
      });
    });
  });

  describe("encloses", () => {
    it("a closedOpen should enclose itself", () => {
      const range = Range.closedOpen(1, 20);
      expect(range.encloses(range)).toBeTrue();
    });

    it("should work on two closedOpen ranges", () => {
      const largeRange = Range.closedOpen(3, 10);
      const smallRange = Range.closedOpen(4, 6);

      expect(largeRange.encloses(smallRange)).toBeTrue();
      expect(smallRange.encloses(largeRange)).toBeFalse();
    });
  });
});
