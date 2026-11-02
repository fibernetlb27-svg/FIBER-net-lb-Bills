# FIBER net lb website preview

Version 0.1.5 is the browser version of the existing FIBER net lb accounting application. It runs the accounting modules on a separate Node 24 server and serves the current DaisyUI interface to phones, tablets and computers. Electron and a Windows desktop are not required on the server.

Use isolated staging and a copied-data rehearsal before a new deployment or upgrade. The existing authorized accounting server remains the sole authority until an agreed cutover; an already migrated website must not resume recording on its old desktop copy. The website uses the seven existing SQLite database formats. Fictional previews and their checks are separate from accepting live business data.

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

## Automatic End of Month and money to collect

The server checks every ten seconds for **11:59 PM on the last day of each month, in Asia/Beirut**. Automatic closing starts with the month in which this version first enables the schedule. For example, first enabling it in November 2026 schedules November's close on November 30; it does not automatically close October or rewrite older archives.

Before closing, the server pauses new accounting requests and waits for accepted operations to finish. It then uses the existing verified per-business closing service and backups. Cash and Whish custody carry forward in full; the server does not deposit money to Bank or send an external payment. During closing, new accounting requests receive a temporary unavailable response before any action is accepted; session status, sign-out and the authorized scheduling status remain available. After a successful 11:59 PM close, that month's transactions stay locked for the remaining minute; new-month transactions and Bank deposits become available at midnight.

Unresolved financial operations delay closing for review. The protected scheduler journal and stable request IDs retain the original plan through retries and restarts. Completed business archives remain unchanged if another business is delayed. When the server returns after downtime, it catches up eligible months in order, starting at the first enabled month. This requires an active Main Admin with the business access and permissions needed by the existing closing service.

Inside **Bank**, each existing business account card shows a separate **Last month's money remaining** section. It starts from that business's verified previous-calendar-month closing cash and Whish balances. This month's receipts and other incoming money do not increase it. Outgoing payments use the carried portion first; verified transfers within the same business keep its carried money with the receiving holder or wallet. Money returned from Bank counts as a new incoming balance rather than money that stayed from last month. Missing or legacy reset archives do not create an invented carried balance.

Use the card's prior-month deposit action, choose the exact permitted holder and cash or Whish source, and enter a partial amount. The server checks the remaining carried portion again when saving, credits the business Bank once and shows the rest. A verified Undo of a monthly payment made this month restores only the carried portion that the original payment consumed. The ordinary **Deposit to Bank** action remains available for current funds separately. Bank deposits do not change revenue, profit or expense funding. Support-held money still requires the existing authorized handover; these cards grant no new deposit permission. The duplicate money-to-collect section is removed from Main dashboard.

New encrypted backups include `automatic-month-closing.json` when it is present, along with the seven databases. Preserve that private journal when moving or restoring an existing website. Older archives without it remain supported; if it is absent, scheduling starts with the month of that first restored startup rather than guessing an older schedule.

## Verification

```sh
node tools/check-source.cjs
npm test
```

Tests use fictional, temporary data. The suite covers the genuine headless core, real HTTP sessions, roles and business isolation, funding and monthly closing, copied-data preservation, and a real Chrome browser. Thirty unchanged accepted financial fixtures run against 58 unchanged accounting modules and eight explicitly hashed website adaptations recorded in `test/retained/manifest.json`. The reviewed adaptations cover backups, reseller monthly reporting/carry-forward, the trusted automatic close boundary and prior-month Bank deposit limits; the original desktop sources stay unchanged. Dedicated tests verify Support handover visibility and authorization, reseller collection dates and monthly totals, immutable archives, protected carried funds, automatic Beirut month closing and restart recovery, prior-month-only Bank balances, partial deposits and stale-request rejection, local-only daily backups and blocked external delivery while providers are disabled.

Chrome must be installed for the UI test. Set `CHROME_BIN` to its absolute path if needed. `CHROME_TEST_NO_SANDBOX=1` is reserved for disposable CI runners, not normal deployment. There is no TypeScript build or configured lint tool in this plain JavaScript project; the source check verifies JavaScript syntax and public-package boundaries. No coverage percentage is claimed.

The Ubuntu GitHub workflow also builds the production image and checks non-root container startup, encryption, writer locking, disabled providers and restart persistence using fictional mounts. A successful CI run is separate from acceptance on the user's future Ubuntu server and from checking actual data.

Read [DEPLOYMENT.md](DEPLOYMENT.md) for hosting and [MIGRATION.md](MIGRATION.md) for preserving old data. No domain, live server or migration snapshot is included in this public package.

