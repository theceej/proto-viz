<p align="center">
  <img src="public/favicon.svg" width="80" alt="proto-viz logo — a stylized packet header" />
</p>

<h1 align="center">proto-viz</h1>

<p align="center">
  <a href="https://github.com/theceej/proto-viz/actions/workflows/ci.yml"><img src="https://github.com/theceej/proto-viz/actions/workflows/ci.yml/badge.svg" alt="CI" /></a>
  <a href="https://github.com/theceej/proto-viz/actions/workflows/security.yml"><img src="https://github.com/theceej/proto-viz/actions/workflows/security.yml/badge.svg" alt="Security" /></a>
  <a href="https://github.com/theceej/proto-viz/actions/workflows/deploy.yml"><img src="https://github.com/theceej/proto-viz/actions/workflows/deploy.yml/badge.svg" alt="Deploy" /></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-GPL--3.0-blue" alt="License: GPL-3.0" /></a>
  <a href="https://theceej.github.io/proto-viz/"><img src="https://img.shields.io/badge/demo-live-06b6d4" alt="Live demo" /></a>
</p>

A polished, fully client-side web app for exploring and visualising network
protocols and protocol stacks. Everything — protocol modeling, stack
validation, packet serialization, PCAP generation, and RFC parsing — runs in
your browser. Nothing is uploaded anywhere.

![Stack builder](docs/builder.png)

## Features

- **Protocol library** — Dozens of built-in protocols with full bit-level
  field layouts. Core: Ethernet II, 802.3 (LLC and SNAP), 802.1Q, ARP, IPv4,
  IPv6 (with Hop-by-Hop, Routing, Fragment, and Destination Options extension
  headers), ICMP, ICMPv6 (incl. NDP and MLDv2), IGMP v2/v3, TCP, UDP, SCTP,
  EAPOL/802.1X. Infrastructure: STP, LLDP, CDP, VRRP, HSRP, RIPv1/v2,
  EIGRP, OSPF, IS-IS, BGP, BFD, PIM,
  NetFlow v5. Applications: EAP, DNS, mDNS, LLMNR, NBNS, DHCP, DHCPv6, HTTP/1.1,
  HTTP/2, WebSocket, TLS record, QUIC, NTP, TFTP, RADIUS, STUN, RTP, RTCP,
  SIP, RTSP, MQTT, CoAP, Modbus TCP, SMB2, FTP, SMTP, POP3, IMAP, Telnet,
  IRC, Syslog, SSDP. Tunnels & VPN: GRE, VXLAN, GENEVE, MPLS, GTP-U, IPsec
  AH/ESP, WireGuard, PPPoE, L2TP. RFC references in the library link to the
  full documents. The library is searchable, groups protocols by layer with
  an OSI-model overlay, and can be re-sorted into a flat A–Z list.
