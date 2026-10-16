# Apps Script Reviewer PDF watermarking proof of concept

This repository contains a server-side Apps Script proof of concept using the
locally vendored `pdf-lib` browser bundle. The protected Reviewer-PDF route is
not enabled: the Apps Script web-app response boundary rejected the
asynchronous `doPost` return value, so the route still fails closed. No
Cloud Run processor is used by the local runtime path, and no paid API, CDN,
or runtime package download is required.

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

The helper is asynchronous. A real POST to the existing Apps Script `/dev`
web-app endpoint confirmed that Apps Script rejects a Promise returned from
`doPost` with “The script completed but the returned value is not a supported
return type.” The protected `get_reviewer_pdf` route therefore intentionally
returns `PDF_RUNTIME_UNVERIFIED`. It does not return a derivative, and never
falls back to source PDF bytes.

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
  never returns the original bytes. The web-app endpoint currently fails
  closed before calling that helper.

These are code guards, not validated service limits. The actual Apps Script
proof completed a 20-page synthetic portrait/landscape PDF, but did not test a
real Reviewer file, the maximum input/output limits, or `ContentService`
response handling. Apps Script has execution and service quotas and does not
expose a reliable per-execution memory measurement. Do not enable the route
until a supported, synchronous web-app response path and representative
Reviewer PDFs have been validated. In particular, do not return a Promise
from `doPost` or deliver the source as a fallback.

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
limits, processing of actual Reviewer PDFs, or successful web-app delivery.
Separately, the existing `/dev` web app was tested with a Promise-return probe
and rejected the return value as unsupported. The temporary probe and helper
files have since been removed from the remote project; the original manifest
was restored, with no added `userinfo.email` scope. The project is back to its
five original source files. No new deployment was created, no versioned
deployment was updated, and production version 152 was not redeployed. Do not
claim the Reviewer PDF feature is working end-to-end or production-ready.

## Install and update the local bundle

The Apps Script project is the ignored `backend/` directory. Run
`npm run vendor:reviewer-pdf-lib` to place the pinned library at
`backend/PDFLib.js`. The local backend currently includes the proof helper and
the fail-closed route; those files are not installed in the remote Apps Script
project. Do not push or deploy until a supported response design has been
implemented and validated, and do not update the existing web-app deployment
as part of validation.

No paid-service dependency remains in the runtime path. This does not certify
that Google Drive storage or other account services have no quota or account
limits; it introduces no new paid service or billing requirement.
