# Apps Script Reviewer PDF delivery

The local backend now uses a synchronous request/response boundary around an
asynchronous watermark worker: an authorized request queues a private job,
an installable time trigger watermarks and verifies it, and the authorized
browser polls for the derivative. `doPost` itself always returns a normal
Apps Script `TextOutput`; it never returns a Promise or the source PDF.
This queue design still requires staged validation in the actual Apps Script
project before enabling a production deployment. No Cloud Run processor,
paid API, CDN, or runtime package download is required.

## Dependency and license

- `pdf-lib` **1.17.1**, pinned exactly.
- MIT License; the full notice is in `vendor/pdf-lib-1.17.1-LICENSE.md`.
- Runtime bundle: `vendor/pdf-lib-1.17.1.min.js` (about 525 KB).
- Apps Script copy: `backend/PDFLib.js`.
- The bundled code is self-hosted in the Apps Script project. It does not
  import Node `Buffer`, `require`, or a network-loaded library.

The package in this directory is a local build/test dependency only. The
runtime uses the checked-in bundle, not npm or a remote URL.

## Build and local compatibility tests

From the repository root:

```powershell
npm install --prefix reviewer-pdf-service
npm run vendor:reviewer-pdf-lib
npm test --prefix reviewer-pdf-service
```

The test harness loads the same browser UMD bundle and the `.gs` watermark
source in an isolated V8-like JavaScript context without Node `Buffer`,
`require`, `process`, `window`, or `document` globals. It tests portrait and
landscape PDFs, oversized and invalid inputs, watermark verification, and
source-byte integrity. These local tests complement, but do not replace, the
Apps Script runtime proof below.

`get_reviewer_pdf` now queues work and returns a random, session-bound job ID.
`processReviewerPdfQueue` runs from an on-demand one-time trigger, rechecks the
reviewer session and current approval, watermarks and verifies every page, and
stores only a private temporary derivative in Drive. The browser polls
`get_reviewer_pdf_job`; that request rechecks approval and session ownership
before returning the derivative. Jobs expire after ten minutes, the active
queue is capped at three, and stale outputs are trashed during job cleanup.
No watermarked derivative is cached or reused; each job creates its own
session-bound output. The authoritative index is cached only by its Drive file
ID and last-modified timestamp, and checked again for each protected request.
Run `setupReviewerPdfDelivery()` once from the Apps Script editor as the
deployment owner to authorize and initialize on-demand worker triggers.
Without setup, requests fail closed with `PDF_PROCESSOR_NOT_CONFIGURED`.

`auditReviewerPdfDrivePermissions()` produces a read-only report of direct
permissions on indexed Reviewer PDFs and permissions inherited from ancestor
folders. To review a proposed direct-file revocation without making changes,
call `applyReviewedReviewerPdfPermissionRevocations(reviewedPermissions, "", true)`.
Applying reviewed direct PDF permission removals requires a second explicit
call with the confirmation string
`REVOKE THE REVIEWED REVIEWER PDF SHARES` and `false` as the third argument.
The helper never changes inherited or ancestor-folder permissions; review
those separately because they may also grant MODULES or SYLLABUS access.

## Apps Script processing limits

The helper currently enforces these conservative limits:

- Original PDF: at most 2 MiB.
- Watermarked output: at most 4 MiB.
- Pages: at most 80.
- The 4 MiB output limit becomes up to 5,592,408 base64 characters
  (about 5.33 MiB), before the surrounding JSON response.
- PDF must be readable and unencrypted.
- Text must fit the built-in Helvetica Bold font. If watermarking or the
  post-save watermark verification fails, the processing helper throws and
  never returns the original bytes.

These are code guards, not validated service limits. The actual Apps Script
proof completed a 20-page synthetic portrait/landscape PDF, but did not test a
real Reviewer file, the maximum input/output limits, the time-trigger queue,
or large `ContentService` responses. Apps Script has execution and service
quotas and does not expose a reliable per-execution memory measurement. Do not
enable production delivery until the queue and response path are verified
against the actual deployed `/dev` endpoint and representative Reviewer PDFs.

## Apps Script proof of concept

After the local bundle has been copied into `backend/PDFLib.js` and the
backend source has been synchronized to the existing Apps Script project, an
administrator whose Apps Script execution identity is approved with
`Active=TRUE` can run `runReviewerPdfWatermarkProofOfConcept()` using an
authorized Apps Script API-executable deployment or the Apps Script editor.

The proof function was run in the actual Apps Script editor/runtime. It created
a private synthetic 20-page portrait/landscape PDF in Drive, read it back,
derived the test identity server-side from the execution identity and current
`ACCOUNTS` row, watermarked and reopened the output, checked all page streams,
compared the source before/after, and trashed both temporary files. Results:

- Source: 586,373 bytes; derivative: 609,664 bytes.
- Base64 derivative size: 812,888 characters.
- Pages verified: 20 of 20.
- Elapsed Apps Script time: 7,461 ms.
- Source unchanged; source and derivative private; temporary files trashed.
- Apps Script memory: unavailable.

This proves the PDF library and watermark helper can process that synthetic
input in Apps Script. It does not establish performance at the configured
limits, processing of actual Reviewer PDFs, trigger execution, or successful
web-app delivery through the job queue. Separately, the existing `/dev` web app
was tested with a Promise-return probe and rejected the return value as
unsupported.

## Install and update the local bundle

The Apps Script project sources are selectively tracked in `backend/`; other
backend files remain ignored. Run `npm run vendor:reviewer-pdf-lib` to place
the pinned library at
`backend/PDFLib.js`. Synchronize the complete `backend/` project (including
`main.js`, `ReviewerPdf.gs`, `PDFLib.js`, and `appsscript.json`) to the
existing Apps Script project. Run `setupReviewerPdfDelivery()` as the project
owner, then create a separate test deployment and verify the complete request,
worker, poll, and browser-render flow before updating production.

The Apps Script project has been synchronized with the queue implementation
and a separate version-154 test deployment was updated. Production deployment
version 152 remains unchanged. The test endpoint returned its auth
configuration, rejected a forged Google credential at sign-in, and rejected a
fabricated reviewer session before returning a worker-configuration error.
`setupReviewerPdfDelivery()` has not been run, so the test worker remains
uninitialized. A read-only live Drive permission audit did not complete
(Apps Script returned a storage `NOT_FOUND` error); no permissions were changed.

Do not update production or claim production readiness until the test worker is
initialized and the complete request/worker/poll/browser flow passes with an
active and a revoked account, a representative Reviewer PDF, output privacy,
trigger recovery and cleanup, maximum supported output size, and the actual
browser response body. Also complete and retain the live Drive ACL report,
including inherited permissions.

No paid-service dependency remains in the runtime path. This does not certify
that Google Drive storage or other account services have no quota or account
limits; it introduces no new paid service or billing requirement.
