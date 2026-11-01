export enum BoundType {
  OPEN = "OPEN",
  CLOSED = "CLOSED",
}

/**
 * Runtime check for a usable `BoundType`.
 *
 * WHY THIS EXISTS. Every consumer of a bound type asks it as
 * `x === BoundType.OPEN ? … : …`, which means any value that is not exactly
 * `OPEN` — a typo (`"OPENN"`), lowercase (`"open"`), `undefined`, `null`, a
 * string off the wire — is silently read as `CLOSED`. `CLOSED` is the
 * PERMISSIVE member: it includes the endpoint. So an unvalidated bound does not
 * fail safe, it fails OPEN, by exactly one endpoint, and `toString()` renders
 * `[a..b]` so the log agrees with the wrong behaviour.
 *
 * A TypeScript enum is a compile-time-only guarantee: the emitted type is a
 * string union that vanishes at runtime, so nothing checks a value that arrives
 * from JSON, from a cast, or from a JS caller. This is that check.
 *
 * `Range`'s constructor calls it on both sides, which makes construction the
 * single choke point: a `Range` that exists has a valid bound type, so every
 * `=== OPEN` test downstream can stay as it is.
 */
export function isBoundType(value: unknown): value is BoundType {
  return value === BoundType.OPEN || value === BoundType.CLOSED;
}

/**
 * Assert a bound type or throw, naming WHICH side was bad so the failing call
 * site is findable.
 */
export function assertBoundType(value: unknown, which: string): asserts value is BoundType {
  if (!isBoundType(value)) {
    throw new TypeError(
      `BoundType: ${which} must be BoundType.OPEN or BoundType.CLOSED, got ` +
        `${typeof value === "string" ? JSON.stringify(value) : String(value)}. ` +
        `A value that is not exactly OPEN is otherwise read as CLOSED, which ` +
        `silently INCLUDES the endpoint — the unsafe direction for a bound that ` +
        `came from unvalidated input.`
    );
  }
}

// The enum object is a shared module-level singleton. Unfrozen, any module in
// the process could write `BoundType.OPEN = "CLOSED"` and invert bound semantics
// for every range in the app. Freezing makes that a silent no-op in sloppy mode
// and a TypeError in strict mode (all ESM, and all TS-emitted output here).
Object.freeze(BoundType);
