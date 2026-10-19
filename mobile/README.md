# FIBER net lb mobile — 0.1.0 pilot

Flutter/Dart companion for Android and iPhone. This first working pilot follows
the approved navy/blue/orange dashboard and renewal-screen designs. It is not
the complete Windows application's feature set or a store-ready release.

## Working in this pilot

- HTTPS server connection, existing staff login, business-bound sessions,
  permitted business selection, refresh and sign-out.
- Admin, Cashier and Support layouts. Other staff roles are explicitly refused
  rather than treated as Cashiers.
- Server-calculated dashboards, gross Whish balances, profit-only fees,
  authoritative before/after Other expenses totals and unavailable-data states.
- Customer search, reseller account reads, monthly bills, receipt/activity
  lists and recorded detail views, subject to the server's permissions.
- Separate payment and renewal status. A paid bill is not proof of renewal.
- An isolated, clearly labelled design preview with sample Admin/Cashier/Support
  dashboards and renewal review/success/incomplete screens. Preview never
  constructs a network client or changes real records.
- Android Material selection pills and the approved iPhone underline navigation.
  Responsive light/dark components, larger-text checks and real Flutter captures.

## Deliberately not active yet

Real renewal/creation, Add Money, Refund, Pay bill, cash/wallet movements, supplier
payments, POS, stock edits, expense edits, staff administration, receipt sharing
and native printing are not enabled in this pilot. Their absence is explicit;
disabled buttons never simulate a live financial success.

Before enabling phone financial writes, add and test a matched Main-side durable
prepare/submit/status intent contract. Current desktop 1.43.4 does not expose a
reliable request-ID status read, and a missing bill after a timeout does not prove
that a request was cancelled. Phone app closure, retries or a lost response must
never create a second charge. Pending intent state also needs protected durable
storage on the phone. Provider credentials remain on Main, never in the app.

## Connecting to the existing system

This build supports the verified desktop **1.43.4** RPC contract only. It sends
the exact supported desktop contract version, not the mobile marketing version.
It refuses unknown server versions and does not silently guess compatibility.

For normal use, enter a trusted HTTPS base address supplied by the administrator. The gateway
must preserve `/health`, `/rpc`, HTTP status codes and authorization headers,
with a valid device-trusted TLS certificate. A public IP or plain HTTP address
alone does not encrypt a connection. No certificate-validation bypass is provided.

At the user's explicit request, the Android debug pilot can instead be built
with one temporary HTTP IPv4 endpoint using `tool/build-android.ps1
-TemporaryHttpEndpoint <base-address>`. This is unencrypted: passwords, session
tokens and data can be intercepted or modified in transit. The sign-in screen
requires a fresh unchecked warning/consent before sending credentials, and the
workspace keeps an insecure-connection warning visible. The exception is not
available on iPhone, web or release builds. Both native debug policy and Dart
validation restrict it to the configured address; endpoint edits reset consent.
It is not a certificate bypass and does not turn HTTP into HTTPS. Use disposable
test credentials/data until a secure endpoint is configured. This work never
signs into the live system on the user's behalf.

The app and server keep one central database/accounting system. The Main PC app
must be running and reachable. This work did not configure a public gateway,
log into the live Main PC, migrate live databases or contact a real provider.
The existing server retains its normal behavior when read: for example,
`finance:overview` may refresh an existing receipt policy and reseller reads may
synchronize names. The mobile adapter exposes no financial write channel.

Passwords and tokens stay in memory and are not persisted or logged. Sign-out
clears local private views immediately and attempts server revocation. When the
app resumes, it revalidates the session through refresh. A network-only failure
can retain the last same-business snapshot with a visible stale-data warning;
permission/session failures remove private cached data. No offline financial
queue is implemented. A restarted app requires sign-in again.

## Android pilot

The delivery APK is a **debug-signed ARM64 test build**, not a Play Store release.
Minimum Android API 24; compile/target API 36. The provisional app identifier is
`net.fibernetlb.bills.mobile`. Confirm ownership before reserving store records.

Nothing is installed automatically. Transfer the APK to a compatible test phone
and use Android's normal package installer if you choose to install it. Review
any system prompt. Do not enable unrelated installation sources or weaken TLS.
Start with **Preview design** to inspect fictional data without a server.

Release signing is intentionally unconfigured. Private keys and store accounts
belong to the business and must not be committed, shared in chat or packaged.

## iPhone status

The same Dart source and iOS project are included, with iOS 15 minimum and strict
App Transport Security. The iPhone UI has been rendered in Flutter tests on this
Windows computer; it has **not** been compiled, signed, installed or tested on an
iPhone. A Mac/Xcode environment, real iPhone testing and business-owned signing
are still needed. There is no IPA or TestFlight/App Store submission in this pilot.

