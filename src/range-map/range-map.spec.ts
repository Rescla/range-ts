import { BoundType } from "../core/bound-type";
import { Range } from "../range/range";
import { RangeMap } from "./range-map";
import { isEqual } from "lodash-es";

describe("RangeMap", () => {
  describe("put", () => {
    it("should handle non-overlapping ranges and values", () => {
      const rangeMap = new RangeMap<string>();

      rangeMap.put(Range.closedOpen(1, 3), "a");
      rangeMap.put(Range.closedOpen(4, 6), "b");

      const result = Array.from(rangeMap.asMapOfRanges().entries());

      expect(result.length).toBe(2);

      expect(result[0][0].toString()).toBe("[1..3)");
      expect(result[0][1]).toBe("a");

      expect(result[1][0].toString()).toBe("[4..6)");
      expect(result[1][1]).toBe("b");
    });

    it("should handle overlapping ranges and values", () => {
      const rangeMap = new RangeMap<string>();

      rangeMap.put(Range.closedOpen(1, 3), "a");
      rangeMap.put(Range.closedOpen(2, 6), "b");

      const result = Array.from(rangeMap.asMapOfRanges().entries());

      expect(result.length).toBe(2);

      expect(result[0][0].toString()).toBe("[1..2)");
      expect(result[0][1]).toBe("a");

      expect(result[1][0].toString()).toBe("[2..6)");
      expect(result[1][1]).toBe("b");
    });

    it("should handle enclosed ranges", () => {
      const rangeMap = new RangeMap<string>();

      rangeMap.put(Range.closedOpen(1, 10), "a");
      rangeMap.put(Range.closedOpen(3, 6), "b");

      const result = Array.from(rangeMap.asMapOfRanges().entries());

      expect(result.length).toBe(3);

      expect(result[0][0].toString()).toBe("[1..3)");
      expect(result[0][1]).toBe("a");

      expect(result[1][0].toString()).toBe("[3..6)");
      expect(result[1][1]).toBe("b");

      expect(result[2][0].toString()).toBe("[6..10)");
      expect(result[2][1]).toBe("a");
    });

    it("should handle complex behavior", () => {
      const rangeMap = new RangeMap<string>();

      rangeMap.put(Range.upTo(8, BoundType.CLOSED), "a");
      rangeMap.put(Range.closedOpen(3, 6), "b");
      rangeMap.put(Range.closedOpen(8, 12), "c");
      rangeMap.put(Range.atLeast(18), "e");

      expect(rangeMap.get(2)).toBe("a");
      expect(rangeMap.get(3)).toBe("b");
      expect(rangeMap.get(5)).toBe("b");
      expect(rangeMap.get(6)).toBe("a");
      expect(rangeMap.get(8)).toBe("c");
      expect(rangeMap.get(13)).toBe(null);
      expect(rangeMap.get(18)).toBe("e");
    });
  });

  describe("put coalescing", () => {
    describe("with different values", () => {
      it("should handle non-overlapping ranges and values", () => {
        const rangeMap = new RangeMap<string>();

        rangeMap.putCoalescing(Range.closedOpen(1, 3), "a");
        rangeMap.putCoalescing(Range.closedOpen(4, 6), "b");

        const result = Array.from(rangeMap.asMapOfRanges().entries());

        expect(result.length).toBe(2);

        expect(result[0][0].toString()).toBe("[1..3)");
        expect(result[0][1]).toBe("a");

        expect(result[1][0].toString()).toBe("[4..6)");
        expect(result[1][1]).toBe("b");
      });

      it("should handle overlapping ranges and values", () => {
        const rangeMap = new RangeMap<string>();

        rangeMap.putCoalescing(Range.closedOpen(1, 3), "a");
        rangeMap.putCoalescing(Range.closedOpen(2, 6), "b");

        const result = Array.from(rangeMap.asMapOfRanges().entries());

        expect(result.length).toBe(2);
        expect(result[0][0].toString()).toBe("[1..2)");
        expect(result[0][1]).toBe("a");

        expect(result[1][0].toString()).toBe("[2..6)");
        expect(result[1][1]).toBe("b");
      });

      it("should handle enclosed ranges", () => {
        const rangeMap = new RangeMap<string>();

        rangeMap.putCoalescing(Range.closedOpen(1, 10), "a");
        rangeMap.putCoalescing(Range.closedOpen(3, 6), "b");

        const result = Array.from(rangeMap.asMapOfRanges().entries());

        expect(result.length).toBe(3);
        expect(result[0][0].toString()).toBe("[1..3)");
        expect(result[0][1]).toBe("a");

        expect(result[1][0].toString()).toBe("[3..6)");
        expect(result[1][1]).toBe("b");

        expect(result[2][0].toString()).toBe("[6..10)");
        expect(result[2][1]).toBe("a");
      });

      it("should handle enclosing ranges", () => {
        const rangeMap = new RangeMap<string>();

        rangeMap.putCoalescing(Range.closedOpen(3, 6), "b");
        rangeMap.putCoalescing(Range.closedOpen(1, 10), "a");

        const result = Array.from(rangeMap.asMapOfRanges().entries());

        expect(result.length).toBe(1);
        expect(result[0][0].toString()).toBe("[1..10)");
        expect(result[0][1]).toBe("a");
      });

      it("should handle complex behavior", () => {
        const rangeMap = new RangeMap<string>();

        rangeMap.putCoalescing(Range.upTo(8, BoundType.CLOSED), "a");
        rangeMap.putCoalescing(Range.closedOpen(3, 6), "b");
        rangeMap.putCoalescing(Range.closedOpen(8, 12), "c");
        rangeMap.putCoalescing(Range.atLeast(18), "e");

        expect(rangeMap.get(2)).toBe("a");
        expect(rangeMap.get(3)).toBe("b");
        expect(rangeMap.get(5)).toBe("b");
        expect(rangeMap.get(6)).toBe("a");
        expect(rangeMap.get(8)).toBe("c");
        expect(rangeMap.get(13)).toBe(null);
        expect(rangeMap.get(18)).toBe("e");
      });
    });

    describe("with same values", () => {
      it("should not combine non-connecting ranges", () => {
        const rangeMap = new RangeMap<string>();

        rangeMap.putCoalescing(Range.closedOpen(1, 3), "a");
        rangeMap.putCoalescing(Range.closedOpen(4, 6), "a");

        const result = Array.from(rangeMap.asMapOfRanges().entries());

        expect(result.length).toBe(2);
        expect(result[0][0].toString()).toBe("[1..3)");
        expect(result[0][1]).toBe("a");

        expect(result[1][0].toString()).toBe("[4..6)");
        expect(result[1][1]).toBe("a");
      });

      it("should combine overlapping ranges and values", () => {
        const rangeMap = new RangeMap<string>();

        rangeMap.putCoalescing(Range.closedOpen(1, 3), "a");
        rangeMap.putCoalescing(Range.closedOpen(2, 6), "a");

        const result = Array.from(rangeMap.asMapOfRanges().entries());

        expect(result.length).toBe(1);
        expect(result[0][0].toString()).toBe("[1..6)");
        expect(result[0][1]).toBe("a");
      });

      it("should handle enclosed ranges", () => {
        const rangeMap = new RangeMap<string>();

        rangeMap.putCoalescing(Range.closedOpen(1, 10), "a");
        rangeMap.putCoalescing(Range.closedOpen(3, 6), "a");

        const result = Array.from(rangeMap.asMapOfRanges().entries());

        expect(result.length).toBe(1);
        expect(result[0][0].toString()).toBe("[1..10)");
        expect(result[0][1]).toBe("a");
      });

      it("should filter out empty ranges", () => {
        const rangeMap = new RangeMap<string>();

        rangeMap.putCoalescing(Range.closedOpen(0, 24), "a");
        rangeMap.putCoalescing(Range.closedOpen(0, 6), "b");

        const result = Array.from(rangeMap.asMapOfRanges().entries());

        expect(result.length).toBe(2);
        expect(result[0][0].toString()).toBe("[0..6)");
        expect(result[0][1]).toBe("b");
        expect(result[1][0].toString()).toBe("[6..24)");
        expect(result[1][1]).toBe("a");
      });
    });
  });

  describe("asMapOfValues", () => {
    it("should work", () => {
      const rangeMap = new RangeMap();

      rangeMap.putCoalescing(Range.closedOpen(2, 10), 4);
      rangeMap.putCoalescing(Range.closedOpen(13, 16), 4);
      rangeMap.putCoalescing(Range.closedOpen(3, 12), 3);

      const result = rangeMap.asMapOfValues();

      const result3 = result.get(3) as Range[];
      const result4 = result.get(4) as Range[];

      expect(result4.length).toBe(2);
      expect(result4[0].toString()).toBe("[2..3)");
      expect(result4[1].toString()).toBe("[13..16)");
      expect(result3.length).toBe(1);
      expect(result3[0].toString()).toBe("[3..12)");
    });
  });

  describe("subRangeMap", () => {
    it("should work", () => {
      const rangeMap = new RangeMap();

      rangeMap.putCoalescing(Range.closedOpen(2, 10), 4);
      rangeMap.putCoalescing(Range.closedOpen(13, 16), 4);
      rangeMap.putCoalescing(Range.closedOpen(3, 12), 3);

      const subRangeMap = rangeMap.subRangeMap(Range.closedOpen(2.5, 11));
      const result = subRangeMap.asMapOfValues();

      const result3 = result.get(3) as Range[];
      const result4 = result.get(4) as Range[];

      expect(result4.length).toBe(1);
      expect(result4[0].toString()).toBe("[2.5..3)");
      expect(result3.length).toBe(1);
      expect(result3[0].toString()).toBe("[3..11)");
    });
  });
});

