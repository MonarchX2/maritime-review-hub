# Resources access and viewing

The old Drive folder-listing and preview endpoints remain disabled. The
Resource Dashboard links to Drive resources directly; its Reviewer dashboard
rows are returned only after server-side account authorization. A folder name
classifies resources; it does not authorize anyone to access them.

Reviewer access uses Google sign-in from the Resource Dashboard's Profile
section; the site does not create a separate password. The Profile section
shows the verified account name and email after sign-in, provides sign-out, and
lets a new user request access. A user who is not yet registered can submit their
name and device ID after Google sign-in. The backend verifies the Google ID
token and adds a **pending, inactive** row to the `Accounts` worksheet in the
`MRH_Accounts` spreadsheet. An administrator must set `Active` to `TRUE`
before access is granted. The backend checks the token's audience, issuer,
expiry, and verified email, then requires an active spreadsheet row matching
both the email and device identity on every reviewer request. Missing or
invalid configuration fails closed.

The approved identity token exists only in page memory and is sent to the
backend for each protected request. Reviewer dashboard data is also kept only
in page memory and cleared on sign-out or page reload. The public dashboard
does not return reviewer rows.

The browser keeps a random UUID in local storage and a long-lived first-party
cookie; it is never displayed in the interface. After site storage is cleared,
Google sign-in automatically recovers the single device ID already registered
for that verified email before retrying authorization. The ID is not silently
replaced when saved copies conflict or are damaged. A user account is kept to
one device ID; administrators must resolve conflicting rows manually. The
device ID is an enrollment and audit identifier, not a secret or independent
proof of identity.

A website cannot read an immutable hardware identifier. Clearing all browser
storage before the account has been registered, removing or changing the
spreadsheet record, switching accounts, or using another browser/device can
prevent recovery or create a different browser UUID. The UUID is not
cryptographically bound to physical hardware, and must not be treated as
tamper-proof or used as an authentication factor.

Google Drive permissions are not changed by the dashboard. Anyone who can open
a linked file can copy or capture its contents. Ensure reviewer files are not
shared as "Anyone" or "Anyone with the link", since those settings could let
someone bypass app sign-in by opening a copied Drive URL.

## Configure accounts and access logs

The Apps Script web app remains anonymously callable and executes Drive
operations as its owner. The protected reviewer endpoint therefore does not
trust a browser-supplied email: it verifies the Google ID token with Google's
token information endpoint, checks that the token was issued for the configured
OAuth client, then checks the verified email and device against the
administrator-managed `Accounts` worksheet. The OAuth client ID and spreadsheet
ID are configuration, not credentials. The spreadsheet remains
administrator-managed and must not be exposed as a public editable document.

To initialize sign-in and access logging:

1. Create a Google OAuth client for the web application and add the deployed
   site's exact origin to its authorized JavaScript origins.
2. Create a private Google spreadsheet named `MRH_Accounts` and copy its
   spreadsheet ID from its URL.
3. In Apps Script **Project Settings → Script Properties**, set
   `MRH_GOOGLE_OAUTH_CLIENT_ID` to the OAuth web client ID and
   `MRH_ACCOUNTS_SPREADSHEET_ID` to the spreadsheet ID.
4. In the Apps Script editor, run `initializeMRHAccountsSpreadsheet()` once
   and approve its Sheets access. It creates the `Accounts`, `MODULE`, and
   `REVIEWERS` tabs and headers without replacing existing rows. Keep the
   spreadsheet private to administrators.
5. The first time an unregistered user signs in, they submit `Last Name`,
   `First Name`, and optional `Middle Initial`. The site sends the verified
   Google identity and internal device ID to the backend, which creates a pending row
   with `Active=FALSE`. Verify the name and email, then set `Active` to `TRUE`
   in `Accounts` to authorize the user. The exact columns are `Email`,
   `Device Identity`, `Last Name`, `First Name`, `Middle Initial`, and
   `Active`. There should be one row per email; do not manually create another
   device ID for an existing account.
6. Enable the Apps Script Advanced Google service **Google Sheets API v4**
   (the project manifest declares this service; enable the Google Sheets API
   in the linked Cloud project if prompted), deploy a new web-app version, and
   authorize the external-request and Sheets scopes.
7. Test sign-in from a registered account/device and from an unregistered
   email/device. Only the registered pair should be allowed to open Reviewers.

Successful access is appended to the `MODULE` or `REVIEWERS` tab with a
timestamp, email, device ID, name fields, and event type. Anonymous module
dashboard requests are recorded with a blank email and the browser device ID;
the module dashboard remains public. Reviewer rows are logged only after
server-side account authorization succeeds. Removing an account or setting
`Active` to false takes effect after the account cache expires (at most 30
seconds). Google token verification results are cached by token hash for at
most five minutes; the raw token is not stored in the sheet or cache key.

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

For stronger online-only viewing, replace whole-file preview responses with a
server-side rendering service that emits view-only page/image responses and
supports authenticated, non-cacheable delivery. This reduces exposure but
cannot prevent screenshots, photography, or other capture of visible content.
