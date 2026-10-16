# Resources access and viewing

The old Drive folder-listing and preview endpoints remain disabled. The
Resource Dashboard links to Drive resources directly; its Reviewer dashboard
rows are returned only after server-side account authorization. A folder name
classifies resources; it does not authorize anyone to access them.

Reviewer access uses Google sign-in from the Resource Dashboard's Profile
section; the site does not create a separate password. The Profile section
shows the registered name, verified Google profile picture, and email after
sign-in, provides sign-out, and
lets a first-time user add their name. Any Google account with a verified
sign-in can use the reviewer resources after its name and stable browser device
identity are recorded in the `Accounts` worksheet in the `MRH_Accounts`
spreadsheet. New accounts are enabled immediately; the legacy `Active` field
does not block sign-in. The backend checks the token's audience, issuer,
expiry, and verified email, then requires the matching email and device
identity on every reviewer request. Missing or invalid configuration fails
closed.
The first-time profile form requires last and first names; middle initial is
optional. Users are asked to check spelling and capitalization before saving
(for example, `Dela Cruz`, `Maria`, `P.`).

The verified identity token exists only in page memory and is sent to the
backend for each protected request; it is not stored in browser storage.
Google Identity Services can offer automatic sign-in again after a refresh if
the user previously authorized it. Reviewer dashboard data is also kept only
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
`Accounts` worksheet. Any verified Google account can create a profile and is
enabled immediately; `Active` is retained as a legacy informational field and
is set to `TRUE` at sign-in. The OAuth client ID and spreadsheet ID are
configuration, not credentials. The spreadsheet remains administrator-managed
and must not be exposed as a public editable document.

To initialize sign-in and access logging:

1. Create a Google OAuth client for the web application and add the deployed
   site's exact origin to its authorized JavaScript origins.
2. Create a private Google spreadsheet named `MRH_Accounts` and copy its
   spreadsheet ID from its URL.
3. In Apps Script **Project Settings → Script Properties**, set
   `MRH_GOOGLE_OAUTH_CLIENT_ID` to the OAuth web client ID and
   `MRH_ACCOUNTS_SPREADSHEET_ID` to the spreadsheet ID.
4. In the Apps Script editor, run `initializeMRHAccountsSpreadsheet()` once
   and approve the requested Sheets and external-request permissions. It
   creates the `Accounts`, `MODULE`, `REVIEWERS`, and `SCOPES` tabs and headers
   without replacing existing account or log rows. The `SCOPES` tab lists
   required Apps Script OAuth scopes and their purposes; it is refreshed when
   the Profile screen checks sign-in configuration. Keep the spreadsheet
   private to administrators.
5. On first sign-in, a user submits `Last Name`, `First Name`, and optional
   `Middle Initial`. The backend verifies the Google identity and saves the
   name, email, stable internal device ID, and `Active=TRUE` immediately. The
   exact account columns are `Email`, `Device Identity`, `Last Name`,
   `First Name`, `Middle Initial`, and `Active`. There should be one row per
   email; do not manually create another device ID for an existing account.
6. Enable the Apps Script Advanced Google service **Google Sheets API v4**
   (the project manifest declares this service; enable the Google Sheets API
   in the linked Cloud project if prompted), and deploy a new web-app version.
   If scopes are added or consent is revoked later, run
   `initializeMRHAccountsSpreadsheet()` again from the Apps Script editor and
   approve the requested permissions as the deployment owner.
7. Test sign-in with a Google account. A new account can use Reviewers as soon
   as its profile is saved.

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

Successful sign-ins and reviewer dashboard access are appended to the
`REVIEWERS` tab with a timestamp, email, device ID, name fields, and event
type. Module access is recorded in the `MODULE` tab. Anonymous module dashboard
requests are recorded with a blank email and the browser device ID; the module
dashboard remains public. The `SCOPES` tab documents required backend OAuth
scopes and is refreshed when the initializer runs. `Active` does not revoke
access; remove the account row to block a previously enrolled email/device
pair. Google token verification results are cached by token hash for at most
five minutes; the raw token is not stored in the sheet or cache key.

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
