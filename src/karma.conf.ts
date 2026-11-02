// Karma configuration, TypeScript source.
//
// This file is NOT loaded directly by karma. Karma 6 loads its config with a plain
// `require()`, and TypeScript 7 removed the JS API (`transpileModule`,
// `createProgram`) that `ts-node` and friends hook to — so runtime TS config
// loading is not available on this toolchain. Instead this compiles via
// `tsconfig.karmaconf.json` to `dist/karma-conf/karma.conf.js` and karma is
// pointed at the compiled output.
//
// That is the same shape as the rest of the project: the source stays plain TS,
// the build produces the runnable target.
//
// IMPORTANT — paths are anchored to the repo root, not to this file. The source
// lives in src/ but the file karma actually runs lives in dist/karma-conf/, so
// any `__dirname`-relative path written as if we were still in src/ silently
// points one level wrong (coverage would land in dist/.tmp instead of .tmp).
// Resolve ROOT once and derive everything from it.

import * as fs from "fs";
import * as path from "path";
import type { Config, ConfigOptions } from "karma";

const ROOT = path.resolve(__dirname, "..", "..");

/**
 * Resolve a Chrome/Chromium binary from PATH so `npm test` does not die with
 * "No binary for ChromeHeadless browser on your platform" merely because the
 * invoking shell had no CHROME_BIN exported. If the browser is installed at all
 * it is normally on PATH, so this works however it was installed and assumes
 * nothing about the OS or package manager.
 *
 * An explicitly exported CHROME_BIN always wins and is never overridden, so a
 * machine pinned to a specific build keeps that pin. If nothing is found we
 * leave CHROME_BIN untouched so karma-chrome-launcher's own detection (which
 * knows about macOS .app bundles) still gets its turn.
 */
function resolveChromeBin(): string | undefined {
  const fromEnv = process.env.CHROME_BIN;
  if (fromEnv && fs.existsSync(fromEnv)) return fromEnv;

  const names = ["google-chrome-stable", "google-chrome", "chromium", "chromium-browser"];
  const dirs = (process.env.PATH || "").split(path.delimiter).filter(Boolean);
  for (const dir of dirs) {
    for (const name of names) {
      const candidate = path.join(dir, name);
      try {
        fs.accessSync(candidate, fs.constants.X_OK);
      } catch {
        continue;
      }
      process.env.CHROME_BIN = candidate;
      return candidate;
    }
  }

  return fromEnv;
}

resolveChromeBin();

/**
 * `@types/karma`'s ConfigOptions covers only core keys. The sections consumed by
 * plugins are not declared there, so they are added explicitly. This is preferred
 * over casting the whole config object to `any`, which would also throw away the
 * checking on every core key.
 */
interface PluginConfigSections {
  coverageIstanbulReporter?: {
    dir: string;
    reports: Array<"html" | "lcovonly" | "text-summary" | string>;
    fixWebpackSourcePaths?: boolean;
  };
  junitReporter?: { outputDir: string };
  webpack?: Record<string, unknown>;
}

function karmaConfig(config: Config): void {
  // Assigned to a typed binding before the call: passing a fresh object literal
  // with the plugin keys straight into config.set() trips TypeScript's excess
  // property check against ConfigOptions.
  const options: ConfigOptions & PluginConfigSections = {
    basePath: path.join(ROOT, "dist", "karma"),
    frameworks: ["jasmine"],
    files: ["test.js"],
    plugins: [
      require("karma-jasmine"),
      require("karma-chrome-launcher"),
      require("karma-jasmine-html-reporter"),
      require("karma-coverage-istanbul-reporter"),
      require("karma-junit-reporter"),
      require("karma-webpack"),
      require("karma-sourcemap-loader"),
    ],
    client: {
      clearContext: false, // leave Jasmine Spec Runner output visible in browser
    },
    coverageIstanbulReporter: {
      dir: path.join(ROOT, ".tmp", "coverage"),
      reports: ["html", "lcovonly", "text-summary"],
      fixWebpackSourcePaths: true,
    },
    junitReporter: {
      outputDir: path.join(ROOT, ".tmp", "test-reports"),
    },
    customLaunchers: {
      ChromeHeadlessNoSandbox: {
        base: "ChromeHeadless",
        flags: ["--no-sandbox"],
      },
    },
    reporters: ["progress", "kjhtml"],
    port: 9876,
    colors: true,
    logLevel: config.LOG_INFO,
    autoWatch: true,
    browsers: ["Chrome"],
    singleRun: false,
    restartOnFileChange: true,
    preprocessors: {
      // add webpack as preprocessor
      "test.js": ["webpack", "sourcemap"],
    },
    webpack: {
      mode: "production",
      devtool: "inline-source-map",
      module: {
        rules: [
          {
            test: /\.(js|ts)$/,
            exclude: [/test\.js$/, path.join(ROOT, "node_modules"), /\.spec\.js$/],
            enforce: "post",
            use: {
              loader: "babel-loader",
              options: {
                plugins: ["babel-plugin-istanbul"],
              },
            },
          },
        ],
      },
    },
  };

  config.set(options);
}

// `export =` rather than `export default`: karma does `const fn = require(conf)`
// and calls it. `export default` would emit `exports.default` behind an
// `__esModule` marker and karma would get an object where it expects a function.
export = karmaConfig;
