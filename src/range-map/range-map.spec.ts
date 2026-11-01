import { BoundType } from "../core/bound-type";
import { NumberRange } from "../number-range/number-range";
import { RangeMap } from "./range-map";
import { isEqual } from "lodash-es";

describe("RangeMap", () => {
  describe("put", () => {
    it("should handle non-overlapping ranges and values", () => {
      const rangeMap = new RangeMap<string>();

      rangeMap.put(NumberRange.closedOpen(1, 3), "a");
      rangeMap.put(NumberRange.closedOpen(4, 6), "b");

      const result = Array.from(rangeMap.asMapOfRanges().entries());

      expect(result.length).toBe(2);

      expect(result[0][0].toString()).toBe("[1..3)");
      expect(result[0][1]).toBe("a");

      expect(result[1][0].toString()).toBe("[4..6)");
      expect(result[1][1]).toBe("b");
    });

    it("should handle overlapping ranges and values", () => {
      const rangeMap = new RangeMap<string>();

      rangeMap.put(NumberRange.closedOpen(1, 3), "a");
      rangeMap.put(NumberRange.closedOpen(2, 6), "b");

      const result = Array.from(rangeMap.asMapOfRanges().entries());

      expect(result.length).toBe(2);

      expect(result[0][0].toString()).toBe("[1..2)");
      expect(result[0][1]).toBe("a");

      expect(result[1][0].toString()).toBe("[2..6)");
      expect(result[1][1]).toBe("b");
    });

    it("should handle enclosed ranges", () => {
      const rangeMap = new RangeMap<string>();

      rangeMap.put(NumberRange.closedOpen(1, 10), "a");
      rangeMap.put(NumberRange.closedOpen(3, 6), "b");

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

      rangeMap.put(NumberRange.upTo(8, BoundType.CLOSED), "a");
      rangeMap.put(NumberRange.closedOpen(3, 6), "b");
      rangeMap.put(NumberRange.closedOpen(8, 12), "c");
      rangeMap.put(NumberRange.atLeast(18), "e");

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

        rangeMap.putCoalescing(NumberRange.closedOpen(1, 3), "a");
        rangeMap.putCoalescing(NumberRange.closedOpen(4, 6), "b");

        const result = Array.from(rangeMap.asMapOfRanges().entries());

        expect(result.length).toBe(2);

        expect(result[0][0].toString()).toBe("[1..3)");
        expect(result[0][1]).toBe("a");

        expect(result[1][0].toString()).toBe("[4..6)");
        expect(result[1][1]).toBe("b");
      });

      it("should handle overlapping ranges and values", () => {
        const rangeMap = new RangeMap<string>();

        rangeMap.putCoalescing(NumberRange.closedOpen(1, 3), "a");
        rangeMap.putCoalescing(NumberRange.closedOpen(2, 6), "b");

        const result = Array.from(rangeMap.asMapOfRanges().entries());

        expect(result.length).toBe(2);
        expect(result[0][0].toString()).toBe("[1..2)");
        expect(result[0][1]).toBe("a");

        expect(result[1][0].toString()).toBe("[2..6)");
        expect(result[1][1]).toBe("b");
      });

      it("should handle enclosed ranges", () => {
        const rangeMap = new RangeMap<string>();

        rangeMap.putCoalescing(NumberRange.closedOpen(1, 10), "a");
        rangeMap.putCoalescing(NumberRange.closedOpen(3, 6), "b");

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

        rangeMap.putCoalescing(NumberRange.closedOpen(3, 6), "b");
        rangeMap.putCoalescing(NumberRange.closedOpen(1, 10), "a");

        const result = Array.from(rangeMap.asMapOfRanges().entries());

        expect(result.length).toBe(1);
        expect(result[0][0].toString()).toBe("[1..10)");
        expect(result[0][1]).toBe("a");
      });

      it("should handle complex behavior", () => {
        const rangeMap = new RangeMap<string>();

        rangeMap.putCoalescing(NumberRange.upTo(8, BoundType.CLOSED), "a");
        rangeMap.putCoalescing(NumberRange.closedOpen(3, 6), "b");
        rangeMap.putCoalescing(NumberRange.closedOpen(8, 12), "c");
        rangeMap.putCoalescing(NumberRange.atLeast(18), "e");

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

        rangeMap.putCoalescing(NumberRange.closedOpen(1, 3), "a");
        rangeMap.putCoalescing(NumberRange.closedOpen(4, 6), "a");

        const result = Array.from(rangeMap.asMapOfRanges().entries());

        expect(result.length).toBe(2);
        expect(result[0][0].toString()).toBe("[1..3)");
        expect(result[0][1]).toBe("a");

        expect(result[1][0].toString()).toBe("[4..6)");
        expect(result[1][1]).toBe("a");
      });

      it("should combine overlapping ranges and values", () => {
        const rangeMap = new RangeMap<string>();

        rangeMap.putCoalescing(NumberRange.closedOpen(1, 3), "a");
        rangeMap.putCoalescing(NumberRange.closedOpen(2, 6), "a");

        const result = Array.from(rangeMap.asMapOfRanges().entries());

        expect(result.length).toBe(1);
        expect(result[0][0].toString()).toBe("[1..6)");
        expect(result[0][1]).toBe("a");
      });

      it("should handle enclosed ranges", () => {
        const rangeMap = new RangeMap<string>();

        rangeMap.putCoalescing(NumberRange.closedOpen(1, 10), "a");
        rangeMap.putCoalescing(NumberRange.closedOpen(3, 6), "a");

        const result = Array.from(rangeMap.asMapOfRanges().entries());

        expect(result.length).toBe(1);
        expect(result[0][0].toString()).toBe("[1..10)");
        expect(result[0][1]).toBe("a");
      });

      it("should filter out empty ranges", () => {
        const rangeMap = new RangeMap<string>();

        rangeMap.putCoalescing(NumberRange.closedOpen(0, 24), "a");
        rangeMap.putCoalescing(NumberRange.closedOpen(0, 6), "b");

        const result = Array.from(rangeMap.asMapOfRanges().entries());

        expect(result.length).toBe(2);
        expect(result[0][0].toString()).toBe("[0..6)");
        expect(result[0][1]).toBe("b");
        expect(result[1][0].toString()).toBe("[6..24)");
        expect(result[1][1]).toBe("a");
      });

      it('should replace existing values', () => {
        const rangeMap = new RangeMap<string>();

        rangeMap.putCoalescing(NumberRange.closedOpen(0, 24), "a");
        rangeMap.putCoalescing(NumberRange.closedOpen(0, 24), "b");

        const result = Array.from(rangeMap.asMapOfRanges().entries());

        expect(result.length).toBe(1);

        expect(result[0][0].toString()).toBe("[0..24)");
        expect(result[0][1]).toBe("b");
      })
    });
  });

  describe("asMapOfValues", () => {
    it("should work", () => {
      const rangeMap = new RangeMap();

      rangeMap.putCoalescing(NumberRange.closedOpen(2, 10), 4);
      rangeMap.putCoalescing(NumberRange.closedOpen(13, 16), 4);
      rangeMap.putCoalescing(NumberRange.closedOpen(3, 12), 3);

      const result = rangeMap.asMapOfValues();

      const result3 = result.get(3) as NumberRange[];
      const result4 = result.get(4) as NumberRange[];

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

      rangeMap.putCoalescing(NumberRange.closedOpen(2, 10), 4);
      rangeMap.putCoalescing(NumberRange.closedOpen(13, 16), 4);
      rangeMap.putCoalescing(NumberRange.closedOpen(3, 12), 3);

      const subRangeMap = rangeMap.subRangeMap(NumberRange.closedOpen(2.5, 11));
      const result = subRangeMap.asMapOfValues();

      const result3 = result.get(3) as NumberRange[];
      const result4 = result.get(4) as NumberRange[];

      expect(result4.length).toBe(1);
      expect(result4[0].toString()).toBe("[2.5..3)");
      expect(result3.length).toBe(1);
      expect(result3[0].toString()).toBe("[3..11)");
    });
  });


  describe("remove", () => {
    it('should remove an identical range', () => {
      // Insert item with range, delete with said range, rangeMap should be empty
      const rangeMap = new RangeMap();
      const range = NumberRange.closedOpen(2, 10);

      rangeMap.putCoalescing(range, 4);
      rangeMap.remove(range);

      expect(rangeMap.asMapOfRanges().size).toBe(0);
    })

    it('should remove encosed range', () => {
      // Insert item with range, delete with larger range, rangemap should be empty
      const rangeMap = new RangeMap();
      const itemRange = NumberRange.closedOpen(3, 9);
      const removeRange = NumberRange.closedOpen(2, 10);

      rangeMap.putCoalescing(itemRange, 4);
      rangeMap.remove(removeRange);

      expect(rangeMap.asMapOfRanges().size).toBe(0);
    })

    it('should truncate range when partial overlapped', () => {
      const rangeMap = new RangeMap();
      const itemRange = NumberRange.closedOpen(1, 5);
      const removeRange = NumberRange.closedOpen(3, 10);

      rangeMap.putCoalescing(itemRange, 4);
      rangeMap.remove(removeRange);

      const result = rangeMap.asMapOfRanges()
      expect(result.size).toBe(1);
      expect([...result.entries()][0]).toEqual([NumberRange.closedOpen(1, 3), 4])
    });

    it('should truncate range when contained', () => {
      const rangeMap = new RangeMap();
      const itemRange = NumberRange.closedOpen(1, 10);
      const removeRange = NumberRange.closedOpen(3, 5);

      rangeMap.putCoalescing(itemRange, 4);
      rangeMap.remove(removeRange);

      const result = rangeMap.asMapOfRanges()
      expect(result.size).toBe(2);
      expect([...result.entries()][0]).toEqual([NumberRange.closedOpen(1, 3), 4])
      expect([...result.entries()][1]).toEqual([NumberRange.closedOpen(5, 10), 4])
    });

    it('should not touch connected but not overlapping ranges' , () => {
      const rangeMap = new RangeMap();
      const itemRange = NumberRange.closedOpen(1, 5);
      const removeRange = NumberRange.closedOpen(5, 10);

      rangeMap.putCoalescing(itemRange, 4);
      rangeMap.remove(removeRange);

      const result = rangeMap.asMapOfRanges()
      expect(result.size).toBe(1);
      expect([...result.entries()][0]).toEqual([NumberRange.closedOpen(1, 5), 4])
    })

    it('should not touch non-overlapping ranges', () => {
      // Insert item with range, delete with non-connecting range
      const rangeMap = new RangeMap();
      const itemRange = NumberRange.closedOpen(1, 3);
      const removeRange = NumberRange.closedOpen(5, 10);

      rangeMap.putCoalescing(itemRange, 4);
      rangeMap.remove(removeRange);

      const result = rangeMap.asMapOfRanges()
      expect(result.size).toBe(1);
      expect([...result.entries()][0]).toEqual([NumberRange.closedOpen(1, 3), 4])
    })
  });

  describe('issues', () => {
    it('should correctly preserve positive and negative infinity range endpoints wwith putCoalescing', () => {
      const rangeMap = new RangeMap(isEqual);

      rangeMap.put(NumberRange.all(), []);
      rangeMap.putCoalescing(NumberRange.closedOpen(1834354800000, 1834441200000), 'ab934de2-99be-4d01-8086-9b21082665c9');
      check();
      rangeMap.putCoalescing(NumberRange.closedOpen(1751320800000, 1751493600000), 'e4fe9b11-b33b-4a9d-8f82-893fa543d8ed');
      check();
      rangeMap.putCoalescing(NumberRange.closedOpen(1751320800000, 1752098400000), 'a546e6f6-796c-45c9-9ea1-91610d23ef04');
      check(); // This check failed, lower bound with NEGATIVE_INFINITY was missing.

      function check() {
        const resultEntries = [...rangeMap.asMapOfRanges().entries()];
        expect(resultEntries.some(([range, value]) => range.lowerEndpoint === Number.NEGATIVE_INFINITY)).toBeTrue();
        expect(resultEntries.some(([range, value]) => range.upperEndpoint === Number.POSITIVE_INFINITY)).toBeTrue();
      }
    })

    it('should return the correct span if the same range is added multiple times with put', () => {
      const rangeMap = new RangeMap(isEqual);

      rangeMap.put(NumberRange.closedOpen(1590962400000, 1622498400000), 1);
      // Test passed before fix if only 1 is added, but with 2 or 3 it failed
      rangeMap.put(NumberRange.closedOpen(1590962400000, 1622498400000), 2);
      rangeMap.put(NumberRange.closedOpen(1590962400000, 1622498400000), 3);
      rangeMap.put(NumberRange.closedOpen(1616281200000, 1648076400000), 4);

      expect(rangeMap.span()).toEqual(NumberRange.closedOpen(1590962400000, 1648076400000))
    })
  })
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
    festivalAttendanceRangeMap.putCoalescing(NumberRange.closedOpen(1, 5), []);

    attendance.forEach(({ name, days }) => {
      days.forEach((day) => {
        const dayRange = NumberRange.closedOpen(day, day + 1);
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
      [NumberRange.closedOpen(1, 2), ["Bob", "Lisa", "Eve"]],
      [NumberRange.closedOpen(2, 4), ["Bob", "Lisa"]],
      [NumberRange.closedOpen(4, 5), ["Bob", "Eve"]],
    ]);
  });
});

