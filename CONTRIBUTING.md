# Contributing to proto-viz

Thanks for your interest! The most valuable contribution is usually a new
protocol definition, so most of this guide walks through that end to end.
Bug fixes, accessibility improvements, and better RFC parsing are equally
welcome.

## Getting started

```bash
git clone https://github.com/theceej/proto-viz.git
cd proto-viz
npm install
npm run dev      # development server
npm test         # vitest suite — must stay green
npm run build    # tsc + production build
npx eslint .     # lint — must be clean
```

Prefer containers? The repo ships a [dev container](.devcontainer/devcontainer.json)
(Node 22, same as CI): open the folder in VS Code and choose *Reopen in
Container*, or use GitHub Codespaces — dependencies install automatically and
the vite dev/preview ports are forwarded.

Everything is TypeScript under `strict` (including `noUncheckedIndexedAccess`).
Protocol logic lives in pure modules with no DOM dependencies (`src/core`,
`src/protocols`, `src/import`); the React UI consumes them. See the
Architecture section of the README for the map.

## Adding a protocol

A protocol is one data structure: a `ProtocolDefinition` describing its
fields bit by bit plus how it nests inside other protocols. No UI work is
needed — the builder, diagrams, hex view, validation, random stacks, and
sharing all derive from the definition.

### 1. Understand the binding model

Encapsulation is expressed through *namespaces*:

- A protocol **provides** a namespace when it has a field that selects its
  payload. Ethernet provides `ethertype`, IP provides `ip-proto`, UDP
  provides `udp-dstport`. Opaque carriers (VXLAN, TLS) provide a namespace
  with `selectorFieldId: null`.
- A protocol **claims** the namespaces it can be carried in, with the value
  that selects it: IPv4 claims `{ ethertype: 0x0800 }`, `{ ip-proto: 4 }`,
  `{ gre-proto: 0x0800 }`, …

Stack validation is the intersection of provided and claimed namespaces,
and selector fields (EtherType, Protocol, ports) are auto-set from the
layer that follows — both driven entirely by this data. Namespace ids live
in `NS` in [src/core/bindings.ts](src/core/bindings.ts); add a new one only
when a protocol genuinely introduces a new selection mechanism (SNAP PIDs
and LLC SAPs each earned one).

### 2. Write the definition

Create `src/protocols/<id>.ts`. A trimmed real example:

```ts
import type { ProtocolDefinition } from '../core/model';
import { NS } from '../core/bindings';
import { E } from '../core/expr';

export const rtcp: ProtocolDefinition = {
  id: 'rtcp',                       // stable, kebab-case, never reused
  name: 'RTCP',
  fullName: 'RTP Control Protocol (Sender Report)',
  layerHint: 'application',         // link | network | transport | application | tunnel
  source: 'builtin',
  references: ['RFC 3550'],         // "RFC N" strings auto-link in the library
  description: '…what it is, and any modeling simplifications…',
  fields: [
    { id: 'version', name: 'V', type: 'uint', bitLength: 2, default: 2 },
    // …
    {
      id: 'length', name: 'Length', type: 'uint', bitLength: 16,
      computed: { kind: 'expr', expr: E.sub(E.div(E.add(E.headerBytes(), E.payloadBytes()), E.const(4)), E.const(1)) },
      description: 'Packet length in 32-bit words, minus one.',
    },
  ],
  providesNamespaces: [],
  encapsulations: [{ namespaceId: NS.udpDstPort, value: 5005 }],
};
```

Field essentials:

- **Types**: `uint`, `flags` (with a `flags` array; bit 0 is the MSB),
  `bytes`, `mac`, `ipv4`, `ipv6`, `string`, `dnsName`. `bitLength` is in
  bits and may be `'auto'` for variable-length string/bytes fields.
- **Computed fields** (`computed`) come in three kinds: `expr` (lengths and
  counts, via the `E` helpers — expressions may reference same-layer fields,
  `headerBytes()`, and `payloadBytes()`), `checksum` (`inet16` or `crc32c`,
  with optional IPv4/IPv6 pseudo-header), and `binding` (auto-set from the
  next layer's claim — use this for every selector field).
- **`presentIf`** makes a field conditional on another (see GRE's optional
  checksum).
- **Defaults must be deterministic** — fixed example values, documentation
  addresses (RFC 5737 IPs, locally administered MACs), no randomness or
  clock reads. Golden tests depend on it.
- Enum tables (`enumRef`) live in [src/protocols/enums.ts](src/protocols/enums.ts);
  extend `well-known-port` / `ip-proto` / `ethertype` when your protocol
  registers a value there.

**Model honestly.** If the real protocol has variable-length constructs the
model can't express (TLV chains, varints, >125-byte WebSocket frames), pick
a representative fixed shape and say so in the `description` — see LLDP,
MQTT, and RIPv2 for the pattern. Text protocols (FTP, SIP, …) are editable
templates like HTTP/1.1. Protocols that are mostly ciphertext (QUIC, SSH
transport) or ASN.1/BER (SNMP, LDAP) generally don't model well — ask in an
issue first.

### 3. Register it — three places

1. Import and append in [src/protocols/index.ts](src/protocols/index.ts).
2. **Append** the id to `SHARE_PROTOCOL_IDS` in
   [src/core/share.ts](src/core/share.ts). This table is append-only:
   positions are baked into every share code ever issued. Never reorder,
   insert, or remove — a test pins known positions and will fail loudly.
3. Add a carrier stack for it in the `STACKS` map of
   [src/protocols/roundtrip.test.ts](src/protocols/roundtrip.test.ts).
   A registry-wide test fails if any built-in protocol lacks one; each
   stack is validated, serialized, and byte-round-tripped automatically.

### 4. Test the interesting parts

The round-trip suite covers the basics for free. Add spot checks in
`roundtrip.test.ts` for anything with mechanics: checksum correctness
(verify ones-complement independently — see the VRRP and CDP checks),
binding auto-set values, computed lengths, `presentIf` growth. If you have
tcpdump or Wireshark, export a PCAP from the builder and confirm the
dissector agrees — that has caught real bugs here.

### 5. Before opening the PR

```bash
npm test && npx eslint . && npm run build
```

All three must pass — CI runs the same steps on every pull request (plus
`npm audit` and CodeQL), and the checks are required before a PR can
merge. Keep the definition style consistent with neighbouring files
(field description strings, defaults, ordering).

## Other contributions

- **Import/parsing**: the ASCII-diagram parser (`src/import/diagram.ts`) is
  fixture-driven — add a real RFC excerpt to `fixtures/` with expected
  fields when improving it.
- **UI**: the app is dark-first; light mode works by remapping CSS
  variables in `src/index.css`, so never hard-code colors per theme. The
  app targets WCAG 2.2 AA — new interactive elements need accessible names,
  keyboard operation, and (for dialogs) focus trapping via the helpers in
  `src/ui/a11y.ts`. Run axe-core (a dev dependency) against a built page
  when touching UI.
- **Security**: uploads and imported JSON are untrusted input — keep size
  caps and schema validation intact. Report vulnerabilities privately via
  GitHub's security advisories, not public issues.

## License

proto-viz is GPL-3.0. By contributing you agree your work is licensed under
the same terms. Add yourself to no headers — copyright stays with
"proto-viz contributors".
