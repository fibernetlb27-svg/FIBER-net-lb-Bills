# Guarded recovery after a power outage

This optional Ubuntu host service starts the existing accounting website after a host reboot when a verified old writer lock is the only startup blocker. It keeps the application's existing single-writer protection. It does not renew a service, change a customer plan, replay a payment, promote a `.pending` file or restore an older database.

The service runs after Ubuntu and Docker have started. It cannot turn on a powered-off computer or provide electricity. Configure the server or its virtualization host to power on after an outage separately if needed.

## Recovery behavior

The separate healthy-attestation service records the identity of the known healthy writer in a root-protected state file. Its evidence binds the host, canonical data directory, configured container and image, authoritative deployment record and exact writer-lock identity. The timer refreshes this evidence while the website is healthy.

At the next host boot, recovery leaves a healthy website running. It may archive an old lock only when the recorded healthy writer matches the current files and authority, the lock predates the new host boot, and no other writer is present. It stops the verified website container, checks other Docker mounts and host file handles, preserves current data and journals, and validates copies of all seven databases without external provider access. It rechecks the source files before archiving the abandoned lock and starting the same configured container. Recovery evidence and the archived lock remain private.

The guard refuses ambiguous conditions, including:

- Missing, altered or unreadable attestation; a different host, data directory, container, image or authority record.
- A foreign, malformed, changed, symlinked or same-boot writer lock.
- Shared or unproven storage, another data writer, inaccessible writer evidence or unsafe file permissions.
- Missing or damaged databases, interrupted `.pending` exports, invalid settings or unfinished financial intents.
- A failed checkpoint, changed source files, failed audit or failed health check.

These conditions require operator review. The guard preserves evidence and does not guess which data is authoritative. It is deliberately scoped to a verified host reboot; a process crash without a host reboot can require manual recovery.

Historical transition rows are not current pending operations. For example, earlier `checking` or `processing` rows in `internet_renewal_events`, `internet_plan_events` and `portal_operation_events` can remain after a request succeeded. The audit checks current request/intent state and preserves the transition history.

## Install on the authorized Ubuntu host

Install from the verified website source release. Do not copy customer databases, passwords or the server key into the source tree or a release archive.

The supplied units use these explicit host paths:

| Item | Path |
| --- | --- |
| Node 24 runtime | `/opt/fibernetlb/runtime/node24/bin/node` |
| Recovery program | `/opt/fibernetlb/power-recovery/power-recovery.cjs` |
| Read-only copied-data audit | `/opt/fibernetlb/power-recovery/power-recovery-audit.cjs` |
| Private configuration | `/etc/fibernetlb/power-recovery.json` |
| Permanent serialization lock | `/srv/fibernetlb/private/power-recovery.guard.lock` |

Install the program and audit bundle as root-owned files that ordinary application users cannot replace. Install configuration and private state with owner-only permissions. Keep the private data directory and its canonical files in their existing owner-only permissions; do not make customer files world-readable to resolve an audit failure.

Example private configuration:

```json
{
  "format": "FIBERNETLB-POWER-RECOVERY-CONFIG-1",
  "privateDirectory": "/srv/fibernetlb/private",
  "dataDirectory": "/srv/fibernetlb/private/live-data",
  "activeRecord": "/srv/fibernetlb/private/current-domain-access.json",
  "stateFile": "/srv/fibernetlb/private/power-recovery/healthy-writer.json",
  "jobsDirectory": "/srv/fibernetlb/private/power-recovery/jobs",
  "containerName": "fibernetlb-web-web-1",
  "auditScript": "/opt/fibernetlb/power-recovery/power-recovery-audit.cjs",
  "dockerBinary": "/usr/bin/docker",
  "serializationLock": "/srv/fibernetlb/private/power-recovery.guard.lock"
}
```

Adjust paths only as part of an explicit operator-reviewed deployment. The configuration is not a place for API credentials. The authoritative deployment record must identify the existing production container/image and data; this service does not create a replacement authority or start the old Main PC.

Install the three units under `/etc/systemd/system/`, preserving their names:

```sh
systemd-analyze verify /etc/systemd/system/fibernetlb-boot-recovery.service /etc/systemd/system/fibernetlb-recovery-attest.service /etc/systemd/system/fibernetlb-recovery-attest.timer
systemctl daemon-reload
```

Run syntax validation after the actual program, runtime and configuration paths exist. First verify that the existing website is healthy and explicitly record its writer:

```sh
systemctl start fibernetlb-recovery-attest.service
systemctl status fibernetlb-recovery-attest.service --no-pager
```

A successful attestation oneshot normally becomes inactive after completing. That is expected; it must not use `RemainAfterExit=yes` because its timer needs to activate it repeatedly. Read its exit status and journal, and verify that the private state was written successfully.

Only after the healthy writer has been attested, enable the boot service and timer:

```sh
systemctl enable fibernetlb-boot-recovery.service
systemctl enable --now fibernetlb-recovery-attest.timer
systemctl list-timers fibernetlb-recovery-attest.timer --no-pager
```

The boot recovery service is a completed oneshot that may remain active after success. Its bounded failure retry respects the website's twelve-minute shutdown grace period. The separate attestation timer uses monotonic scheduling, beginning after boot and then following inactive intervals; it does not depend on a calendar reminder or a browser being open.

Both commands hold the same permanent kernel `flock` while running. Never delete or replace that serialization-lock file during operation. The program verifies the actual kernel lock rather than trusting an environment flag.

## After a deployment or intentional restart

Once the new website container is healthy and the authoritative deployment record is committed, run `fibernetlb-recovery-attest.service` explicitly. The periodic timer is a secondary refresh, not a substitute for confirming the new writer before declaring a deployment complete. An unrecorded writer after a rapid subsequent power failure requires manual review.

Do not reset the attestation while a website is unhealthy. Changing a data directory, host or authority is a separate migration requiring a reviewed consistent copy and an explicit healthy enrollment.

## Operator checks after an outage

```sh
systemctl status fibernetlb-boot-recovery.service --no-pager
journalctl -u fibernetlb-boot-recovery.service -n 40 --no-pager
systemctl status fibernetlb-recovery-attest.timer --no-pager
```

Keep detailed checkpoints, source hashes, settings and journal reports private. Successful recovery means the configured container is healthy and the public website responds; it does not prove that an interrupted external financial operation failed. If recovery asks for review, retain the current databases and pending request IDs, inspect the original provider/request history, and use the existing reviewed recovery flow. Never submit a replacement payment or renewal simply because the site was unavailable.

Normal startup can mark an interrupted submitted request as uncertain and perform its existing read-only cost synchronization or scheduled backup checks. This guard does not submit replacement customer transactions. Existing automatic month-close rules and their journals remain in force.

## Verification scope

Release checks use fictional files and simulated host/container failures, plus isolated copied-data audit fixtures. Target installation should validate the real units, a healthy no-op recovery, attestation refresh, permissions and the public website. Do not cut power or reboot a production server just to test the feature while staff are using it; arrange a maintenance window for a full hardware reboot test if desired.

The unit behavior follows the upstream [systemd service documentation](https://raw.githubusercontent.com/systemd/systemd/v255/man/systemd.service.xml), [systemd timer documentation](https://raw.githubusercontent.com/systemd/systemd/v255/man/systemd.timer.xml) and [util-linux flock manual](https://man7.org/linux/man-pages/man1/flock.1.html).
