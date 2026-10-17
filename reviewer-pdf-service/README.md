# Apps Script Reviewer PDF delivery

The normal online preview authorizes the request, retrieves the source through
the Apps Script execution identity, and returns it to a browser Web Worker for
watermarking. Preview and download reuse those watermarked bytes. This removes
the queue trigger, backend PDF parsing and verification, and temporary Drive
write/read from the interactive path. Because the browser receives the source,
an authorized user can bypass or remove the watermark; it is leak deterrence,
not a security boundary.

The former Apps Script watermark-and-archive route is disabled. Browser-created
derivatives are downloaded locally and are not archived to Drive. No Cloud Run
processor, paid API, CDN, or remote runtime package download is required.

## Dependency and license

- `pdf-lib` **1.17.1**, pinned exactly.
- MIT License; the full notice is in `vendor/pdf-lib-1.17.1-LICENSE.md`.
- Runtime bundle: `vendor/pdf-lib-1.17.1.min.js` (about 525 KB).
- A matching copy is retained in `backend/PDFLib.js` for historical
  compatibility tests; the Apps Script preview route does not load or invoke it.
- The browser bundle is self-hosted and does not import Node `Buffer`,
  `require`, or a network-loaded library.
- The pinned bundle is included as a content-hashed, lazy-loaded website asset
  and is loaded only when a Reviewer PDF is opened.

The package in this directory is a local build/test dependency only. The
runtime uses the checked-in bundle, not npm or a remote URL.

## Build and local compatibility tests

From the repository root:

```powershell
npm install --prefix reviewer-pdf-service
npm run vendor:reviewer-pdf-lib
npm test --prefix reviewer-pdf-service
```

The test harness loads the same browser UMD bundle and the Web Worker source
in an isolated V8-like JavaScript context without Node `Buffer`,
`require`, `process`, `window`, or `document` globals. It tests portrait and
landscape PDFs, oversized and invalid inputs, watermark verification, and
source-byte integrity.

`get_reviewer_pdf_preview` checks the current session, account approval,
authoritative index membership, source version, and protected Drive ancestry.
It may return a short-lived cache hit only after current authorization and
source-version validation. Otherwise it returns the source bytes and verified
identity to the browser. A dedicated Web Worker lazily loads the pinned
`pdf-lib` asset, watermarks every page without blocking the UI thread, and
passes the prepared bytes to preview and download. The browser validates the
source/output size and PDF signature. The Apps Script endpoint uses HTTPS; TLS
encrypts the response in transit. The browser receives the source bytes, so
client-side encryption with a key available in that browser would not prevent
the authorized user from retrieving the source or changing the watermark.
Watermarking is attribution/leak deterrence, not a security boundary.

The old `get_reviewer_pdf` enqueue route and job-status route are disabled. The
background trigger handler exits and removes stale triggers without
watermarking. `setupReviewerPdfDelivery()` is retained as a shutdown helper that clears
worker setup state and removes old triggers. The normal preview flow does not
archive its browser-generated derivative to Drive.

Each physical page watermark contains only the verified account's full name
and email on two separate lines. Eight stamps use paired left/right placements
alternating with one horizontally centered (non-diagonal) stamp on each
intermediate row; the first and last rows are always paired. The verified
email's capitalization is preserved. The authoritative index is cached only
by its Drive file ID and last-modified timestamp, and checked again for each
protected request.

`auditReviewerPdfDrivePermissions()` produces a read-only report of direct
permissions on indexed Reviewer PDFs and permissions inherited from ancestor
folders. To review a proposed direct-file revocation without making changes,
call `applyReviewedReviewerPdfPermissionRevocations(reviewedPermissions, "", true)`.
Applying reviewed direct PDF permission removals requires a second explicit
call with the confirmation string
`REVOKE THE REVIEWED REVIEWER PDF SHARES` and `false` as the third argument.
The helper never changes inherited or ancestor-folder permissions; review
those separately because they may also grant MODULES or SYLLABUS access.

## PDF processing limits

The browser worker currently enforces these conservative limits:

- Original PDF: at most 8 MiB.
- Watermarked output: at most 12 MiB.
- Pages: at most 80.
- An 8 MiB source becomes up to 11,184,812 base64 characters
  (about 10.67 MiB), before the surrounding JSON response.
- A 12 MiB output becomes up to 16,777,216 base64 characters
  (16 MiB), before the surrounding JSON response.
- PDF must be readable and unencrypted.
- Text must fit the built-in Helvetica Bold font.
- The preview blocks page-level selection, copy, cut, and context-menu actions.
  Native browser PDF viewers run outside the page's DOM, so their internal
  text-selection behavior cannot be fully disabled by page CSS.

These are code guards, not validated service limits. Local tests cover
synthetic PDFs, but do not establish actual-device processing time for a real
protected file or maximum-size downloads.

## Historical Apps Script proof of concept

Before preview processing moved to the browser, a synthetic Apps Script test
was run in the editor. The test function is now disabled and must not be run.
Historical measurements were:

- Source: 586,373 bytes; derivative: 609,664 bytes.
- Base64 derivative size: 812,888 characters.
- Pages verified: 20 of 20.
- Elapsed Apps Script time: 7,461 ms.
- Source unchanged; source and derivative private; temporary files trashed.
- Apps Script memory: unavailable.

These measurements describe the retired backend implementation and do not
describe the current preview path.

## Install and update the local bundle

The Apps Script project sources are selectively tracked in `backend/`; other
backend files remain ignored. Run `npm run vendor:reviewer-pdf-lib` to update
the website worker bundle and local compatibility-test bundles. Sync the
updated `backend/main.js` to disable the previous PDF worker routes, then run
`setupReviewerPdfDelivery()` as the project owner to remove existing worker
triggers. Publish the static website assets so reviewers receive the browser
worker.

The production Apps Script project is updated through the version noted in the
release record. Local tests cover PDF rendering, page-by-page watermark checks, authorization
contracts, and the browser worker, but the complete flow has not been
revalidated against an active account and a representative protected PDF.

No paid-service dependency remains in the runtime path. This does not certify
that Google Drive storage or other account services have no quota or account
limits; it introduces no new paid service or billing requirement.
