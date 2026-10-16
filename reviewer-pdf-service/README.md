# Apps Script Reviewer PDF delivery

Online preview returns the authorized source PDF without creating a derivative;
the browser overlays the verified account name and email while viewing.
Watermarked bytes are generated only after the user selects Download. An
on-demand trigger processes the session-bound download job, and the delivery
request permanently deletes its private Drive output before returning the
download bytes. Sign-out and page-exit cleanup remove remaining outputs for
that session; a ten-minute expiry cleanup is the fallback if the browser
disconnects. `doPost` always returns a normal Apps Script `TextOutput`.
No Cloud Run processor, paid API, CDN, or runtime package download is required.

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

`get_reviewer_pdf_preview` checks the current session, account approval,
authoritative index membership, source version, and protected Drive ancestry,
then returns the original bytes. The frontend overlays the account name and
email; this path does not run PDF processing or create Drive files.

`get_reviewer_pdf` is used only by the explicit Download action. It queues a
random, session-bound job. `processReviewerPdfQueue` runs from an on-demand
one-time trigger, rechecks the session and approval, watermarks and verifies
every page, and stores a private temporary derivative in Drive. The browser
polls `get_reviewer_pdf_job`; that request rechecks approval, session
ownership, source membership, and source version. It permanently deletes the
private derivative before returning its bytes. Sign-out and page-exit cleanup
permanently delete any remaining outputs for the session; job expiry after ten
minutes is a cleanup fallback. The active queue is capped at three. If a
queued job's worker trigger is overdue by more than one minute, polling
replaces the stale trigger instead of leaving the job pending indefinitely.

Each physical page watermark contains only the verified account's full name
and email on two separate lines, repeated in a compact two-column by
five-row pattern. Every stamp is checked after saving. No derivative is cached or reused. The
authoritative index is cached only by its Drive file ID and last-modified
timestamp, and checked again for each protected request.
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
real protected file, the maximum input/output limits, the time-trigger queue,
or large `ContentService` responses. Apps Script has execution and service
quotas and does not expose a reliable per-execution memory measurement.

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
limits, processing of actual protected PDFs, trigger execution, or successful
web-app download delivery through the job queue. Separately, the existing
`/dev` web app was tested with a Promise-return probe and rejected the return
value as unsupported.

## Install and update the local bundle

The Apps Script project sources are selectively tracked in `backend/`; other
backend files remain ignored. Run `npm run vendor:reviewer-pdf-lib` to place
the pinned library at
`backend/PDFLib.js`. Synchronize the complete `backend/` project (including
`main.js`, `ReviewerPdf.gs`, `PDFLib.js`, and `appsscript.json`) to the
existing Apps Script project. Run `setupReviewerPdfDelivery()` as the project
owner, then create a separate test deployment and verify the complete request,
worker, poll, and browser-render flow before updating production.

The production Apps Script project is updated through the version noted in the
release record. Local tests cover PDF rendering, page-by-page watermark checks,
authorization contracts, and cleanup behavior, but the full request/worker/
poll/browser flow has not been revalidated against an active account and a
representative protected PDF. Actual maximum-size response delivery and live
Drive ACL auditing remain separate operational checks; no account or folder
permissions were changed by this implementation.

No paid-service dependency remains in the runtime path. This does not certify
that Google Drive storage or other account services have no quota or account
limits; it introduces no new paid service or billing requirement.
