import { BoundType, assertBoundType, isBoundType } from "./bound-type";
import { Comparable } from "./comparable";
import { comparableScalar } from "./scalars";
import { NumberRange } from "../number-range/number-range";
import { Range } from "../range/range";

/**
 * Bound type validation.
 *
 * Every consumer of a bound type asks it as `x === BoundType.OPEN ? … : …`, so
 * any value that is not exactly `OPEN` is read as `CLOSED`. `CLOSED` is the
 * PERMISSIVE member — it includes the endpoint — which means an unvalidated
 * bound fails OPEN by one endpoint rather than failing safe. A TypeScript enum
 * is compile-time only: the union erases and nothing checks a value arriving
 * from JSON, from a cast, or from a plain-JS caller.
 *
 * The fix is at construction, which is the single choke point: a Range that
 * exists has two valid bound types, so every `=== OPEN` downstream stays as it
 * is and cannot be reached by a bad value.
 */
describe("BoundType validation", () => {
  it("recognises exactly the two members", () => {
    expect(isBoundType(BoundType.OPEN)).toBe(true);
    expect(isBoundType(BoundType.CLOSED)).toBe(true);
    expect(isBoundType("open")).toBe(false);
    expect(isBoundType("OPENN")).toBe(false);
    expect(isBoundType(undefined)).toBe(false);
    expect(isBoundType(null)).toBe(false);
    expect(isBoundType(0)).toBe(false);
  });

  it("asserts the two members and throws on anything else", () => {
    expect(() => assertBoundType(BoundType.OPEN, "x")).not.toThrow();
    expect(() => assertBoundType(BoundType.CLOSED, "x")).not.toThrow();
    expect(() => assertBoundType("open" as any, "lowerBoundType")).toThrowError(
      /lowerBoundType must be BoundType\.OPEN or BoundType\.CLOSED/
    );
  });

  it("names the offending side so the failing call site is findable", () => {
    expect(() => assertBoundType(undefined as any, "upperBoundType")).toThrowError(
      /upperBoundType/
    );
  });

  it("renders the offending value quoted when it is a string, bare when it is not", () => {
    // Both branches of the typeof conditional matter: a quoted "open" reads as
    // a bad string, a bare `undefined` reads as a missing argument. Collapsing
    // either one makes the message less useful at the exact moment someone is
    // reading it under pressure.
    expect(() => assertBoundType("open" as any, "lowerBoundType")).toThrowError(/got "open"\./);
    expect(() => assertBoundType(undefined as any, "upperBoundType")).toThrowError(/got undefined\./);
    expect(() => assertBoundType(7 as any, "lowerBoundType")).toThrowError(/got 7\./);
    expect(() => assertBoundType(null as any, "lowerBoundType")).toThrowError(/got null\./);
    // An object is the case where the two branches genuinely differ:
    // String({}) is "[object Object]" while JSON.stringify({}) is "{}". Without
    // this the "always JSON.stringify" mutant survives, because undefined, null
    // and numbers render the same either way.
    expect(() => assertBoundType({} as any, "lowerBoundType")).toThrowError(
      /got \[object Object\]\./
    );
  });

  it("carries the whole message verbatim, so no fragment can be blanked silently", () => {
    // Same convention as the inverted-range specs: assert the full string, not
    // a fragment. A mutant that blanks one clause of an error message survives
    // every fragment test and degrades the diagnostic without failing anything.
    const full =
      'BoundType: lowerBoundType must be BoundType.OPEN or BoundType.CLOSED, got "open". ' +
      "A value that is not exactly OPEN is otherwise read as CLOSED, which " +
      "silently INCLUDES the endpoint — the unsafe direction for a bound that " +
      "came from unvalidated input.";

    let thrown: unknown = null;
    try {
      assertBoundType("open" as any, "lowerBoundType");
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(TypeError);
    expect((thrown as Error).message).toBe(full);
  });

  it("rejects a bad bound type at Range construction, both sides", () => {
    expect(
      () => new Range(1, "OPENN" as any, 5, BoundType.CLOSED, comparableScalar)
    ).toThrowError(/lowerBoundType/);
    expect(
      () => new Range(1, BoundType.CLOSED, 5, "" as any, comparableScalar)
    ).toThrowError(/upperBoundType/);
    expect(() => NumberRange.closed(1, 2 as any)).not.toThrow();
  });

  it("does NOT let an invalid lower bound silently include the endpoint", () => {
    // This is the fail-open behaviour the validation exists to remove. Before
    // it, `new Range(1, "OPENN", 5, CLOSED, …)` constructed and
    // `contains(1)` was TRUE, with toString() rendering `[1..5]` so the log
    // agreed with the wrong answer.
    let constructed: Range<Comparable> | null = null;
    try {
      constructed = new Range(1, "OPENN" as any, 5, BoundType.CLOSED, comparableScalar);
    } catch {
      constructed = null;
    }
    expect(constructed).toBeNull();
  });

  it("rejects a bad bound type through every factory entry point", () => {
    expect(() => NumberRange.downTo(1, "CLOSE" as any)).toThrowError(/BoundType/);
    expect(() => NumberRange.upTo(1, undefined as any)).toThrowError(/BoundType/);
  });
});

describe("the BoundType enum object is frozen", () => {
  it("cannot be rewritten to invert bound semantics app-wide", () => {
    expect(Object.isFrozen(BoundType)).toBe(true);

    const originalOpen = BoundType.OPEN;
    try {
      (BoundType as any).OPEN = "CLOSED";
    } catch {
      /* strict throws, sloppy drops. Both fine. */
    }
    expect(BoundType.OPEN).toBe(originalOpen);
    expect(NumberRange.open(1, 5).contains(1)).toBe(false);
  });
});
