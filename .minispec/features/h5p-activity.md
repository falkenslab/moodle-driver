# H5P activity

## Goal

`h5pActivity(context, siteUrl, cmid)`: an H5P activity's content type, attempts and score.

## Context

- 93 H5P pages in students' runs. Solving H5P happens inside iframes: a program drives it on the working tab (ADR-007), not through the driver.
- AJAX: `mod_h5pactivity_get_h5pactivity_access_information`, `mod_h5pactivity_get_attempts`; the content type from the embed's `h5p.json` or the iframe.

## Changes

- `moodle/h5p.ts`: content type, whether attempts are tracked, the person's attempts with their score, max score.

## Acceptance

- In course 3, a seeded H5P activity shows its content type and, after an attempt in the browser, its score.
