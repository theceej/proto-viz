# proto-viz workspace format

Workspace files are UTF-8 JSON and conventionally end in
`.proto-viz-workspace.json`. The current format version is `1`. The Workspace
page creates `workspace.proto-viz-workspace.json`; all processing stays in the
browser.

## Envelope and sections

The top-level object is:

```json
{
  "app": "proto-viz",
  "kind": "workspace",
  "version": 1,
  "exportedAt": "2026-07-26T12:00:00.000Z",
  "customProtocols": [],
  "savedStacks": [],
  "currentStack": {},
  "comparisons": [],
  "composedScenario": null
}
```

Only `app`, `kind`, `version`, and `exportedAt` are required. `exportedAt` is an
ISO date string. Every data section is optional; absence means "do not import
this category." A present empty array participates in the selected merge or
replace operation. A present `composedScenario: null` explicitly represents no
scenario and clears it when Scenario is set to Replace.

`customProtocols` contains complete `ProtocolDefinition` objects. Each has
`id`, `name`, `layerHint`, `fields`, `providesNamespaces`, `encapsulations`, and
`source: "custom"`; optional protocol properties are `fullName`, `description`,
`notes`, `references`, and `lintRules`. Fields have `id`, `name`, `type`, and
`bitLength`, with optional `default`, `enumRef`, `description`, `flags`,
`presentIf`, `decodeBitLength`, and `computed`. Field types are `uint`, `flags`,
`bytes`, `mac`, `ipv4`, `ipv6`, `string`, and `dnsName`. Layer hints are `link`,
`network`, `transport`, `application`, and `tunnel`.

`savedStacks` entries have `id`, `name`, `savedAt`, `layers`, `trailingPayload`,
and `expectedBytes`. `currentStack` has `layers`, `trailingPayload`, and
`expectedBytes`. A layer contains `protocolId`, an `overrides` object, and a
`pinned` field-ID array. Runtime layer UIDs are deliberately not stored and are
regenerated on import. `expectedBytes` is a serialization integrity snapshot;
an imported stack that does not reproduce it is rejected during planning.

`comparisons` contains at most two entries. Each has numeric `id`, `label`, and
`packet`. A packet contains `bytes`, `payloadOffset`, `layers`, `spans`, and
`issues`, matching proto-viz's serialized packet model. Packet layers contain
`uid`, `protocolId`, `byteOffset`, and `headerBytes`. Spans contain `layerUid`,
`fieldId`, `bitOffset`, `bitLength`, `value`, `computed`, and `pinned`. Issues
contain `severity` (`error` or `warning`), nullable `layerUid`, and `message`.

`composedScenario` is either `null` or an object with `version: 1`, `id`, `name`,
`description`, exactly two string `endpoints`, and `steps`. Each step has `id`,
`label`, endpoint indexes `fromEndpoint` and `toEndpoint` (0 or 1), non-negative
integer `atUsec`, a stack, and `expectedBytes` for that stack.

## Typed values

JSON numbers and strings represent ordinary field values. Values JSON cannot
represent directly use single-property tagged objects:

```json
{ "$bytes": "AAECAw==" }
{ "$bigint": "18446744073709551615" }
```

`$bytes` is canonical base64. `$bigint` is a base-10 integer string (optional
leading minus, no exponent or leading zeroes). Tags must contain exactly one
property. Byte arrays in payloads, packets, and expected-byte snapshots always
use `$bytes`.

Expression nodes are JSON ASTs. Supported `kind` values are `const` (`value`),
`field` (`fieldId`), `payloadBytes`, `headerBytes`, and `binop` (`op`, `left`,
`right`), where `op` is `+`, `-`, `*`, or `div`. Expression lengths contain
`expr` and `unit` (`bits` or `bytes`). Computed fields are `binding`, `expr`, or
`checksum`; checksums support `inet16` and `crc32c`, `header` or
`headerAndPayload` scope, and optional `ipv4`, `ipv6`, or `auto` pseudo-header.

## Import behavior

Import parses and validates the complete file before any write, then presents a
live plan. Just before Apply, IndexedDB is read again and the plan is rebuilt.
If saved protocols or stacks changed during review, Apply stops and the refreshed
plan must be reviewed again.

- Custom protocols: Merge keeps existing entries and adds incoming IDs. An ID
  conflict can Keep the existing definition or Overwrite it. Replace starts from
  an empty category, then imports the file.
- Saved stacks: Merge or Replace works the same way. ID conflicts can Keep,
  Overwrite, or Copy; Copy generates a unique `-copy` ID.
- Comparisons: Merge appends imported snapshots and retains the newest two.
  Replace uses the imported snapshots, also capped at two.
- Current Builder stack: Keep leaves the current stack in the prospective
  workspace; Replace restores the imported stack.
- Composed scenario: Keep leaves local storage unchanged; Replace writes the
  incoming scenario or clears it when the section is `null`.

Replace for custom protocols, saved stacks, or the composed scenario is
destructive and requires an extra confirmation. The two IndexedDB categories
are applied in one atomic transaction. The scenario is written only after that
succeeds. If its local storage write fails, proto-viz attempts to restore both
the prior IndexedDB snapshot and the exact prior raw scenario value. In-memory
library, comparison, and Builder state is updated only after durable writes
succeed.

Export automatically includes custom protocol definitions referenced by any
selected saved stack, current stack, comparison, or composed scenario, even when
the custom-protocol checkbox is off. Capture files and user-interface preferences
are never workspace sections.

## Limits and compatibility

- Source file/text: 10 MiB.
- Decoded binary across the workspace: 8 MiB.
- Custom protocols: 500; fields per protocol: 1,024.
- Saved stacks: 2,000; layers per stack: 64.
- Comparisons: 2; 16 KiB per comparison packet and 4,096 field spans.
- Stack payloads and expected-byte snapshots: 256 KiB per byte item.
- Scenario steps: 1,000.
- Strings: 256 KiB generally; IDs and short schema names: 200 characters.
- Expression depth: 32; expression nodes per expression: 1,024.

Unknown top-level sections in a version-1 file are ignored and shown as warnings,
which permits additive producers without silently treating unknown data as known.
Unknown properties inside typed section objects are not a compatibility promise.
A version newer than `1` is rejected rather than partially imported; older or
otherwise unsupported workspace versions are also rejected.

The legacy version-1 protocol-library shape is recognized when it has
`app: "proto-viz"`, `version: 1`, no `kind`, and a `protocols` array. It migrates
in memory to a custom-protocol-only workspace, uses the Unix epoch as its export
date, and displays a migration warning. The original file is not modified.
