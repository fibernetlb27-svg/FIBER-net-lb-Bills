# Ubuntu deployment preparation

This package supports a standalone website on Ubuntu Server with Node 24, Docker Compose and Caddy. It contains no host-specific configuration, live database, credentials or private backup. Keep the current accounting authority running during development and staging; record host installation and staging acceptance separately. For an existing website upgrade, preserve that website as the sole writer. The HTTPS deployment templates deliberately require an explicitly chosen hostname.

Do not point this website at the running Main PC's files. Use fictional databases or an explicitly exported, complete seven-database snapshot in a separate private staging directory. Keep `PROVIDERS_ENABLED=false` during staging. The application is one accounting writer; a second replica, another website process or a desktop process must never write the same files or independent copies of the same active business at the same time.

## Package and topology

`server.cjs` runs the extracted accounting core without Electron or a Windows desktop. Caddy terminates HTTPS and forwards to one Node container. Only Caddy publishes ports 80/443. The Node port is private. Frontend assets come exclusively from the allowlisted files in `app/src`; databases, server modules, configurations, source archives and keys are never static resources.

The standard web container sets `TZ=Asia/Beirut` for normal accounting timestamps. The automatic month-closing calendar explicitly uses the same IANA time zone, including its daylight-saving rules, rather than the host machine's local clock format. Keep the server clock synchronized.

The Ubuntu starting estimate is 2 vCPU, 4 GB RAM and 60 GB SSD for this website, or 4 vCPU, 8 GB RAM and 100 GB SSD if sharing the machine with other services. These are planning estimates, not measured capacity. sql.js keeps all seven databases in memory and exports files, so actual database size, simultaneous staff, reports, backup size, disk latency and retained history must be measured using staging copies. The encrypted backup format currently limits the combined raw snapshot to 256 MiB.

The website uses HttpOnly, Secure, SameSite=Strict session cookies; exact same-origin and CSRF checks protect every browser RPC, including login. Business-bound backend tokens remain in server memory. Separate tabs retain their own business selection. Sessions expire after 30 minutes idle or 12 hours absolute lifetime; a server restart signs users out. Login, request, body-size, concurrent-request and session-count limits are enforced. No automatic transport retry is performed for a financial operation.

HTML is always fetched fresh. Other renderer assets use SHA-256 ETags and mandatory revalidation; their separate request budget cannot exhaust the API/login budget during business navigation. Every browser RPC carries the version pinned when that tab first loaded. A mismatch returns HTTP 409 before accounting execution; inspect saved/pending results and reload, without automatically repeating a change.

## Required decisions before deployment

- A business-controlled hostname and DNS access; public Internet or private/VPN access.
- The Ubuntu machine and whether ports 80/443 are available. If sharing a machine, integrate with its existing reverse proxy instead of binding a second proxy to those ports.
- The agreed stopped-writes transfer time, operator, accepted downtime and verification baseline for the eventual cutover.
- The desired future relationship to existing desktop/mobile clients. This website uses a same-origin cookie API; it does not expose the old desktop `/rpc` interface or claim compatibility with the mobile pilot.
- Off-host encrypted backup destination, retention, restore operator and a safe copy of the backup passphrase and server encryption key.

## Private storage and secret key

The production data directory must already contain all seven existing files:

```text
isp-desk.sqlite
sections/fiber-users.sqlite
sections/fiber-resellers.sqlite
sections/iptv.sqlite
sections/printer.sqlite
sections/studio.sqlite
sections/mobile-ogero.sqlite
```

Production startup uses `initialize:false` and refuses missing files. It never assumes that an absent business should be empty. Startup can perform retained schema/accounting migrations, so first run only on an isolated copy and compare the resulting data against the source snapshot.

Use owner-only directories (`0700`) and files (`0600`) outside the application package and web root. The container runs as UID/GID `10001:10001`; the data files and separate key must be readable by that identity. Restrict host administration and backup access accordingly. `deploy/compose.yaml` mounts data at `/data`, mounts the key read-only at `/run/secrets/server-key`, and makes the application filesystem read-only.

