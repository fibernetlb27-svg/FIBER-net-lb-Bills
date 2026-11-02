# Prepare an additional domain without replacing IP access

Version 0.1.6 can serve the same accounting website through its existing IP origin and an explicitly configured HTTPS domain. Both use the same backend and seven databases. Keep the existing IP as `APP_ORIGIN`; add the chosen domain through `APP_ADDITIONAL_ORIGINS`. Do not create another accounting server, migrate data again, or redirect staff away from the working IP while the domain is being prepared.

The candidate files do not activate a domain. The exact name, DNS target and route must be confirmed first. The examples below use reserved documentation addresses; replace them with the actual approved values before preparing a candidate.

## Information needed from the ISP or domain administrator

- The exact fully qualified hostname, such as `accounts.example.com`, and who manages its DNS record.
- The public IPv4 address or public gateway that will receive this website's traffic. Do not assume it is an older application's public address. The Ubuntu server's private LAN address is a forwarding destination, not a public DNS target.
- An `A` record for that public IPv4 address. Add `AAAA` only when the corresponding public IPv6 route actually works. If the ISP uses a hostname/CNAME arrangement instead, have it confirm the final routed destination.
- Inbound TCP ports 80 and 443 routed to the existing Ubuntu Caddy gateway, with the host firewall permitting them. UDP 443 is optional for HTTP/3. With carrier-grade NAT, the ISP must provide a reachable public endpoint or explicit inbound mapping; changing DNS alone does not create one.
- A working return route and outbound DNS/HTTPS for certificate management. If LAN devices also use the domain, the network needs working NAT reflection or appropriate internal DNS pointing to the same gateway.

Caddy's standard public-certificate setup requires the hostname to resolve to the server and the certificate-validation ports to reach it. Its automatic HTTPS documentation describes these prerequisites and the available challenge methods. [Caddy automatic HTTPS](https://caddyserver.com/docs/automatic-https)

If DNS has CAA restrictions, the administrator should check that they permit the selected certificate issuer. Use the actual ISP's routing instructions when a proxy sits in front of Caddy. Do not solve a connection issue by disabling TLS validation or broadening the application's allowed hosts.

## Generate a candidate locally

From the public source folder, use Node 24:

```sh
node tools/prepare-domain-config.cjs --primary-origin https://192.0.2.40 --domain accounts.example.com --out /private/NEW-domain-candidate
```

On Windows, supply a new absolute Windows folder to `--out`. The separate optional `--server-directory` names where the candidate would later be staged on Ubuntu; the tool does not write to that Linux path. Its default is `/srv/fibernetlb/private/domain-candidate-<hostname>`. It accepts a single directory directly within `/srv/fibernetlb/private`.

The generator requires an exact DNS hostname and the existing HTTPS IPv4 origin on port 443. It rejects wildcard/local aliases, embedded paths, extra ports, configuration injection, duplicate arguments, existing output folders and output inside the public application package. Its scope is intentionally limited to the existing IP-primary deployment.

The new folder contains:

- `Caddyfile`: two exact HTTPS sites, with the existing IP using the internal CA and the domain using normal public certificate automation.
- `compose-domain-candidate.yaml`: the additional application origin, gateway hostname values and Caddyfile bind mount.
- `DOMAIN-CANDIDATE.json`: SHA-256 values and a record that activation, DNS, firewall and data changes were not performed.
- `README.md`: the candidate's exact origins, intended private staging directory and remaining operator checks.

The generator performs no network requests, SSH, service changes, certificate requests, database reads or application actions. A filesystem failure can leave the new candidate folder incomplete; existing files are never overwritten. Keep generated host-specific files private and outside the public release.

## Review the merged configuration

This candidate assumes there are no additional origins already configured. If aliases already exist, review and merge their exact HTTPS origins; applying the candidate's environment value would replace that alias list.

Append the candidate override after **all** currently active Compose files, preserving their order. Review the resolved configuration rather than starting the candidate as a separate project. It must keep:

- The existing primary `APP_ORIGIN`, private data and key mounts, provider switch and trusted proxy address.
- Exactly one accounting backend and the same Caddy gateway/network.
- Existing port bindings, shutdown grace period and container security limits.
- Both persistent Caddy certificate volumes. Keeping these volumes preserves the existing IP CA and device trust.
- The new exact domain in `APP_ADDITIONAL_ORIGINS`, and its corresponding exact Caddy site.

The full candidate Caddyfile uses separate site blocks and a shared backend snippet. The domain is additional; it does not rewrite Host or Origin, add CORS, enable on-demand TLS, add a wildcard site or configure retries of application requests. Caddy's configuration reference explains explicit site matching. [Caddy site addresses](https://caddyserver.com/docs/caddyfile/concepts#addresses)

Run Caddy's adapter against the candidate with the exact environment values before considering activation. An isolated `caddy adapt --config ... --adapter caddyfile` checks its syntax without starting a listener or requesting a certificate. Certificate readiness still requires the actual DNS, network route and later HTTPS checks; an adapted configuration alone is not acceptance. [Caddy adapter command](https://caddyserver.com/docs/command-line#caddy-adapt)

The example disables the Caddy admin API, matching a gateway managed through its container configuration. Do not expose an admin endpoint to enable reloads. Use the deployment operator's reviewed gateway replacement procedure after readiness is established.

## Activation and acceptance

Once the exact domain and route are ready, stage the candidate in its specified private Ubuntu directory and review it with the current deployment's configuration. Preserve the existing gateway configuration, volumes and working IP access for rollback. A backend restart to change allowed origins signs users out; tell staff to preserve any pending request reference and sign in again afterward.

Use the ordinary trusted HTTPS URL on each origin. The IP keeps its existing internal-CA trust requirement; the public domain should present a certificate trusted by normal clients. Caddy manages public DNS certificates and local IP certificates separately. [Caddy local and public HTTPS](https://caddyserver.com/docs/automatic-https)

Verify the following without recording a sale, payment or renewal:

- HTTP for the exact domain redirects to that domain's HTTPS address.
- The domain certificate matches the exact hostname and ordinary TLS validation succeeds.
- The original IP still loads and keeps its established certificate trust.
- Read-only website metadata and the expected version load through both origins.
- Unknown Host values are rejected. A domain Origin with an IP Host, or the reverse, is rejected for browser API calls.
- A session established on one origin cannot authenticate another origin. Staff sign in independently on the IP and domain.

Sessions remain host-only, origin-bound and protected by Secure/HttpOnly/SameSite cookies, CSRF tokens and the pinned application version. Adding an allowed domain does not turn the two origins into one shared browser session. A timeout never authorizes replaying a financial request; inspect the original saved result first.

If the domain fails, keep using the original IP and repair its DNS/certificate route. Remove only the reviewed alias/gateway configuration if rollback is necessary. Do not restore an older database, create a second writer or change provider credentials to fix a hostname problem.
