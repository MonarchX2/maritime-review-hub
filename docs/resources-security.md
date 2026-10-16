# Resources access and viewing

The old Drive folder-listing and preview endpoints remain disabled. The
Resource Dashboard links to Drive resources directly; its Reviewer dashboard
rows are returned only after server-side account authorization. A folder name
classifies resources; it does not authorize anyone to access them.

Reviewer access uses Google sign-in from the Resource Dashboard's Profile
section; the site does not create a separate password. The Profile section
shows the registered name, verified Google profile picture, and email after
sign-in, provides sign-out, and lets a verified user submit or correct their
name. Any Google account with a verified sign-in can request reviewer access
by submitting a name to the `ACCOUNTS`
worksheet in the `MRH_Accounts` spreadsheet. New requests begin with
`Active=FALSE` and are not authorized until an administrator changes the value
to `TRUE`. `DENIED` blocks reviewer access and lets the user correct and
resubmit their name. The backend checks the Google token's audience, issuer,
expiry, and verified email at sign-in, then validates the issued application
session and requires the matching email and `Active=TRUE` for each protected
reviewer request.
Missing or invalid configuration fails closed.
The profile form requires last name, first name, and a middle initial formatted
as any single letter followed by a period; for example, `A.`, `M.`, or `Z.`.
The browser validates this format before sending the request, and the backend
validates it again.
Users are warned that false information will not be entertained and will be
ignored and deleted, and that their verified Google email must share at least one
meaningful name part or matching initials with the name they submit. This
similarity check is a safeguard against major discrepancies, not proof of
legal identity. Users receive an email when their profile becomes pending or
an administrator grants or denies access. A user may edit a saved name; if any
name field changes, the backend saves it and resets `Active` to `FALSE` until
an administrator confirms the edited profile. Submitting the same name does
not remove existing approval.
Reviewer notification emails use the display name “Maritime Review Hub” and
formal status-specific messages. Apps Script sends these messages from the
authorized script owner's account; sending from a separate address requires
configuring and authorizing that address as a Gmail alias.

Google ID tokens are used only to establish a session and are not written to
browser storage. After validating the Google token, Apps Script creates a
random, 96-hex-character application session ID. The server stores the session
identity and expiry in Script Properties under a key derived from the SHA-256
hash of that ID. Sessions expire after 30 days, are validated server-side on
each protected reviewer request, and are revoked on successful sign-out.
Changing or disabling the account approval still prevents reviewer access.
Startup validates a saved session before any reviewer rows are fetched; a
temporary network failure retains the opaque session ID for retry and does not
grant access until validation succeeds. Reviewer dashboard rows remain in page
memory and are cleared on sign-out or reload.

The static GitHub Pages site persists only the opaque application session ID
in first-party local storage (`mrh_reviewer_session_v1`), never a Google ID
token, password, or refresh token. This works across refreshes and browser
restarts and is synchronized across tabs through the browser storage event.
As with any JavaScript-readable storage, an XSS vulnerability could expose
this bearer session ID. Keep the site free of untrusted executable content and
use a restrictive Content Security Policy where the deployment supports it.
An explicit sign-out preference is also saved to suppress automatic Google
account selection; signing in again clears that preference.

If Google verification fails without a confirmed invalid-credential response,
the page retains the candidate Google credential in memory and offers a retry.
Temporary failures during application-session restoration keep the opaque
session ID and offer a retry. Approval polling similarly retains a verified
application session on temporary failures; protected backend operations
continue to validate authorization. Explicit sign-out and session replacement
are propagated to other open tabs through the browser storage event.

The current site is a static GitHub Pages deployment and calls the Google Apps
Script web app at `script.google.com` as a separate origin. Apps Script
`ContentService` does not provide a supported way to set a host-only
`HttpOnly` session cookie for the GitHub Pages origin, and a cookie scoped to
Google's backend host is not a first-party cookie for the site. Cross-origin
cookies would also be subject to credentialed-CORS and browser third-party
cookie restrictions. The current deployment therefore uses a server-managed
opaque session ID in local storage as the compatible fallback; this is not
equivalent to an `HttpOnly` cookie.
For stronger XSS resistance, a server-capable same-origin backend could issue
a host-only
`Secure; HttpOnly; SameSite=Lax; Path=/` cookie, hash session IDs server-side,
enforce expiry/revocation, validate Origin, and apply CSRF protection. No
Google ID token or refresh token should be persisted in browser storage. A
separately hosted backend may introduce hosting charges; that option is not
part of the current zero-new-service-cost implementation.

