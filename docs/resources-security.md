# Resources access and viewing

Modules and Syllabus chips open files and folders in the Student Portal. Folder
contents, nested folders, and child files are listed inside the portal; the UI
does not navigate to Drive pages. Modules files and Syllabus PDFs are handed
to the browser's native Blob viewer inside a dedicated viewer shell with
return, download, and open actions. Modules audio and video preserve their
browser-recognized media types; other unsupported Modules files are not
interpreted as active content. Other Syllabus file types continue using the
supported in-site preview. Folder listing and file preview requests are
restricted to descendants of the public resource root, exclude protected
Reviewer folders, and paginate large folders. Drive shortcuts are resolved
only when their targets remain inside the same public resource tree; shortcuts
to protected or out-of-tree targets are excluded. Nested folder previews hide
the full breadcrumb path, offer one-level-up navigation and list/grid views,
and use file-type icons instead of requesting external thumbnail URLs. Files
larger than the 32 MiB preview transport limit remain listed but cannot be
previewed. Reviewer dashboard rows are returned only after server-side
account authorization. A folder name classifies resources; it does not
authorize anyone to access them.

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
validates it again. An account with a missing last name, first name, or valid
middle initial is treated as unverified regardless of its `Active` cell value;
Reviewer and protected PDF authorization both reject incomplete profiles.
The browser may warn when the submitted name does not appear to match the
verified Google email, but this warning does not block submission. All
submissions start at `Active=FALSE`; an administrator decides whether to grant
access. A user may edit a saved name; if any name field changes, the backend
saves it and resets `Active` to `FALSE` until an administrator confirms the
edited profile. Submitting the same name does not remove existing approval.
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
reaches `RESOURCE_PORTAL_ROOT_FOLDER_ID` through a versioned private
`REVIEWERS` folder. Invalid IDs, stale index entries, unsupported files, and
files outside that protected resource hierarchy are denied.

For faster return visits, the browser keeps a reviewer table snapshot in
current-tab session storage for up to 24 hours. It is used only after the
server confirms the saved session is still approved, refreshed from the
backend, and cleared on sign-out or loss of approval. Reviewer PDF requests
still reauthorize the account and revalidate current index membership and
source ancestry before returning bytes.

The original PDF remains in Drive. The authenticated
`get_reviewer_pdf_preview` route rechecks approval, index membership, PDF
type, and protected Drive ancestry, then returns the source PDF and verified
account identity over HTTPS. Apps Script does not parse or watermark PDFs,
create derivatives, or write PDFs to Drive. The website applies the name and
email watermark in a dedicated Web Worker. The same prepared bytes are used
for online preview and repeat downloads; a small, short-lived in-memory cache
avoids downloading and processing them again during the same tab session.
Source files are limited to 8 MiB and 80 pages; watermarked output is limited
to 12 MiB.

This client-side design removes server PDF parsing, queue polling, and Drive
derivative writes, but the browser must receive the clean source to watermark
it. HTTPS encrypts network transit; it does not prevent an authorized user
from inspecting source bytes in browser developer tools or a modified client.
Encrypting bytes for the same browser would not change that. The PDF output
folder is not used or required. A minimal compatibility handler lets any old
time-based trigger retire itself, then returns without reading, processing, or
writing PDF data. The queue, output-folder configuration, and separate cleanup
helper are removed.

The `pdf-lib` 1.17.1 (MIT licensed) browser worker stamps each page with the
verified account name and email at six small horizontal placements: the four
corners and top/bottom center. Page-level selection restrictions deter casual
copying where the browser viewer honors them, but cannot prevent screenshots,
screen recording, or all native PDF viewer behavior. Mobile and touch devices
use a same-tab Blob viewer with return, download, and direct-open actions
outside the native PDF frame. The preview frame, object URL, and in-memory
prepared PDFs are cleared when the preview closes, approval is lost, or the
session ends. Public Modules/Syllabus and non-PDF Reviewer flows remain
unchanged.

The local bundle, MIT attribution, compatibility tests, and deployment steps
are documented in
[the PDF setup and test guide](../reviewer-pdf-service/README.md). The
production endpoint should be verified against an active/revoked account and
a representative protected PDF.

The Apps Script editor functions `auditReviewerPdfDrivePermissions()` and
`applyReviewedReviewerPdfPermissionRevocations()` are separately invoked.
The first reports permissions for indexed Reviewer PDFs and their ancestor
folders only; it makes no changes. The apply function defaults to a dry run and returns exact planned
file/permission IDs. Applying those reviewed direct PDF permissions requires
`dryRun=false`, an explicit confirmation string, and exact reviewed permission
IDs; inherited/ancestor permissions and configured protected principals are
rejected. A fresh audit runs after changes. Parent-folder permission changes
are never automated. The audit did not produce a report: the Apps Script
execution attempt returned a storage `NOT_FOUND` error. The revocation
function has not been run, and no permissions have been changed. If exposure is inherited from a shared
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
5. Run `setupTriggers()` once to install the account-sheet cache invalidation
   trigger and the five-minute database safety sync. Setup also removes any
   obsolete reviewer status-email trigger and queued notification properties.
   Reviewer access changes are reflected through the website's account-status
   checks; the backend does not send access-status emails.
6. On first sign-in, a user submits `Last Name`, `First Name`, and optionally
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
   The repository selectively tracks the Apps Script runtime files under
   `backend/` while keeping unrelated backend files ignored. These files are
   not published by the GitHub Pages workflow; publish the updated
   `backend/main.js` to the Apps Script project separately before deploying
   the frontend. Existing users will need to complete Google sign-in once to
   exchange their transient Google credential for a persistent application
   session. Because this release removes the mail scope, run
   `initializeMRHAccountsSpreadsheet()` once to refresh the `SCOPES` worksheet
   and `setupTriggers()` once to remove any previously installed notification
   worker and queued status messages.
   If scopes are changed or consent is revoked later, run
   `initializeMRHAccountsSpreadsheet()` again from the Apps Script editor and
   approve the requested permissions as the deployment owner.
7. Test sign-in with a Google account. A new account can use Reviewers only
   after an administrator sets `Active` to `TRUE`. While a user remains
   signed in, the website checks approval about every two seconds and
   immediately after the tab becomes active. The protected backend reads the
   current account status directly, bypassing the short-lived account lookup
   cache. New access-log timestamps display in Philippine local time
   (`Asia/Manila`).

The portal records section opens, filter changes, resource clicks and previews,
folder navigation/pagination, Reviewer PDF downloads, sign-in, sign-out, and
profile submissions/updates in the corresponding access-log tabs. Logged-in
actions are associated with the verified account. Modules and Syllabus are
available before reviewer sign-in, so actions taken there without a valid
reviewer session are recorded without an email identity; the website does not
collect a separate identity merely to use public resources.

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
`Active` from `TRUE` to `FALSE` or `DENIED` blocks protected reviewer requests
on their next authorization check. Active browser sessions normally reflect
the change within about two seconds, or immediately after the tab is focused
or made visible; removing the account row also blocks access. Google token
verification results are cached by token hash for at most five minutes; the
raw token is not stored in the sheet or cache key.

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
authorization test, or real Reviewer-document delivery test has been
performed. The browser worker was exercised on synthetic PDFs; the protected
web-app source-delivery flow still requires live validation.