/**
 * `subRangeMap` must carry the parent's equality function.
 *
 * It used to build the submap with `new RangeMap()` and drop `eq` on the floor,
 * so `putCoalescing` on a submap decided "same value" by `===` while the map it
 * came from used whatever the owner supplied. That makes the README's own shape
 * — a `RangeMap<string[]>` built with lodash `isEqual`, read back through
 * `subRangeMap` — coalesce correctly on the parent and silently stop coalescing
 * the moment the write goes through a submap.
 */
describe("subRangeMap carries the parent's equality function", () => {
  const byKey = (a: { k: string }, b: { k: string }) => a.k === b.k;

  it("coalesces on the submap by the parent's rule, not by object identity", () => {
    const parent = new RangeMap<{ k: string }>(byKey);
    parent.putCoalescing(NumberRange.closedOpen(0, 10), { k: "x" });

    const sub = parent.subRangeMap(NumberRange.closedOpen(2, 8));
    sub.putCoalescing(NumberRange.closedOpen(7, 12), { k: "x" });

    // Connected AND equal by byKey, so the two merge.
    expect(sub.asMapOfRanges().size).toBe(1);
    expect([...sub.asMapOfRanges().keys()][0].toString()).toBe("[2..12)");
  });

  it("control: the same write on a default-equality map splits instead, so the test above is about eq", () => {
    const parent = new RangeMap<{ k: string }>();
    parent.putCoalescing(NumberRange.closedOpen(0, 10), { k: "x" });

    const sub = parent.subRangeMap(NumberRange.closedOpen(2, 8));
    sub.putCoalescing(NumberRange.closedOpen(7, 12), { k: "x" });

    // Same ranges, same-looking values — but `===` says they differ, so nothing
    // coalesces and the existing entry is split around the new one instead.
    expect(sub.asMapOfRanges().size).toBe(2);
    expect([...sub.asMapOfRanges().keys()].map(String)).toEqual(["[2..7)", "[7..12)"]);
  });

  it("carries eq through the empty-submap path too", () => {
    const parent = new RangeMap<{ k: string }>(byKey);
    parent.putCoalescing(NumberRange.closedOpen(0, 10), { k: "x" });

    const sub = parent.subRangeMap(NumberRange.closedOpen(4, 4));
    expect(sub.asMapOfRanges().size).toBe(0);

    sub.putCoalescing(NumberRange.closedOpen(9, 12), { k: "x" });
    sub.putCoalescing(NumberRange.closedOpen(11, 15), { k: "x" });
    expect(sub.asMapOfRanges().size).toBe(1);
  });
});