## Development and verification

Validated with Flutter 3.47.7 / Dart 3.13.5. Flutter source is pinned to the
official stable commit `abaf9c523780a608bd46686fd5e53740a07077f8`.
Dependencies are locked in `pubspec.lock`. No downloaded SDK/cache belongs in
the source archive.

```text
flutter pub get
flutter analyze
flutter test --reporter expanded
node tool/mock_server_test.cjs
node tool/generate_brand_icons.cjs
flutter build apk --debug --target-platform android-arm64
```

`tool/build-android.ps1` configures the workspace-local Android SDK and installed
JDK for its process only, runs checks, then builds the pilot. Adjust the JDK path
on another development machine. Android SDK licenses must be approved by the
person responsible for that machine. This user explicitly approved the local
SDK installation and standard development license for this build.

`tool/mock_server.cjs` is a loopback-only synthetic server, not a production
backend. It rejects financial writes and uses visibly fictional demo accounts.
The fixture's HTTP access uses an explicitly enabled loopback test configuration,
separate from the administrator-approved temporary Android endpoint. The normal
app requires HTTPS. Never expose the fixture to
the Internet or use its credentials in production.

Generated captures/logs live under `qa-results/` and are excluded from source.
Source delivery must also exclude build/.dart_tool, local.properties,
Generated.xcconfig, flutter_export_environment.sh, ephemeral folders, private
keys, local databases, developer profiles and SDK/Gradle caches. The public
signature certificate embedded in a signed APK is not a private signing key.

Neither store has received this app. Store privacy/reviewer/demo environment,
production signing, security hardening, complete financial flows and native
device validation remain separate work before a production release.

## Prepared cloud-Mac iOS compilation — not yet run

This local delivery now includes a **manual, unsigned cloud-build template**.
No mobile source has been uploaded, no cloud job has been started and no Apple
account or payment has been created by preparing these files. The user's
approval is required before publishing mobile source or starting a hosted job;
review the selected account's current runner allowance/billing first.

The future repository layout is:

```text
.github/workflows/ios-preview.yml    # copy this project's template here
mobile/                            # reviewed mobile source, not build caches
  pubspec.yaml
  lib/
  ios/
  tool/build-ios.sh
```

GitHub only discovers the workflow at the repository root, not under
`mobile/.github/`. After the source and workflow are explicitly approved and
published, a repository maintainer can use **Actions → iOS unsigned preview →
Run workflow**, affirm the unsigned-output notice, and select both targets,
archive only or simulator only. There are no push/PR triggers, signing inputs,
secrets or automatic store-upload steps. Token permissions are read-only;
GitHub-owned actions and official Flutter 3.47.7 are pinned to full commit IDs.

The template selects `macos-26` and Xcode 26.6 from the official hosted image.
It records the actual runner image, SDK and tool versions because hosted images
receive updates; this is not a promise of bit-identical binaries. See the
[official macOS runner inventory](https://github.com/actions/runner-images/blob/main/images/macos/macos-26-arm64-Readme.md).

On a prepared Mac, the same local command is `sh tool/build-ios.sh both`, with
`FLUTTER_ROOT` pointing to a clean checkout of commit
`abaf9c523780a608bd46686fd5e53740a07077f8`. The script checks the pinned SDK,
locked dependencies and strict iOS transport policy, runs analysis/tests, then
compiles without code signing. It refuses inherited temporary-HTTP overrides.
The iPhone app still requires HTTPS; Android's temporary HTTP test exception
does not carry over.

Successful output in `build/ios-preview/` contains an **unsigned `.xcarchive`
ZIP**, a **Mac-simulator-only `.app` ZIP** for the selected targets, logs,
build information, a warning file and a SHA-256 manifest. These are compile
evidence, **not an installable iPhone download or a signed IPA**. No simulator
launch or physical-iPhone test is implied. On a Mac, preserve an existing
`build/ios-preview/` folder before repeating the script; it will not overwrite it.

Unsigned compilation does not require Apple signing credentials. Installing on
real iPhones or distributing through TestFlight is separate work: use the
business-owned Apple Developer account, approved app identity, protected signing
credentials, device checks and the applicable Apple review process. Do not put
certificates, provisioning profiles, passwords or API keys in source or chat.
See [Flutter's iOS setup](https://docs.flutter.dev/platform-integration/ios/setup)
and [iOS release guide](https://docs.flutter.dev/deployment/ios).
