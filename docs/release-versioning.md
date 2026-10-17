# Release versioning

The website display version format is fixed as `YY.MM.DD-Patch` (for example,
`26.10.17-8`). Do not replace it with standard `MAJOR.MINOR.PATCH` versioning or
roll month/day values when incrementing the patch. `version.json` is the
single authoritative version source. The website, app-update checks, and
service-worker cache version all read or derive from that value. `package.json`
and `package-lock.json` mirror it as generated package metadata;
`npm run sync:version` keeps those fields aligned.

The deployment workflow runs `scripts/resolve-semver-version.js`. For
Conventional Commits that change the application, it increments only the
patch number and preserves the date, regardless of whether the change is a
feature, fix, performance improvement, or breaking change. The resolver and
release stamping scripts reject display versions outside the fixed format.

The deployment workflow writes the resolver's selected version to
`version.json`; frontend code, the service worker, and cache-busting behavior
derive their values at runtime instead of carrying separate version literals.
`scripts/sync-about-changelog.js` generates the About release history from
`CHANGELOG.md`; historical headings remain records, not version sources.

`backend/main.js`'s `MINIMUM_SUPPORTED_CLIENT_VERSION` is an independent
compatibility floor, not the application release version. It should only be
raised when older clients must be blocked.