/**
 * An empty range associates a value with nothing, so writing one is a no-op.
 *
 * Before the write-side guard in `combinedPut`, the entry was stored — and then
 * `asMapOfRanges` and `asMapOfValues` filtered it out while `span` did not. The
 * result was a range that was invisible in every listing of the map but still
 * moved the span, so a map that visibly held one entry could report a span of
 * `[0..100)`. Fixing it at the write side means no reader has to remember to
 * filter, and no future reader inherits the same trap.
 */
describe("an empty range associates nothing", () => {
  it("put leaves a populated map completely untouched", () => {
    const m = new RangeMap<string>();
    m.put(NumberRange.closedOpen(0, 1), "a");
    m.put(NumberRange.closedOpen(100, 100), "ghost");

    expect(m.asMapOfRanges().size).toBe(1);
    expect(m.span()!.toString()).toBe("[0..1)");
    expect(m.get(100)).toBeNull();
    expect(m.getEntry(100)).toBeNull();
  });

  it("does not stretch the span to the empty range's endpoints", () => {
    const m = new RangeMap<string>();
    m.put(NumberRange.closedOpen(0, 1), "a");
    m.put(NumberRange.closedOpen(100, 100), "b");

    // The old answer: [0..100), from an entry no listing of the map shows.
    expect(m.span()!.toString()).toBe("[0..1)");
  });

  it("keeps the span null when the map is otherwise empty", () => {
    const m = new RangeMap<string>();
    m.putCoalescing(NumberRange.closedOpen(5, 5), "ghost");

    expect(m.span()).toBeNull();
    expect(m.asMapOfRanges().size).toBe(0);
    expect(m.asMapOfValues().size).toBe(0);
  });

  it("remove of an empty range is a no-op that strands nothing", () => {
    const m = new RangeMap<string>();
    m.put(NumberRange.closedOpen(0, 10), "a");
    m.remove(NumberRange.closedOpen(5, 5));

    expect(m.asMapOfRanges().size).toBe(1);
    expect(m.get(5)).toBe("a");
    expect(m.span()!.toString()).toBe("[0..10)");
  });

  it("subRangeMap over an empty range yields an empty map, not a whole one", () => {
    const m = new RangeMap<string>();
    m.put(NumberRange.closedOpen(0, 10), "a");

    const sub = m.subRangeMap(NumberRange.closedOpen(4, 4));
    expect(sub.asMapOfRanges().size).toBe(0);
    expect(sub.span()).toBeNull();
  });

  it("subRangeMap drops intersections that came out empty", () => {
    // [0..5) and [5..10) are connected but share no point; the intersection is
    // the empty [5..5) and must not become an entry in the submap.
    const m = new RangeMap<string>();
    m.put(NumberRange.closedOpen(0, 5), "a");

    const sub = m.subRangeMap(NumberRange.closedOpen(5, 10));
    expect(sub.asMapOfRanges().size).toBe(0);
  });
});
