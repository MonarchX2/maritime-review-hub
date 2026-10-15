# Resources access and viewing

The Resources portal reads the Google Drive folder configured in the private
Apps Script backend. It treats folder names matching
`^REVIEWERS v\d{2}\.\d{2}\.\d{2}$` as restricted, and denies folder listings and
file previews anywhere beneath a matching folder. Until recipient identity and
folder grants are implemented, those resources are unavailable to everyone
through the website. A folder name classifies resources; it does not authorize
anyone to access them.

The Reviewer access screen is informational until secure Google sign-in,
server-side identity verification, and reviewer-folder grants are configured.
Its sign-in control is intentionally disabled; the frontend does not claim to
authenticate or authorize visitors.

The rule is exact and case-sensitive: a dot immediately after `v` is not
accepted. Rename any folder intended to be restricted so it uses the required
`REVIEWERS vNN.NN.NN` spelling before relying on this protection.

Items that do not match the reviewer rule remain available through the public
website portal. Do not place content in the configured root unless it is meant
to be visible to website visitors. Drive permissions are not changed by the
portal. Folder listings are fetched afresh rather than cached, so a rename or
move into a matching reviewer folder is reflected by the next request. This
release removes obsolete portal-listing entries from session storage when the
application starts.

Supported file previews are requested from the backend and kept only in
page memory for display. Folder listings are not cached, and document bytes
are not stored in the frontend session cache, IndexedDB, or service-worker
cache. The in-page viewer can be expanded for focused reading. Unsupported
file types show a message instead of a download link. The portal does not
expose original Drive URLs or download controls.

These interface restrictions are not a technical barrier to copying. A visitor
who can view a document can inspect network responses, use browser tools, or
capture the displayed content. The Apps Script preview operation returns the
document bytes to the browser for rendering, and Google Apps Script
`ContentService` does not provide a way to set arbitrary response headers such
as `Cache-Control: no-store`. Do not treat hiding browser controls as
download-proof protection.

## Recipient access prerequisites

The existing Apps Script web app is deployed for public access and executes
Drive operations as its owner. Existing deck password checks are shared-secret
checks and do not verify a recipient's identity. They are not suitable for
reviewer-folder authorization. No reviewer identities or folder grants are
configured by this portal.

To enable reviewer access safely, first choose a verified identity provider
(for example, Google sign-in with a server-validated identity token), create
server-managed recipient-to-folder grants, and enforce those grants on every
listing and preview request. Apps Script's anonymous web-app execution does
not itself identify the website visitor; if a supported authenticated
deployment cannot provide a verifiable identity, move these operations to a
backend that can. Validate Drive's actual inherited permissions before
changing them. Do not broaden sharing on the root to implement reviewer access.

For stronger online-only viewing, replace whole-file preview responses with a
server-side rendering service that emits view-only page/image responses and
supports authenticated, non-cacheable delivery. This reduces exposure but
cannot prevent screenshots, photography, or other capture of visible content.