- **Stack builder** — compose arbitrary stacks (VXLAN overlays, Q-in-Q,
  GRE tunnels, MPLS label stacks…). Validity is checked from a generic
  binding model (EtherType / IP protocol / port assignments): illegal
  layerings are explained ("TCP cannot follow Ethernet II: Ethernet selects
  its payload via EtherType, and TCP has no assignment there"), and carrier
  selector fields are auto-set from the layer above them. Stacks can be
  saved to the browser (IndexedDB) and reloaded, including field edits and
  payload. A dice button generates a random stack via a random walk over
  the binding graph — always valid by construction — and the payload editor
  can fill itself with random bytes. Any stack of built-in protocols can be
  shared as a short word code (a What3Words-style handle: Ethernet › IPv4 ›
  TCP becomes `army.borrow.advice`) drawn from the BIP-39 wordlist, with a
  checksum that rejects mistyped codes; the code also embeds in a link that
  opens the stack directly. The word code carries the layer structure only,
  while an optional "exact packet" link additionally restores every field
  edit and the payload. The decoder runs the other way: paste packet
  hex (Wireshark's "copy as hex stream", or the hex view's own copy
  button) and the stack is identified by walking the same binding model —
  computed fields that don't reproduce the pasted bytes, like a wrong
  checksum, are pinned so the exact packet is preserved.
- **Packet visualisation** — classic RFC-style 32-bit-per-row diagrams, a
  full-packet hex dump with layer tinting whose hex and ASCII columns toggle
  independently, and a typed field editor. Hovering a field highlights it in
  all views, and selecting one opens an inspector that explains its value and
  links its spec; an inspection-detail control (Compact / Explain / Deep)
  tunes how much interpretation the views show. Computed fields (lengths,
  IHL/data offset, checksums incl. TCP/UDP pseudo-header and SCTP CRC32c)
  update live and can be pinned to deliberate wrong values. A guided tour,
  restartable from Help, walks through the whole workflow.
- **PCAP export** — download classic pcap files: single packets or generated
  sequences (TCP three-way handshake, DNS query/response, ICMP ping pair,
  DHCP DORA) with coherent sequence numbers, flipped directions, and fresh
  checksums per packet.
- **Spec import** — upload an RFC or protocol spec as TXT, HTML, DOCX, or
  PDF. ASCII packet diagrams (including RFC 768's 1-char-per-bit style and
  DNS's 16-bit rows) are detected and parsed with confidence scoring, then
  reviewed in an editable form with a live diagram preview before joining
  the library. Custom protocols persist in IndexedDB and can be exported /
  imported as JSON. Legacy binary `.doc` is detected and rejected with
  guidance (it cannot be parsed in-browser).

## Running

```bash
npm install
npm run dev            # Development server
npm test               # Run the Vitest unit suite
npm run test:coverage  # Run the Vitest suite with V8 coverage
npm run test:e2e       # Build and run Playwright browser/a11y tests
npm run test:tshark    # Validate exported PCAPs (requires tshark)
npm run build          # Static production build in dist/
npx serve dist         # Serve the production build locally
```

Spec references in the library link to their published source. Each family
resolves through a URL *template* containing `%s` — replaced by the reference
identifier, like a browser's keyword-search URL — which can be pointed at a
mirror at build time. Because the whole path is templated, a mirror can put
the number wherever it needs (a `.txt` suffix, no `rfc` prefix, and so on),
not just swap the host:

| Reference | Env var | Default template |
| --- | --- | --- |
| RFC | `VITE_RFC_BASE_URL` | `https://www.rfc-editor.org/rfc/rfc%s` |
| 3GPP TS | `VITE_3GPP_BASE_URL` | `https://www.3gpp.org/DynaReport/%s.htm` |
| Microsoft (MS-*) | `VITE_MS_SPECS_BASE_URL` | `https://learn.microsoft.com/openspecs/windows_protocols/%s/` |
| IEEE | `VITE_IEEE_BASE_URL` | `https://standards.ieee.org/search/?q=%s` |

```bash
# examples — use the IETF datatracker for RFCs and an IEEE mirror
VITE_RFC_BASE_URL=https://datatracker.ietf.org/doc/html/rfc%s \
VITE_IEEE_BASE_URL=https://standards.example.edu/ieee/%s \
  npm run build
```

An override without a `%s` is accepted as a legacy base URL — the family's
default deep-link tail is appended — so earlier base-only overrides keep
working. IEEE has no stable per-designation document URL (the real URLs use
internal ids), so the default template runs a standards search rather than a
direct link; a mirror can template a direct-link scheme instead. A few
one-off references (WireGuard whitepaper, MQTT/OASIS)
link to their single canonical source; others without a public spec URL
(Cisco, Modbus, UPnP) stay as plain text.

The build is fully static — host `dist/` on GitHub Pages (a deploy workflow
is included) or any static file server. Routing uses URL hashes, so no
server-side rewrites are needed. Note: the pdf.js worker requires an HTTP
origin, so PDF import doesn't work when opening `index.html` via `file://`;
use `npx serve dist` instead.

The production build is also an installable progressive web app. After one
successful load, the builder and protocol library can be reopened offline.
Updates are installed only after the in-app prompt is accepted, avoiding a
mix of assets from different releases. The comparatively large PDF and DOCX
import modules are not part of the initial offline download; each becomes
available offline after that import format has been used successfully once.
Uploaded documents, custom protocol data, and generated packet files are not
stored in the service-worker cache (custom protocols continue to use the
app's existing IndexedDB storage).

## Verifying generated PCAPs

Exported files are classic pcap (microsecond, little-endian). To verify:

- **Wireshark**: open the file. Enable checksum validation under
  *Preferences → Protocols → IPv4 / TCP / UDP → Validate checksums* — packets
  should show no malformed expert-info and checksums report `correct`.
- **tcpdump / tshark**:

  ```bash
  tcpdump -r export.pcap -vvv    # look for "cksum ... (correct)"
  tshark -r export.pcap -V
  ```

The unit suite includes byte-exact golden packets with hand-computed
checksums; the full library was additionally validated against `tcpdump`.

## Architecture

All protocol logic lives in pure TypeScript modules with no DOM
dependencies (`src/core`, `src/protocols`, `src/import`), unit-tested under
vitest's node environment:

- `core/model.ts` — `ProtocolDefinition` / `FieldDef` data model. Field
  layouts are bit-level; computed fields (expressions, checksums, binding
  auto-set) are declared as JSON-serializable ASTs so imported custom
  protocols persist cleanly.
- `core/serialize.ts` — three-pass serializer (layout → computed values →
  checksums, innermost-first where order matters) producing bytes plus a
  bit-exact field-span map that drives the hex view and hover linking.
- `core/bindings.ts` + `core/validate.ts` — the encapsulation model:
  protocols *provide* namespaces (EtherType, IP protocol, ports…) and
  *claim* membership; validation and palette filtering both derive from the
  intersection, and error messages are generated from the same data.
- `core/pcap.ts` / `core/scenarios.ts` — pcap writer and multi-packet
  scenario generators.
- `import/` — text extraction per format and the ASCII-diagram parser with
  confidence scoring.
- `ui/` — React + Tailwind interface; zustand stores; IndexedDB persistence.

## Accessibility

The app targets WCAG 2.2 AA. Text and borders meet contrast minimums in
dark and light mode. Everything is keyboard-operable: bit-grid fields are
focusable toggle buttons that drive the cross-view highlight, layers
reorder via their drag handle (Space to lift, arrows to move), dialogs
trap and restore focus and close on Escape, and validation results are
announced via a polite live region.

One place relies on WCAG 2.5.8's essential/equivalent-control provision,
and axe-core flags it mechanically because it can't see the equivalent:

- A packet diagram is bit-proportional by definition, so the narrowest
  fields (e.g. a 2-bit ECN or a 1-bit flag) render below the 24px target
  minimum and can't be widened without misaligning every column.

The same field is reachable through a full-size control:
the field editor lists every field with a highlight toggle that meets the
target size, so no function depends on a sub-minimum or pointer-only target.
Aside from those documented target-size items, both themes pass axe-core's
WCAG 2.x A/AA ruleset with zero violations.

To re-run the automated audit: build, serve `dist/`, and run axe-core
(installed as a dev dependency) against each route.

## Security

proto-viz has no server: uploads, custom protocols, and generated PCAPs never
leave the browser. The inputs it parses are still treated as untrusted:

- Uploaded specs are size-capped (20 MB); HTML/DOCX content is sanitized
  with DOMPurify, then parsed with the inert `DOMParser` (never injected
  into the page), and pdf.js (v6+, which has no eval path) parses PDFs in
  a worker. Legacy binary `.doc` is rejected outright.
- Imported library JSON is schema-validated with sanity caps (protocol/field
  counts, name lengths, field widths), and the serializer enforces
  per-field and per-packet allocation limits, so a hostile definition file
  can't hang the tab.
- The production build ships a same-origin Content-Security-Policy
  (`script-src 'self'`, `object-src 'none'`, …) as a `<meta>` tag, since
  GitHub Pages can't set headers.
- CI runs `npm audit` and CodeQL on every push and weekly
  (`.github/workflows/security.yml`); Dependabot watches npm and Actions.

To report a vulnerability, please open a GitHub security advisory rather
than a public issue.

## Contributing

Contributions are welcome — especially new protocol definitions, which
need no UI work at all. [CONTRIBUTING.md](CONTRIBUTING.md) walks through
the binding model, the definition format, and the four registration
points step by step.

## License

Copyright (C) 2026 proto-viz contributors.

This program is free software: you can redistribute it and/or modify it
under the terms of the GNU General Public License as published by the Free
Software Foundation, version 3. It is distributed in the hope that it will
be useful, but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
[LICENSE](LICENSE) file for the full text.
