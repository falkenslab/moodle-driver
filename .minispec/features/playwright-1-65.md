# Develop and test against playwright-core 1.65

Issue: [#96](https://github.com/falkenslab/moodle-driver/issues/96)

## Goal

The driver's own lock, tests and Docker image use playwright-core 1.65.0, so moodle-mcp can move to the same version.

## Context

- The peer range is `^1.64.0`, so programs may already get 1.65.0; the dev dependency, the lock and the test image (`scripts/in-docker.mjs`) are still on 1.64.1.
- moodle-mcp follows the driver for this dependency: falkenslab/moodle-mcp#47 waits on this one.

## Changes

- Follow the `upgrade-playwright` skill: read 1.65's release notes for what the driver relies on (contexts with `viewport: null`, downloads, file choosers, persistent profiles).
- Dev dependency and lock to 1.65.0, the test image to `mcr.microsoft.com/playwright:v1.65.0-noble`, and `.minispec/core/stack.md` to match.
- The peer range rises to `^1.65.0` only if the driver now needs it.

## Acceptance

- The gate passes on 1.65.0.
- The sandbox suite passes on Moodle 4.5 and 5.2, in Chromium and Firefox, with no new failure against 1.64.1.