Google Drive permissions are not automatically changed by the dashboard.
Anyone who can open a linked file can copy or capture its contents. The
Reviewer PDF-only protection described below replaces direct Drive links for
Reviewer PDFs; other Reviewer resource types and the Modules/Syllabus flows
remain unchanged.

## Reviewer PDF-only protected viewing

Only PDF resources in the authorized `REVIEWERS` dashboard are routed through
the protected viewer. The Modules and Syllabus tabs are intentionally not
changed by this feature. Non-PDF Reviewer items also retain their prior
behavior.

Reviewer PDF dashboard responses replace original Drive URLs with opaque
Reviewer-PDF IDs. The viewing request revalidates the application session and
reads the `ACCOUNTS` status directly (bypassing the short account cache), then
checks that the requested ID is still present in `reviewers_combined.json`,
that Drive identifies it as a non-trashed PDF, and that its ancestor chain
reaches the configured `ROOT_FOLDER_ID`. Invalid IDs, stale index entries,
unsupported files, and files outside the configured root are denied.

The original PDF remains in Drive and is read only by the existing Apps
Script execution identity. The local proof-of-concept bundles `pdf-lib` 1.17.1
(MIT licensed); its asynchronous helper watermarks the server-verified
identity onto every page in memory and verifies every saved page stream. A
real Apps Script run processed a private synthetic 20-page portrait/landscape
PDF: 586,373-byte source, 609,664-byte derivative, 812,888 base64 characters,
7,461 ms elapsed, and 20/20 pages verified. The source hash was unchanged,
both temporary Drive files were private, and both were trashed. Apps Script
memory was not observable. This did not use an actual Reviewer PDF or test
processing at the code's provisional limits.

The existing `/dev` web app was also tested with a Promise-return probe.
Apps Script rejected it with “The script completed but the returned value is
not a supported return type.” As a result, the local `get_reviewer_pdf` route
fails closed with `PDF_RUNTIME_UNVERIFIED`; it does not return a derivative
and never falls back to the original. The PDF helper and bundle are not
installed in the remote project. No new deployment was created and version
152 was not redeployed. No Cloud Run service, third-party processor, public
temporary copy, or runtime CDN request is part of the local runtime path.

The code currently rejects sources over 2 MiB, derivatives over 4 MiB, and
files over 80 pages. These are implementation guards, not validated Apps
Script service limits. A 4 MiB derivative expands to at most 5,592,408 base64
characters (about 5.33 MiB) before JSON; maximum-size and actual
`ContentService` response behavior remain untested. No production delivery
claim is made. A supported web-app response path must be designed and
runtime-validated before enabling Reviewer PDF delivery. MODULES, SYLLABUS,
and non-PDF REVIEWERS flows remain unchanged.
Browser POSTs use `cache: "no-store"`; personalized output is not placed in
shared Apps Script or dashboard caches.

The local bundle, MIT attribution, compatibility tests, and Apps Script proof
are documented in [the Reviewer PDF setup and test guide](../reviewer-pdf-service/README.md).
The temporary remote proof files and test scope were removed after testing;
the remote Apps Script project is restored to its five original source files
and manifest. Existing deployments were not updated. The separate Drive
permission audit and revocation functions have not been run against live
Drive. End-to-end Reviewer PDF delivery is not implemented or production
ready.

