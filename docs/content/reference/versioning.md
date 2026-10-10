# Versioning

The driver follows [semantic versioning](https://semver.org) with the usual rule for `0.x` versions:

- **Minor** (`0.1.x` → `0.2.0`): new features, and any change that may break an existing program (a function's signature, a returned field, an error class).
- **Patch** (`0.1.0` → `0.1.1`): fixes and internal changes, with no change to the API.
- **Major** (`1.0.0`): when the API is declared stable; from then on breaking changes bump the major version.

Each release is a `vX.Y.Z` tag with release notes on [GitHub](https://github.com/falkenslab/moodle-driver/releases), listing new features, fixes and breaking changes with how to adapt.

## What counts as the API

Everything exported from `@falkenslab/moodle-driver`, `@falkenslab/moodle-driver/internals` and `@falkenslab/moodle-driver/testing`, as described in the API reference: functions, their parameters and options, returned shapes, error classes with their names and codes, `DATA_CATEGORIES`. Error messages may change wording in any release; match errors by class, `name` or `code`, not by message.

## Moodle changes

A new Moodle version can change a page or a service the driver reads. Fixes for that come as patch releases when the API doesn't change.
