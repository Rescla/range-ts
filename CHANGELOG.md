# Changelog
All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]
Fixes/improvements related to https://github.com/Rescla/range-ts/issues/23

### Added
- Testcases for Dates

### Changed
- Format endpoints in RangeMap.toString() with .toISOString(), if available
  - This would mean Dates are formatted properly

### Fixed
- Use valueOf() when checking endpoints in NumberRange
  - Dates caused issues, since Date(0) !== Date(0), but Date(0).valueOf() === Date(0).valueOf()