Generate a new random **binary 32-byte** server key outside the package, source repository, data directory and backup archive. For example, after the deployment operator has prepared the private directory, this command refuses to overwrite an existing key:

```sh
node -e "require('node:fs').writeFileSync(process.argv[1],require('node:crypto').randomBytes(32),{flag:'wx',mode:0o600})" /srv/fibernetlb/private/server-key
```

Keep a separate secure recovery copy. Losing the key makes the stored server credentials unrecoverable; restore the key or re-enter those credentials. Losing the backup passphrase makes its encrypted archives unrecoverable. They are different secrets. Never place either secret in command arguments, chat, the release ZIP, a Docker image, browser JavaScript, logs or a public environment file.

`lib/secrets.cjs` implements authenticated AES-256-GCM encryption with random nonces and a versioned header. It is compatible with the accounting modules' `safeStorage` method interface, but it **cannot decrypt Windows/Electron-encrypted credentials**. Existing `internet-api-settings.json` and `backup-settings.json` must be reconfigured through the protected Main Admin website settings after migration. Password fields are never returned by those APIs. Old encrypted values are rejected, not treated as plaintext. Re-enter the backup passphrase and FTP/email credentials securely; retain a safe external copy of the passphrase.

## Staging preparation

1. Keep Main running. Obtain a consistent all-seven encrypted backup using its existing backup feature or an explicitly coordinated export. An arbitrary copy of individual live files is not an authoritative all-business snapshot.
2. Verify/extract to a **new staging folder** with the operator tool below. Keep the original archive and Windows recovery material separately. Do not replace Main files.
3. Build the package on the Ubuntu staging host using its included lockfile. Copy `deploy/environment.example` to a private environment file outside the package, set its permissions to `0600`, and supply the selected staging hostname, private data directory and key file. Leave `PROVIDERS_ENABLED=false`.
4. Check the private Docker subnet `172.31.250.0/29` does not conflict with existing networks. If it changes, update both fixed container addresses and `TRUSTED_PROXY_ADDRESSES` together. The gateway trusts forwarded client IPs only from the explicitly named Caddy IP. Do not publish Node port 3000 or use arbitrary forwarded headers as authentication.
5. With the hostname and DNS prepared, review the resolved deployment configuration and then build/start the staging services:

```sh
docker compose --env-file /srv/fibernetlb/private/website.env -f deploy/compose.yaml config
docker compose --env-file /srv/fibernetlb/private/website.env -f deploy/compose.yaml build
docker compose --env-file /srv/fibernetlb/private/website.env -f deploy/compose.yaml up -d
```

These are future operator instructions, not actions already performed. Caddy requests a valid certificate for the configured hostname. Do not disable TLS checks, use self-signed production certificates, enable wildcard CORS, or expose the desktop LAN port to make login work. For a private hostname, configure the organization's trusted certificate/DNS method before enabling access.

The direct Node alternative requires `APP_ORIGIN=https://<chosen-hostname>`, absolute `DATA_DIRECTORY`, absolute `SECRETS_KEY_FILE`, and a reverse proxy preserving Host. It binds loopback by default. `BIND_ADDRESS=0.0.0.0` is intended only for the isolated container network. HTTP cookies without Secure are supported only by the explicitly marked loopback demonstration, never by production startup.

## Verify before any live cutover

Use isolated copies to verify logins and Admin/Cashier/Support/Viewer/Attendance restrictions; business access and staff permission changes; the seven database identities and account keys; receipt counts; customer debts; stock; Cash/Whish custody; Bank and business transfers; revenue/cost/profit; archived monthly totals; and pending/uncertain operation journals. Compare like-for-like baseline values and record any retained migration changes. A successful startup alone does not prove financial equivalence.

Exercise refresh, multiple business tabs, expired sessions, lost responses, interrupted operations, provider-disabled failures and restart recovery. A timeout is not proof that a payment failed. Inspect the original saved request/status before considering another submission. Proxy timeouts allow up to 660 seconds; this allowance does not authorize replay. The request ID and original business must remain unchanged during recovery.