The Apps Script editor functions `auditReviewerPdfDrivePermissions()` and
`applyReviewedReviewerPdfPermissionRevocations()` are separately invoked.
The first reports permissions for indexed Reviewer PDFs and their ancestor
folders only; it makes no changes. The apply function requires an explicit
confirmation string and exact reviewed permission IDs, allows only direct
permissions on indexed Reviewer PDF files, rejects inherited and
ancestor-folder permissions (to avoid changing Modules/Syllabus access) and
configured protected principals, and runs a fresh audit after changes. The
audit and revocation functions have not been run against live Drive, and no
permissions have been changed. If exposure is inherited from a shared
ancestor, resolve it without broadening this scope (for example, by reviewing
whether Reviewer PDFs should move to a separately restricted folder). Do not
treat the Drive hierarchy as private until administrators review the actual
ACL report, apply only approved revocations, and verify access with a revoked
account.

## Configure accounts and access logs

The Apps Script web app remains anonymously callable and executes Drive
operations as its owner. The protected reviewer endpoint therefore does not
trust a browser-supplied email: sign-in verifies the Google ID token with
Google's token information endpoint and checks the configured OAuth client.
Subsequent reviewer requests validate the opaque session ID against its
server-side hash record, then check the verified email and approval status in
the `ACCOUNTS` worksheet. A new verified account is added with `Active=FALSE`;
only an administrator can grant reviewer access by setting `Active=TRUE`.
Setting `Active=DENIED` rejects the profile and asks the user to correct and
resubmit their name. The page polls for status changes while the user remains
signed in. The OAuth client ID and spreadsheet ID are configuration, not
credentials. The spreadsheet remains administrator-managed and must not be
exposed as a public editable document.

To initialize sign-in and access logging:

1. Create a Google OAuth client for the web application and add the deployed
   site's exact origin to its authorized JavaScript origins.
2. Create a private Google spreadsheet named `MRH_Accounts` and copy its
   spreadsheet ID from its URL.
3. In Apps Script **Project Settings → Script Properties**, set
   `MRH_GOOGLE_OAUTH_CLIENT_ID` to the OAuth web client ID and
   `MRH_ACCOUNTS_SPREADSHEET_ID` to the spreadsheet ID.
4. After updating the Apps Script source, run
   `initializeMRHAccountsSpreadsheet()` once and approve the requested Sheets
   and external-request permissions. It creates the `ACCOUNTS`, `SYLLABUS`,
   `MODULE`, `REVIEWERS`, `SIGN-IN`, and `SCOPES` tabs and headers. It renames
   the existing `Accounts` tab to `ACCOUNTS`; if both
   account tabs exist, it consolidates duplicate emails only when the names
   and approval states agree. Conflicting account rows stop setup and must be
   resolved manually. Setup removes legacy device-identity columns and values
   from account and access-log worksheets, moves existing `SIGN_IN` entries
   from `REVIEWERS` to `SIGN-IN`, converts ISO timestamps to Philippine local
   time, and removes exact duplicate log rows. Conflicting names, approval
   states, or worksheet headers stop setup before data rows are changed.
   The `SCOPES` tab lists required Apps Script OAuth scopes and their purposes;
   it is refreshed when the initializer runs. Keep the spreadsheet
   private to administrators.
5. Run `authorizeMRHReviewerStatusEmails()` from the Apps Script editor once
   and approve the send-mail permission. This authorization step is required
   before the web app can send reviewer decision emails.
6. On first sign-in, a user submits `Last Name`, `First Name`, and
   `Middle Initial`. The backend verifies the Google identity and saves one
   account row per verified email with `Active=FALSE`. Reviewer resources stay
   locked until an administrator changes `Active` to `TRUE`. Set `Active` to
   `DENIED` to reject a profile; the user sees “Invalid credentials,” can
   correct their name, and resubmit it for review, which returns the account
   to `FALSE`. The exact account columns are `Email`, `Last Name`,
   `First Name`, `Middle Initial`, and `Active`.
7. Enable the Apps Script Advanced Google service **Google Sheets API v4**
   (the project manifest declares this service; enable the Google Sheets API
   in the linked Cloud project if prompted), and deploy a new web-app version.
   The repository's `backend/` directory is excluded by `.gitignore` and is
   not published by the GitHub Pages workflow; publish the updated
   `backend/main.js` to the Apps Script project separately before deploying
   the frontend. Existing users will need to complete Google sign-in once to
   exchange their transient Google credential for a persistent application
   session.
   If scopes are added or consent is revoked later, run
   `initializeMRHAccountsSpreadsheet()` again from the Apps Script editor and
   approve the requested permissions as the deployment owner.
