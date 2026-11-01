/*
 * jsdom environment setup for the Node-run Jasmine specs.
 *
 * WHY THIS EXISTS
 * ---------------
 * The suite previously ran only in a real browser via Karma, which makes every
 * test cycle depend on a Chrome binary and blocks tooling that wants a cheap,
 * headless, in-process environment (Stryker, CI runners without a browser,
 * `npm test` on a machine with no Chrome installed).
 *
 * The specs in this package are pure range algebra and do not touch the DOM today.
 * Running them under jsdom is therefore NOT about DOM coverage — it is about
 * proving the library behaves the same outside the exact V8-in-Chrome conditions
 * it was developed in, and giving the project a test path with no browser at all.
 *
 * jsdom is installed as a real DOM implementation so that any future DOM-touching
 * code has a plausible environment rather than `window is not defined`.
 */
const { JSDOM } = require("jsdom");

const dom = new JSDOM("<!doctype html><html><body></body></html>", {
  url: "http://localhost/",
  pretendToBeVisual: true,
});
const { window } = dom;

// Globals that must come from jsdom for browser parity, even where Node happens to
// define its own (Node ships a partial `navigator`, which would otherwise mask
// jsdom's and quietly diverge from browser behaviour).
const OVERRIDE = ["navigator"];

// Globals worth exposing if Node does not already provide them.
const IF_MISSING = [
  "window",
  "document",
  "location",
  "history",
  "HTMLElement",
  "Element",
  "Node",
  "Event",
  "CustomEvent",
  "MutationObserver",
  "requestAnimationFrame",
  "cancelAnimationFrame",
];

for (const name of OVERRIDE) {
  if (typeof window[name] !== "undefined") {
    Object.defineProperty(global, name, {
      value: window[name],
      configurable: true,
      writable: true,
    });
  }
}

for (const name of IF_MISSING) {
  if (typeof global[name] === "undefined" && typeof window[name] !== "undefined") {
    global[name] = window[name];
  }
}

// Browser-parity self references.
global.window = window;
global.self = window;

// Make the environment self-describing in the test output, so a run cannot be
// mistaken for the browser run (or for a bare Node run) at a glance.
console.log(
  `[jsdom-setup] environment: jsdom ${require("jsdom/package.json").version} on node ${process.version} ` +
    `(document=${typeof global.document}, navigator.userAgent=${global.navigator ? global.navigator.userAgent : "n/a"})`
);
