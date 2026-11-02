# FIBER net lb website preview

Version 0.1.3 is the browser version of the existing FIBER net lb accounting application. It runs the accounting modules on a separate Node 24 server and serves the current DaisyUI interface to phones, tablets and computers. Electron and a Windows desktop are not required on the server.

This is a deployment candidate for isolated staging. The existing Main PC remains the accounting authority until an agreed cutover. The website uses the seven existing SQLite database formats; a copied-data rehearsal is required before real use. Fictional previews and their checks are separate from accepting live business data.

## Local fictional preview

Install Node 24, then run:

```sh
npm ci --omit=dev --ignore-scripts
node tools/demo.cjs --port 3810
```

Open `http://127.0.0.1:3810`. The preview login is `demo.admin` with password `PreviewOnly-2026!`. These are public fictional credentials for this disposable preview only. Cashier, Support and Viewer fixtures are also available as `demo.cashier`, `demo.support` and `demo.viewer`, with the same fictional password.

The preview binds only to loopback, disables external providers, and creates independent temporary databases. Stop it with Ctrl+C to remove its marked temporary folder. It does not discover, read or modify Main PC data. Do not use the preview credentials or preview mode for public hosting.

## Interface and browser behavior

- Existing business modules, shared stock/POS, customer debts, supplier payments, fixed monthly payments, Company debts, Bank, funding carry-forward, monthly closing and sticky notes remain available according to each user's permissions.
- Phones and smaller tablets use a compact header with a Menu button. Navigation opens as a vertical list and closes after choosing a destination, tapping outside or pressing Escape. Desktop screens retain the sidebar. Large financial tables scroll inside their cards; dialogs and the POS cart adapt to the available width.
- Browser sessions use protected cookies, same-origin CSRF checks and separate business authorization per tab. An outdated tab must reload before submitting accounting changes. Financial requests are never automatically replayed after an uncertain response.
- Receipts use the browser print dialog with A4, A5 and thermal layouts, including 58 mm, 80 mm and XP-235B. The browser cannot silently select a Windows printer or confirm physical print completion.
- CSV export downloads a file. Native installers, Windows folders and live restore/reset are not browser operations. Admin backup settings/history and encrypted backup creation remain available; restoration is an operator task.
- WhatsApp receipt sharing retains its normal browser sharing/link flow. This package does not activate or send API reminders.

## Support handover and Resellers monthly accounting

Support sees **End of day** in the Users business dashboard, outside the retired summary cards. The Main dashboard shortcut opens that business using the same login. The existing Support role, business access, drawer permission, Cashier selection and reviewed handover remain required; the shortcut does not grant Main Office transfer authority.

Reseller Bills activity defaults to the current business month. Earlier Add Money receipts remain available through **All saved history**. Outstanding amounts still include unpaid earlier receipts, and verified carried-forward funds remain protected and available for collection or refund. Legacy closes that reset balances retain their separate restrictions.

The Resellers monthly ledger shows completed Admin collections on their actual collection dates, alongside recorded sales and the verified bandwidth purchase cost for that month. This includes unpaid bandwidth purchases. Existing fees and monthly deductions remain counted once. Earlier incomplete monthly reports receive a read-only presentation correction; the original closing archive and its audit proof are preserved. Company transaction reports retain their existing treatment of internal transfers so consolidating businesses does not count the same income or cost twice. Main dashboard Revenue retains its explicitly labelled all-recorded-dates collection view.

## Verification

```sh
node tools/check-source.cjs
npm test
```

Tests use fictional, temporary data. The suite covers the genuine headless core, real HTTP sessions, roles and business isolation, funding and monthly closing, copied-data preservation, and a real Chrome browser. Thirty unchanged accepted financial fixtures run against 61 unchanged accounting modules and five explicitly hashed website adaptations for backups and reseller monthly reporting/carry-forward. Original desktop and reviewed website hashes are recorded in `test/retained/manifest.json`. Dedicated tests verify Support handover visibility and authorization, collection dates and monthly totals, immutable archive presentation, protected carried funds, local-only daily backups and blocked external delivery while providers are disabled.

Chrome must be installed for the UI test. Set `CHROME_BIN` to its absolute path if needed. `CHROME_TEST_NO_SANDBOX=1` is reserved for disposable CI runners, not normal deployment. There is no TypeScript build or configured lint tool in this plain JavaScript project; the source check verifies JavaScript syntax and public-package boundaries. No coverage percentage is claimed.

The Ubuntu GitHub workflow also builds the production image and checks non-root container startup, encryption, writer locking, disabled providers and restart persistence using fictional mounts. A successful CI run is separate from acceptance on the user's future Ubuntu server and from checking actual data.

Read [DEPLOYMENT.md](DEPLOYMENT.md) for hosting and [MIGRATION.md](MIGRATION.md) for preserving old data. No domain, live server or migration snapshot is included in this public package.

