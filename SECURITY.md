# Security reports

Please report suspected vulnerabilities through
[GitHub private vulnerability reporting](https://github.com/witnesstodark/mr-mak-workspace/security/advisories/new).
Keep reproduction steps and patches private until we have reviewed the report
and agreed on disclosure. Do not put credentials or personal project content
in a public issue.

Include the app version, operating system, affected feature, expected permission
behavior, and the smallest reproduction you can provide. Remove real tokens,
account details, and private files from logs or screenshots.

We review reports against the latest release. Older releases may need an update
to receive a fix. A public issue acknowledging a report does not mean that the
underlying vulnerability has been resolved.

## Local service and permissions

Mr. Mak runs on the current user's machine and starts CLI tools as that user.
The CLI's own permission and sandbox settings remain important. Bypass is an
explicit choice and is off by default. Mr. Mak is not an operating-system
sandbox for arbitrary programs running under the same account.

The desktop service listens on loopback. Do not expose it through a public
proxy, tunnel, or network interface. Its diagnostic `runtime.json` contains the
process ID and local origin, not the credentials used by the desktop windows.
Keep `.env`, local state and native CLI histories out of shared repositories.

## Reports and paired phones

Desktop HTML and SVG previews use an opaque sandbox and an expiring grant for
the selected report folder. Mobile reports also use scoped grants tied to the
paired device. Keep a report's data, images and scripts inside its card folder;
the shared `workspace/_shared/report.css`, `report.js` and `examples.css` remain
available. Bundle dependencies locally. Remote scripts, fonts and background
network requests are blocked. User-opened web links still leave the report.

The desktop window credential stays in memory and is provided again by the
native shell when the window reloads. It is removed from the URL and is not saved
in browser storage. This reduces persistence; it does not make same-user code
an operating-system security boundary.

Phone pairing has separate per-source request limits and invalidates a code
after ten failed attempts. A paired phone expires after 30 days without use,
or after 180 days in total. Reconnect it through the desktop QR code. Disconnect
a lost phone from Chats immediately.

The Linux GTK dependency still includes glib 0.18.5, affected by
[RUSTSEC-2024-0429](https://rustsec.org/advisories/RUSTSEC-2024-0429.html).
The upstream fix is in glib 0.20 and requires a compatible Tauri/GTK stack
upgrade. This dependency finding remains open; the report and phone changes
above do not resolve it.
