# Browser-side Reviewer PDF processing

Reviewer PDFs are authorized by Apps Script and watermarked in the website's
browser worker. The backend does not parse, watermark, queue, save, or archive
PDF derivatives. No `PDFs` Drive folder is required.

The backend validates the active reviewer session, approval status, indexed
file ID, PDF type, and protected Drive ancestry, then returns the clean source
PDF and verified account name/email over HTTPS. It does no PDF parsing or
transformation. The browser worker lays out perimeter marks (three
horizontal marks along both the top and bottom and three vertical marks along
each side, inset equally from their edge) around a larger interior pattern.
Interior diagonal rows are sized and spaced for each page, use two consistently
angled marks per row, and always start and end with a pair. Horizontal marks
fill the center positions between diagonal rows. Smaller-than-perimeter marks
sit on both sides of each centerline mark and horizontally between each
diagonal pair. All perimeter marks use a smaller font than the interior
diagonals and center marks, and are sized up to 80% of the interior font when
the text fits. Diagonal marks occupy only the two
interior side columns at a shallow 25-degree angle, leaving the middle column
for horizontal marks. The diagonal pairs and centerline marks span the page's
interior height instead of clustering around its center. Every line is centered
within its watermark block. Each page's watermark text is emitted in one
batched PDF text object with shared font-opacity setup, reducing repeated
drawing and graphics-state operators. The same prepared bytes are used for
online preview and repeat downloads. The verified account name is stored as
the PDF author, the backend-provided download filename is stored as its title,
and the verified email is stored as its subject and a keyword. The backend
creates download filenames by placing the account's uppercase last name before
the indexed resource title and uppercase first name after it, each name in
square brackets (for example, `[REVIEWER] Lesson 1 [RITA].pdf`); the browser
does not derive names from local profile or dashboard values.

HTTPS protects source bytes in transit. Because the browser must receive and
process those bytes, an authorized user who controls their browser can inspect
or save the clean source. Encrypting data for the same browser cannot prevent
that. Watermarks and text-selection restrictions are deterrents, not hard
copy-protection.

## Dependency and license

- `pdf-lib` **1.17.1**, pinned exactly.
- MIT License; the full notice is in
  `vendor/pdf-lib-1.17.1-LICENSE.md`.
- The website worker loads `pdf-lib-1.17.1.min.js` from the same-origin,
  content-hashed static deployment.
- The Apps Script backend does not bundle or load `pdf-lib`.

The package in this directory is a local build/test dependency. The website
uses the checked-in bundle; it does not load code from npm or a remote URL at
runtime.

## Build and local tests

From the repository root:

```powershell
npm install --prefix reviewer-pdf-service
npm run vendor:reviewer-pdf-lib
npm test --prefix reviewer-pdf-service
```

The tests execute the browser worker in an isolated JavaScript context with
the pinned library. They cover portrait and landscape pages, dynamic watermark
density and rotations, invalid identity and input, page limits, source
immutability, and a synthetic 20-page PDF. `npm run check:deployment-assets`
verifies that the
worker and library are content-hashed and deployable.

## Request and processing flow

1. The browser sends `get_reviewer_pdf_preview` with its opaque reviewer
   session, event ID, and indexed file ID.
2. Apps Script revalidates the account, checks the protected index and Drive
   ancestry, and returns either a source-version cache validation or source
   bytes plus the verified account identity.
3. A dedicated Web Worker validates and watermarks the PDF off the UI thread.
4. The website displays the prepared PDF in its in-site preview and reuses
   those same bytes for each download through a native download link. The
   fallback download prompt appears only if the PDF frame errors or fails to
   signal that it loaded within eight seconds. On mobile and touch devices,
   the site opens a standalone Blob-based viewer in the same tab with Return
   to Website, Download, and Open File actions in its header. The viewer
   embeds the prepared PDF and offers a direct native-viewer link.

The source limit is 8 MiB, output limit 12 MiB, and page limit 80. Worker
startup and document complexity affect local processing time; the 20-page
synthetic test is a regression check, not a guarantee for all devices or PDFs.
Apps Script still performs authorization and source delivery, but no longer
waits for PDF parsing, watermarking, job polling, or derivative storage.
If an old time-based trigger still calls the retired handler, the compatibility
stub removes that trigger and returns without processing or saving files. The
`PDFs` output folder and the former queue cleanup helper are not required.