Browser printing opens the user's print dialog and supports the supplied layouts. It does not enumerate Windows printers, select a physical device silently, or confirm physical print success. Verify A4/A5/58/80 mm output on the intended devices. CSV export is a browser download. Backup folder access/extraction and desktop installers/resets are not remotely callable browser operations.

## Existing website upgrade to 0.1.5

Keep one accounting writer. Before activating new code, stop the existing backend cleanly with its full shutdown grace period, preserve the seven latest databases and private settings, and rehearse startup against a separate copy. Retain the existing server encryption key, backup passphrase, HTTPS configuration and account settings. Never replace current business data with an older staging copy. A code rollback after new receipts have been recorded must preserve those receipts and reconcile any pending operations.

Version 0.1.5 places prior-month collection amounts inside the existing Bank account cards and removes the duplicate Main dashboard section. The projection reads verified previous-calendar-month closing proofs and current custody movements without rewriting historical reports or adding a debt. New-month income is excluded; outflows consume the carried portion first. Prior-month deposits include an optional reviewed `collectionMonth` and must pass both the normal exact-source balance check and the carried-source limit at commit. Existing ordinary Bank requests remain compatible. Verify these limits and the preserved automatic-closing journal against a stopped data copy before activation.

Version 0.1.4 enables automatic End of Month at **23:59 on the last calendar day in Asia/Beirut**. The first startup creates a private `automatic-month-closing.json` in the data directory and fixes the first eligible month to that startup's business month. A first enablement in November 2026 starts with November 30, not an automatic October catch-up. Preserve this file during upgrades and restarts. It is owner-only, saved atomically and verified before use; a damaged journal is rejected rather than silently replaced.

The scheduler checks every ten seconds while the server runs. It first blocks new accounting requests and drains already accepted requests and scheduled backups. It then requires an authorized active Main Admin and verifies existing pending-operation guards before closing each business with zero Bank allocations. It retains full cash/Whish custody, unpaid obligations and funding; it does not pay bills, renew services, or contact providers. During the brief closing operation new accounting actions and financial reads are rejected before execution; session status, sign-out and the authorized scheduling status remain available. Closed-month accounting writes remain locked for the rest of the final minute. Bank deposits and ordinary new-month writes resume after midnight.

Pending or unconfirmed operations delay closing. Admin should inspect the Monthly ledger and original request's status, resolve its actual outcome, and let the scheduler retry. Do not submit a replacement payment, delete its journal or force an archive. A restart resumes the same first-enabled schedule and stable per-business close IDs; verified completed business archives are reused. Downtime catch-up runs months in order, at most twelve per check, and continues on subsequent checks. The scheduler's status is visible to Main Admin through the dashboard; errors contain no provider credentials or raw financial records.

Verify the new business collection cards using isolated data: confirm current all-holder cash/Whish holdings, permitted exact deposit sources, a partial cash deposit, a partial Whish deposit and the resulting remainder. These cards follow current custody including carry-forward and later movements; they do not create a monthly receivable. Support custody may be included in a business total while remaining unavailable as an Admin deposit source until the normal handover.

Newly created encrypted backups include the private scheduler journal when present. Verify a backup made after activation. An older backup without this optional file is still accepted; when it is restored without an independently preserved journal, the scheduler starts with the restore startup month. Existing closing archives and their financial proofs stay in the seven databases. Restoring any older financial snapshot still requires the separate reconciliation procedure below.

## Encrypted backup verification and restore preparation

Main Admin can configure encrypted backups, inspect sanitized history, create a local encrypted backup, test an enabled destination and retry its delivery. Provider/network access remains disabled unless `PROVIDERS_ENABLED=true`; the default prevents Proradius, FTP and email calls. Manual and automatic daily encrypted local backups work with FTP/email disabled, independently of provider access. Enable the schedule and save a recovery passphrase; external delivery remains optional and requires reviewed destination settings plus explicitly enabled providers. The live server must be running for its schedule.

The archive contains all seven databases and the supported network/Internet/update settings files. Backup-delivery secrets and the server master key are not included. All raw backup copies and encrypted archives remain private files, outside the web root. Set an off-host retention policy and monitor failures; do not assume local history alone is a recovery plan. Existing optional plaintext FTP is a retained compatibility setting; choose FTPS and valid TLS certificates for production delivery.

