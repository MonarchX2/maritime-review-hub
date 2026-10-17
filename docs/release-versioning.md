# Release versioning

`version.json`'s top-level `version` is the only editable source of the app's
semantic release version. Change that value to set a new baseline. The npm
`package.json` and `package-lock.json` version fields are package metadata;
`npm run sync:version` synchronizes them from `version.json` before dependency
installation and validation.

The deployment workflow runs `scripts/resolve-semver-version.js`, which uses
that baseline, the latest release tag, and Conventional Commit messages to
determine the displayed version. `scripts/stamp-release-version.js` then
records the resolved version and a unique `buildVersion` in the deployment
copy of `version.json`, and generates the build identifier in the app entry
point, service worker, manifest icon URL, and HTML asset URLs. Keep these
checked-in markers synchronized with the latest released version; the
deployment workflow replaces them with the identifier for each new build.

`backend/main.js`'s `MINIMUM_SUPPORTED_CLIENT_VERSION` is an independent
compatibility floor, not the application release version. It deliberately
remains a backend policy setting and should only be raised when older clients
must be blocked. Historical release headings in `CHANGELOG.md` are also
records, not version sources.
