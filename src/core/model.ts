/**
 * Core data model for proto-viz.
 *
 * A ProtocolDefinition describes a protocol header as an ordered list of
 * fields with bit-level layouts, plus the "binding" metadata that says where
 * the protocol may sit in a stack (encapsulation claims) and how it selects
 * its own payload (provided namespaces).
 *
 * Everything here is plain JSON-serializable data (expressions are ASTs, not
 * functions) so custom protocols parsed from uploaded specs can be persisted
 * to IndexedDB and re-loaded.
 */

export type FieldValue = number | bigint | Uint8Array | string;

/**
 * Arithmetic expression AST used by computed fields and variable lengths.
 *
 * Restrictions (deliberate, keeps evaluation a single sweep):
 * - `field` may only reference non-computed fields of the same layer.
 * - Length expressions may not reference `headerBytes` (circular).
 */
export type Expr =
  | { kind: 'const'; value: number }
  | { kind: 'field'; fieldId: string }
  | { kind: 'payloadBytes' }
  | { kind: 'headerBytes' }
  | { kind: 'binop'; op: '+' | '-' | '*' | 'div'; left: Expr; right: Expr };

export type ChecksumAlgorithm = 'inet16' | 'crc32c';

export type ComputedSpec =
  /** Value derived from an expression, e.g. IPv4 TotalLength = headerBytes + payloadBytes. */
  | { kind: 'expr'; expr: Expr }
  /** Checksum computed at serialization time. */
  | {
      kind: 'checksum';
      algorithm: ChecksumAlgorithm;
      scope: 'header' | 'headerAndPayload';
      /** Include an IP pseudo-header (TCP/UDP/ICMPv6). Looked up from the nearest enclosing IP layer. */
      pseudoHeader?: 'ipv4' | 'ipv6' | 'auto';
      /** RFC 768: a computed checksum of zero is transmitted as all ones. */
      zeroSubstitute?: boolean;
      /** Store the value little-endian (SCTP's CRC32c, RFC 4960 appendix B). */
      littleEndian?: boolean;
    }
  /**
   * Value auto-set from the *next* layer's encapsulation claim in the
   * namespace this field selects (e.g. Ethernet EtherType, IPv4 Protocol).
   */
  | { kind: 'binding' };

export type FieldType =
  | 'uint' // unsigned integer, MSB-first, 1..64 bits
  | 'flags' // uint with named bits
  | 'bytes' // raw bytes, byte-aligned
  | 'mac' // "02:00:00:00:00:01", 48 bits
  | 'ipv4' // "192.0.2.1", 32 bits
  | 'ipv6' // "2001:db8::1", 128 bits
  | 'string' // ASCII/UTF-8 text, byte-aligned, variable length
  | 'dnsName'; // DNS label encoding ("example.com" -> 07example03com00)

export type BitLength =
  | number
  | { expr: Expr; unit: 'bits' | 'bytes' }
  /** Length follows from the field's own value (bytes/string/dnsName only). */
  | 'auto';

export interface FlagBit {
  /** Bit position within the field, 0 = most significant bit. */
  bit: number;
  name: string;
  description?: string;
}

export interface FieldDef {
  /** Stable identifier within the protocol, e.g. 'ihl'. */
  id: string;
  /** Display name, e.g. 'IHL'. */
  name: string;
  bitLength: BitLength;
  type: FieldType;
  default?: FieldValue;
  /** Key into the registry's enum tables; shown as a dropdown in the UI. */
  enumRef?: string;
  /** For type 'flags'. */
  flags?: FlagBit[];
  /** Computed fields are read-only in the UI unless the user pins an override. */
  computed?: ComputedSpec;
  /** Field only present when this expression evaluates truthy. */
  presentIf?: Expr;
  /**
   * How to size an `'auto'`-length field when decoding wire bytes, where the
   * serializer's value-derived length is unavailable (e.g. IPv4 options:
   * (IHL - 5) * 4 bytes). Unlike layout expressions, this may reference
   * computed fields — their values are read from the wire. Serialization
   * ignores it.
   */
  decodeBitLength?: { expr: Expr; unit: 'bits' | 'bytes' };
  description?: string;
}

/** A named value table, e.g. EtherTypes or IP protocol numbers. */
export interface EnumTable {
  id: string;
  name: string;
  values: Record<number, string>;
}

/**
 * A demultiplexing namespace a protocol provides for its payload.
 * `selectorFieldId: null` means the protocol carries its payload opaquely
 * (nothing in the header says what follows), e.g. TLS application data.
 */
export interface BindingNamespace {
  id: string;
  displayName: string;
  selectorFieldId: string | null;
}

/** "This protocol may sit inside `namespaceId`, selected by `value`." */
export interface EncapsulationClaim {
  namespaceId: string;
  /** Absent for claims on opaque namespaces. */
  value?: number;
  /** Marks conventional rather than field-driven layering (HTTP over TLS). */
  conventional?: boolean;
}

export type SemanticRuleSeverity = 'warning' | 'advisory';

interface SemanticRuleBase {
  fieldId: string;
  severity: SemanticRuleSeverity;
  code: string;
  message: string;
  /** Human-readable source, resolved through the protocol reference modules in the UI. */
  reference?: string;
}

/** JSON-serializable semantic checks evaluated after a packet has serialized. */
export type SemanticLintRule =
  | (SemanticRuleBase & {
      kind: 'value';
      operator: 'equals' | 'notEquals';
      value: number;
    })
  | (SemanticRuleBase & { kind: 'bitsClear'; mask: number })
  | (SemanticRuleBase & { kind: 'incompatibleBits'; leftMask: number; rightMask: number })
  | (SemanticRuleBase & { kind: 'sourceAddress'; family: 'ipv4' | 'ipv6' })
  | (SemanticRuleBase & { kind: 'zeroWhenCarriedBy'; protocolId: string })
  | (SemanticRuleBase & { kind: 'payloadBindingMismatch' })
  | (SemanticRuleBase & { kind: 'wellKnownPayload' });

export type LayerHint = 'link' | 'network' | 'transport' | 'application' | 'tunnel';

export interface ProtocolDefinition {
  id: string;
  name: string;
  /** Longer display name, e.g. 'Internet Protocol version 4'. */
  fullName?: string;
  layerHint: LayerHint;
  fields: FieldDef[];
  providesNamespaces: BindingNamespace[];
  encapsulations: EncapsulationClaim[];
  /** Advisory checks for encodable but suspicious field values. */
  lintRules?: SemanticLintRule[];
  source: 'builtin' | 'custom';
  /** e.g. ['RFC 791']. */
  references?: string[];
  description?: string;
  notes?: string;
}

/** One layer in a composed stack. The same protocol can appear twice (tunnels). */
export interface LayerInstance {
  uid: string;
  protocolId: string;
  /** User-edited field values; anything absent uses defaults / computed values. */
  overrides: Record<string, FieldValue>;
  /** Computed fields the user has manually overridden (override value wins). */
  pinned: string[];
}

export interface StackInstance {
  layers: LayerInstance[];
  /** Opaque payload bytes appended after the innermost layer. */
  trailingPayload?: Uint8Array;
}

let uidCounter = 0;

export function newLayer(protocolId: string): LayerInstance {
  uidCounter += 1;
  return { uid: `layer-${uidCounter}-${protocolId}`, protocolId, overrides: {}, pinned: [] };
}