Use this operator-only command to authenticate the archive, verify per-file SHA-256 values and run SQLite `quick_check` for all seven databases before extracting:

```sh
node tools/verify-backup.cjs --archive /private/path/backup.fnbak --destination /private/path/NEW-restore-check
```

It prompts for the passphrase without echo, rejects an existing destination, writes owner-only files, and creates `backup-verification.json`. `--passphrase-stdin` is available for protected noninteractive input; do not put a literal passphrase into shell history. The tool never contacts a provider, starts the backend, replaces an active database, deletes a directory or removes a writer lock. Incorrect passphrases, damaged archives or failed integrity checks create no extraction directory. A later filesystem failure can leave the new extraction folder incomplete; no live files are affected.

Extraction is restore **preparation**, not a live restore. Before an independently authorized restore, stop the website and every other writer, preserve the current complete data and key, review pending provider operations, verify all seven replacement files, and compare an isolated restored instance. A local database restore never reverses a real Proradius action or real cash/Whish movement. Older data may omit actions already performed outside the restored snapshot; reconcile them before enabling provider writes. Do not start an older code version on newer data without a tested compatible snapshot.

## Eventual cutover and rollback boundary

The Main PC stays running now. A live transfer, downtime, deployment, installation or provider activation requires a later concrete cutover decision. At that time, record financial baselines and unresolved operations, stop all desktop writes, take one final verified all-seven snapshot, preserve the original Main installation/data, transfer into the new private website volume, rehearse the final migration, then compare the agreed baselines before granting website access. Never run the original desktop and migrated website as simultaneous independent financial authorities.

Only after the transfer and secure credential re-entry are approved should the operator set `PROVIDERS_ENABLED=true`, restart the single backend and verify the dedicated API account without performing an unintended renewal/transfer. Do not use staged/copied data with live providers. Keep the original Windows credential/recovery material safe; it is not part of the public release.

The backend owns an exclusive `.fibernetlb-web.lock` in its data directory. A clean shutdown drains requests and removes its own lock. After a crash the lock intentionally remains. Never automatically delete it: first stop all services, verify the recorded process and host and rule out any other writer; only then may an operator remove an abandoned lock. A forced container kill can interrupt an operation, so the Compose grace period is 12 minutes. Inspect pending journals after any unclean stop.

Rollback after website activity is a financial reconciliation decision, not simply starting the old Main again. Preserve newer website data and resolve all provider and local pending outcomes before choosing an authoritative snapshot. Do not overwrite the newer data with an older backup or assume external actions were reversed.

## Validation status

The Windows development environment ran Node 24 security and real-core HTTP tests using fictional temporary databases, including private-file blocking, CSRF/Origin checks, session boundaries, encrypted secret tamper detection, provider-disabled behavior and complete encrypted-backup verification. Use the accompanying release validation report and linked GitHub run for the exact Ubuntu image/test results and source revision. Passing CI is separate from acceptance on the chosen business server. DNS, certificate issuance, production load, live providers, copied customer data, physical printers and Safari/devices require their own staging checks before scheduling cutover.

The prepared workflow `.github/workflows/website-tests.yml` assumes the repository application is at `web/`. When integrating the package into that repository, place the workflow at the repository's **root** `.github/workflows/website-tests.yml`, not inside `web/.github/`. It runs Node 24 tests with genuine Chrome, validates Compose, builds the production image and calls `tools/container-smoke.cjs`. The smoke tool creates only fictional databases/random test credentials. The accounting container has only an internal Docker network and never publishes a port; a separate fixture-only proxy joins that network and an ingress bridge and publishes only a host-loopback port. The proxy has no private-file mounts, provider credentials, request-body logging or automatic retries. This arrangement preserves outbound isolation of accounting while exercising the real cookie/Origin/CSRF gateway. Docker intentionally does not publish ports for an internal-only container. The tool verifies the default non-root user, disabled providers, private-file denial, exclusive writer, incomplete-data refusal and persisted cash/session behavior across a clean restart. It never deploys or selects existing production storage. Its full Ubuntu results must be observed before claiming that environment has passed.
