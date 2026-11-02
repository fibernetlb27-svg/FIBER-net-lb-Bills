# Old data transfer plan

This document describes an initial desktop-to-website staging rehearsal and eventual cutover; it does not authorize stopping the current accounting host, copying live customer data, changing providers or enabling two active accounting systems. For a website that has already migrated, upgrade its existing seven-database data volume and preserve it as the sole accounting authority. Do not reactivate a diverging old desktop copy.

## What must be preserved

Move a complete, consistent set of all seven databases together, including Main Office and the six businesses. Preserve receipts, users and access rules, stock, unpaid customer/reseller/supplier obligations, Company debts and linked monthly bills, payment reversals, cash/Whish custody, Bank balances, monthly archives, prior-month expense funding, sticky notes and pending request journals. A new month does not cancel debts, pending collections or stored money.

For websites using automatic monthly closing, also preserve the private `automatic-month-closing.json` scheduling journal. New encrypted backups include it when present. It records the first enabled month and completed schedule progress; financial closing archives and request proofs remain in each business database. Older supported backups can lack this optional file. If no preserved scheduler journal is supplied, first restored startup starts scheduling from its current Beirut business month and does not invent a past schedule.

Version 0.1.4 closes eligible months automatically at 11:59 PM on the last day in Asia/Beirut, starting with the first enabled month. For example, a first November 2026 startup schedules November 30 and leaves October untouched. The server waits for accepted work to finish, rejects new actions during the close, and delays if unresolved financial operations need review. It keeps full carried cash/Whish balances rather than moving them automatically to Bank. The remaining minute is closed to that month's accounting writes; the next month opens at midnight. Partial Bank deposits made later reduce the existing custody balances once, and the current business collection cards show the remainder without creating another receivable.

The supported source baseline is desktop 1.45.3. Other source versions require a separate rehearsal. Never copy only one business, omit a database, or use a collection of files captured at different times as the final authoritative snapshot. Existing passwords remain hashed; server-side provider and backup secrets encrypted by Windows must be entered again securely on Ubuntu.

## Rehearsal while Main stays running

1. After the server address is supplied, prepare private staging storage, HTTPS and a new external 32-byte server key. Keep the website provider switch disabled.
2. Use an explicitly supplied, consistent all-business backup. Keep its original archive unchanged. Verify and extract it into a new private directory with `tools/verify-backup.cjs`; see the deployment guide for the hidden passphrase prompt. Never put the backup, customer rows, passwords or key into GitHub or the source ZIP.
3. Before starting the copied instance, audit the stopped copy:

```sh
node tools/data-audit.cjs inspect /private/copied-data /private/before.json --copied-data
```

4. Start the website only against that private copy with providers disabled. Confirm all expected businesses and permissions. Startup may apply retained migrations. Stop the rehearsal website before the second audit:

```sh
node tools/data-audit.cjs inspect /private/copied-data /private/after.json --copied-data
node tools/data-audit.cjs compare /private/before.json /private/after.json
```

The reports contain table counts/hashes, schema hashes and custody totals, not customer rows. They are still private financial metadata. Preserve and investigate every difference. Physical SQLite file layout can change without a financial change; all stored rows, schema and sequence values must be reconciled. A successful login alone does not prove a correct migration.

5. Compare exact business totals and a sample of real records with the original: drawer/wallet and Bank, funding by month, customer debts, reseller additions/collections, supplier bills, product debts, paid/unpaid/frozen monthly bills, linked Company debts, reversals, stock and historical receipts. Confirm pending operations before any retry. Do not test renewals or external transfers with a copied database connected to real providers.
6. Test approved devices and printers. Confirm Safari/iPhone behavior, physical paper sizes and an encrypted backup/restore rehearsal on the actual Ubuntu environment. Measure memory and backup peaks using the actual copied data before setting final resource limits.

## Eventual cutover, only after approval

Agree the stopped-writes time and rollback boundary. Preserve the original Main installation, data and Windows recovery material. Stop accounting writes on all original clients, create one final verified all-seven snapshot, import it into a new private website volume, and repeat the baseline checks. Allow website users in only after the totals and pending journals match. Re-enter provider/backup secrets through protected Admin settings; enable provider access only after reconciliation and explicit cutover approval.

Do not operate the old desktop and new website as independent writers after migration. The old PC can remain preserved for rollback, but old clients must not keep recording business actions into a diverging database.

If staging fails, leave Main as the authority and repair the copied instance. After live website writes begin, rolling back to an earlier snapshot requires reconciling those new receipts, payments, provider actions and physical cash movements. Restoring a database does not undo a real external payment or renewal.