7. Test sign-in with a Google account. A new account can use Reviewers only
   after an administrator sets `Active` to `TRUE`. While a user remains
   signed in, the website checks approval about every five seconds and locks
   Reviewer access when the spreadsheet status changes. A short-lived account
   lookup cache may delay a status change by a few seconds. New access-log
   timestamps display in Philippine local time (`Asia/Manila`).

If Apps Script asks for OAuth scopes to be entered manually, add one scope per
line in the Apps Script project manifest's `oauthScopes` array:

```text
https://www.googleapis.com/auth/drive
https://www.googleapis.com/auth/spreadsheets
https://www.googleapis.com/auth/script.external_request
https://www.googleapis.com/auth/script.scriptapp
https://www.googleapis.com/auth/script.storage
```

These are backend Apps Script permissions, not scopes to add to the website's
Google sign-in client. The website only requests Google identity for sign-in.
The required outbound-verification permission is
`https://www.googleapis.com/auth/script.external_request`. After adding or
changing scopes in the manifest, save the project, run
`initializeMRHAccountsSpreadsheet()` from the Apps Script editor, and approve
the new permission prompt as the deployment owner.

The auth-config response only confirms that the OAuth client and spreadsheet
IDs are present; it does not test Google token verification. If sign-in reports
that verification is temporarily unavailable, confirm the deployment owner's
external-request permission by running the initializer above, then retry. The
backend uses Google's token-info service with a secondary Google endpoint if
the primary is temporarily unavailable.

Successful sign-ins are appended to the `SIGN-IN` tab with a Philippine-local
timestamp, email, name fields, and event type; no device identity is stored.
Specific reviewer resource clicks are recorded in `REVIEWERS`; approved module
dashboard access and module file/folder clicks are recorded in `MODULE`;
syllabus file clicks are recorded in `SYLLABUS`. A click's `Event` value
includes the category, resource name, and Drive ID (for example,
`FILE_CLICK:MODULES:Module 1.pdf:012345678901234567890`). Syllabus and module
resources remain public, so their clicks can be recorded with a blank email.
When a user is signed in, clicks in all three areas include the verified
account; anonymous syllabus and module clicks have a blank email. Reviewer
clicks always require the same authorization as reviewer resource access. The
`SCOPES` tab documents required backend OAuth scopes and is refreshed when the
initializer runs. Changing
`Active` from `TRUE` to `FALSE` or `DENIED` blocks reviewer access after the
short account-cache window and the next status poll; removing the account row
also blocks access. Google token verification results are cached by token hash
for at most five minutes; the raw token is not stored in the sheet or cache
key.

The spreadsheet log is suitable for moderate usage, not unlimited traffic:
Google Apps Script execution and Sheets API quotas still apply. Appends use the
Sheets API's server-side append operation to avoid a shared application lock.
For sustained high-volume traffic, move audit events to a queue or managed
database and monitor Apps Script / Sheets quota errors. The backend does not
discard a failed protected reviewer log and return reviewer data anyway.

The account sheet is the account authorization policy; it does not grant
Google Drive permissions. Any links in reviewer dashboard rows still follow
their own Drive sharing rules. Do not broaden sharing on the Drive root to
implement reviewer access. Existing deck password checks remain shared-secret
checks and are unrelated to account authorization.

Apps Script anonymous deployment does not identify visitors on its own. If
token verification or outbound token checks cannot be supported by the
deployment, do not enable reviewer access; move protected operations to a
backend that can validate the identity instead.

The Reviewer PDF watermark is leak deterrence and attribution, not a guarantee
against screenshots, screen recording, browser developer tools, manual
copying, or photographing a display. No live Drive ACL audit, Sheets
authorization test, or real Reviewer-document processing test has been
performed. The Apps Script PDF helper was exercised on a synthetic test file,
but the protected web-app route remains disabled because its asynchronous
result cannot be returned directly from `doPost`.