describe("README example", () => {
  // Example input domain object
  interface Attendance {
    name: string;
    days: number[];
  }

  it("should work", () => {
    // The festival spans 4 days, from day 1 until day 4. Or [1..5)
    // IsEqual is used to handle array equality for putCoalescing
    const festivalAttendanceRangeMap = new RangeMap<string[]>(isEqual);
    const attendance: Attendance[] = [
      {
        name: "Bob",
        days: [1, 2, 3, 4],
      },
      {
        name: "Lisa",
        days: [1, 2, 3],
      },
      {
        name: "Eve",
        days: [4, 1],
      },
    ];

    // Init with empty array
    festivalAttendanceRangeMap.putCoalescing(Range.closedOpen(1, 5), []);

    attendance.forEach(({ name, days }) => {
      days.forEach((day) => {
        const dayRange = Range.closedOpen(day, day + 1);
        const subRangeMap = festivalAttendanceRangeMap
          .subRangeMap(dayRange)
          .asMapOfRanges();

        // Iterate over all existing entries for the given day
        // Not really necessary in this example, but this will handle any periods that do not span the entire day as well
        [...subRangeMap.entries()].forEach(([key, value]) => {
          festivalAttendanceRangeMap.putCoalescing(key, [...value, name]);
        });
      });
    });

    const result = festivalAttendanceRangeMap.asMapOfRanges();

    expect([...result.entries()]).toEqual([
      [Range.closedOpen(1, 2), ["Bob", "Lisa", "Eve"]],
      [Range.closedOpen(2, 4), ["Bob", "Lisa"]],
      [Range.closedOpen(4, 5), ["Bob", "Eve"]],
    ]);
  });
});
