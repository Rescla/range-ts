// Karma configuration file, see link for more information
// https://karma-runner.github.io/1.0/config/configuration-file.html

module.exports = function (config) {
  config.set({
    basePath: "../dist/karma",
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
      dir: require("path").join(__dirname, "../.tmp/coverage"),
      reports: ["html", "lcovonly", "text-summary"],
      fixWebpackSourcePaths: true,
    },
    junitReporter: {
      outputDir: require("path").join(__dirname, "../.tmp/test-reports"),
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
            test: /\.js$/,
            exclude: [
              /test\.js$/,
              require("path").resolve(__dirname, "../node_modules"),
              /\.spec\.js$/,
            ],
            enforce: "post",
            use: {
              loader: "istanbul-instrumenter-loader",
              options: { esModules: true },
            },
          },
        ],
      },
    },
  });
};
