# Apps Script Reviewer PDF delivery

Reviewer PDF previews and downloads use the private Apps Script processor.
The browser requests a job, polls for completion, then receives only the
verified, watermarked derivative over HTTPS. The clean source PDF is read and
processed by Apps Script and is never returned to the browser.

Generated watermarked PDFs are saved in the private Drive folder configured by
`REVIEWER_PDF_OUTPUT_FOLDER_ID` in `backend/main.js`. Outputs remain in that
folder. A completed job for the same signed-in session, source file, and
source version is reused for ten minutes, avoiding repeated watermarking on
preview/download retries. The browser also keeps the prepared output in
current-tab memory for quick preview and repeat downloads.

## Dependency and license

- `pdf-lib` **1.17.1**, pinned exactly.
- MIT License; the full notice is in `vendor/pdf-lib-1.17.1-LICENSE.md`.
- Runtime bundle: `backend/PDFLib.js`, synchronized from
  `vendor/pdf-lib-1.17.1.min.js`.
- The library is used only by Apps Script and local tests; it is not included
  in the website deployment.

The package in this directory is a local build/test dependency. The runtime
uses the checked-in bundle, not npm or a remote URL.

## Build and local compatibility tests

From the repository root:

```powershell
npm install --prefix reviewer-pdf-service
npm run vendor:reviewer-pdf-lib
npm test --prefix reviewer-pdf-service
```

The test harness exercises the Apps Script PDF helper with the pinned
`pdf-lib` bundle in an isolated JavaScript context. It covers portrait and
landscape pages, invalid/oversized inputs, and per-page watermark verification.

## Request and security flow

`get_reviewer_pdf_preview` checks the current application session and account
approval, authoritative index membership, source version, and protected Drive
ancestry. It returns a cache hit only after fresh authorization and source
validation. Otherwise, it enqueues a background job. The worker revalidates
authorization and the unchanged source, adds the verified account name and
email to every page, verifies that the watermarks are present, and saves the
derivative in the configured private output folder. Job polling rechecks the
session, source version, output location, and output privacy before returning
the derivative.

The original PDF does not leave Drive for the browser. TLS protects the
watermarked response in transit. Client-side encryption would not improve
security because a browser that can decrypt a PDF can expose its bytes.
Watermarks and disabled page-level selection deter casual copying but cannot
prevent screenshots, screen recording, or all behavior of native PDF viewers.

The output folder must be private to the Apps Script execution owner.
`auditReviewerPdfOutputFolderPrivacy()` returns the output folder and each
ancestor's effective Drive permissions, identifying the folder and any
unexpected user, domain, or public access. Run it as the script owner when
setup reports a privacy failure, remove unwanted sharing in Drive, then rerun
the audit. The helper is read-only; it does not change permissions.
`setupReviewerPdfDelivery()` independently verifies that condition and enables
the background worker; run it as the script owner after the audit passes. If
the folder is not private, setup fails and PDF delivery remains disabled. Generated
derivatives are intentionally persistent to preserve the requested Drive
archive; job metadata expires after ten minutes but does not delete the saved
PDF.

## Processing limits and performance

- Original PDF: at most 8 MiB.
- Watermarked output: at most 12 MiB.
- Pages: at most 80.
- The public Modules/Syllabus in-site preview transport limit is 32 MiB.
- PDF must be readable and unencrypted.
- Text must fit the built-in Helvetica Bold font.
- The worker handles a bounded queue and reuses completed derivatives for
  matching session/file/source-version requests.
- The worker passes the processed byte array directly to Drive storage instead
  of base64-encoding and decoding it through an intermediate JSON response.

These are implementation guards, not validated service limits. Apps Script
worker startup, queue load, file complexity, and Drive/Google quotas affect
actual time. A server-side job adds processing time compared with exposing a
clean source for browser-side watermarking; that trade-off is intentional to
avoid delivering unwatermarked source bytes. Local tests do not establish
maximum-size or real-device processing times.

## Updating the local bundle

The Apps Script project sources are selectively tracked in `backend/`. Run
`npm run vendor:reviewer-pdf-lib` to update the Apps Script bundle and local
compatibility-test bundle. Deploy the updated backend, then run
`setupReviewerPdfDelivery()` as the script owner to verify the private folder
and enable the worker. The website deployment does not include the PDF
library or a browser PDF worker.

No paid-service dependency is used by this runtime path. Google Drive,
Apps Script, or account quotas may still apply.
