# ADR-006: A library for any program, knowing none of them

## Decision

The driver is a library, `@falkenslab/moodle-driver`, with no MCP, agent or tool in it: functions take a browser context, the site and ids, and return plain data; options are plain values; errors speak of Moodle (the module, the course structure, logging in again), never of a consumer's tools or settings. It was extracted from moodle-mcp into this sibling repository on 9 October 2026, moodle-mcp's ADR-014 having planned it.

## Motivation

What moodle-mcp did with Moodle is useful without agents: a CLI that imports and exports activities, scripts, migrations, other agent frameworks. "Driver" because it drives Moodle as a person would (as WebDriver drives a browser), and because `moodle-client` names a token-based package on npm; `moodle-browser`, `moodle-session`, `moodle-handler` and `moodle-broker` were considered.

## Consequences

- A consumer explains the driver's errors in its own terms (moodle-mcp names its `login` tool and its settings) and adds what it needs: schemas, progress notifications, pseudonymization.
- Test helpers ship as `@falkenslab/moodle-driver/testing`, so consumers test against the same fake Moodle.
- Until it's published, consumers depend on the sibling folder (`file:../moodle-driver`); its API can still change freely, with consumers updated in the same change.
  - Update (October 2026): it's published on npm, and consumers depend on a version of it; `scripts/check-consumer.mjs` typechecks one against an unreleased `dist/`.
