import type { CapturePacket } from './capture';

export type FilterASTNode =
  | { kind: 'protocol'; protocolId: string }
  | {
      kind: 'fieldComparison';
      field: string;
      op: '==' | '!=' | '>' | '<' | '>=' | '<=';
      value: string;
    }
  | { kind: 'logical'; op: 'and' | 'or'; left: FilterASTNode; right: FilterASTNode }
  | { kind: 'not'; expr: FilterASTNode }
  | { kind: 'text'; term: string };

export interface ParseFilterResult {
  ast: FilterASTNode | null;
  error: string | null;
  isDisplayFilter: boolean;
}

export interface CompletionItem {
  completion: string;
  label: string;
  detail: string;
}

const COMMON_FIELDS = [
  { field: 'ip.src', detail: 'Source IPv4 address' },
  { field: 'ip.dst', detail: 'Destination IPv4 address' },
  { field: 'ip.addr', detail: 'Source or destination IPv4 address' },
  { field: 'ip.proto', detail: 'IPv4 protocol number (6=TCP, 17=UDP, 1=ICMP)' },
  { field: 'ipv6.src', detail: 'Source IPv6 address' },
  { field: 'ipv6.dst', detail: 'Destination IPv6 address' },
  { field: 'ipv6.addr', detail: 'Source or destination IPv6 address' },
  { field: 'eth.src', detail: 'Source MAC address' },
  { field: 'eth.dst', detail: 'Destination MAC address' },
  { field: 'eth.addr', detail: 'Source or destination MAC address' },
  { field: 'eth.type', detail: 'EtherType (e.g. 0x0800, 0x86dd)' },
  { field: 'tcp.srcport', detail: 'TCP source port' },
  { field: 'tcp.dstport', detail: 'TCP destination port' },
  { field: 'tcp.port', detail: 'TCP source or destination port' },
  { field: 'udp.srcport', detail: 'UDP source port' },
  { field: 'udp.dstport', detail: 'UDP destination port' },
  { field: 'udp.port', detail: 'UDP source or destination port' },
  { field: 'frame.len', detail: 'Frame captured length in bytes' },
  { field: 'frame.number', detail: 'Packet number' },
];

const COMMON_PROTOCOLS = [
  'tcp',
  'udp',
  'dns',
  'dhcp',
  'icmp',
  'icmpv6',
  'arp',
  'ip',
  'ipv4',
  'ipv6',
  'eth',
  'ethernet',
  'http',
  'tls',
  'quic',
  'bgp',
  'ospf',
  'vlan',
  'vxlan',
  'gre',
  'mpls',
  'ntp',
  'tftp',
  'radius',
  'syslog',
];

interface Token {
  type: 'IDENT' | 'STRING' | 'NUMBER' | 'OP_COMP' | 'OP_LOGICAL' | 'NOT' | 'LPAREN' | 'RPAREN';
  value: string;
  pos: number;
}

function tokenize(input: string): { tokens: Token[]; error: string | null } {
  const tokens: Token[] = [];
  let i = 0;

  while (i < input.length) {
    const ch = input[i]!;

    if (/\s/.test(ch)) {
      i++;
      continue;
    }

    if (ch === '(') {
      tokens.push({ type: 'LPAREN', value: '(', pos: i });
      i++;
      continue;
    }

    if (ch === ')') {
      tokens.push({ type: 'RPAREN', value: ')', pos: i });
      i++;
      continue;
    }

    // Comparison operators
    if (input.startsWith('==', i) || input.startsWith('!=', i) || input.startsWith('>=', i) || input.startsWith('<=', i)) {
      tokens.push({ type: 'OP_COMP', value: input.slice(i, i + 2), pos: i });
      i += 2;
      continue;
    }

    if (ch === '>' || ch === '<') {
      tokens.push({ type: 'OP_COMP', value: ch, pos: i });
      i++;
      continue;
    }

    // Logical operators
    if (input.startsWith('&&', i)) {
      tokens.push({ type: 'OP_LOGICAL', value: 'and', pos: i });
      i += 2;
      continue;
    }

    if (input.startsWith('||', i)) {
      tokens.push({ type: 'OP_LOGICAL', value: 'or', pos: i });
      i += 2;
      continue;
    }

    if (ch === '!') {
      tokens.push({ type: 'NOT', value: '!', pos: i });
      i++;
      continue;
    }

    // Quoted strings
    if (ch === '"' || ch === "'") {
      const quote = ch;
      let j = i + 1;
      let str = '';
      while (j < input.length && input[j] !== quote) {
        str += input[j];
        j++;
      }
      if (j >= input.length) {
        return { tokens, error: `Unterminated string starting at position ${i}` };
      }
      tokens.push({ type: 'STRING', value: str, pos: i });
      i = j + 1;
      continue;
    }

    // Identifiers, numbers, IP addresses, MAC addresses
    let j = i;
    while (j < input.length && /[^\s()!=><&|]/.test(input[j]!)) {
      j++;
    }
    const val = input.slice(i, j);
    const lower = val.toLowerCase();

    if (lower === 'and') {
      tokens.push({ type: 'OP_LOGICAL', value: 'and', pos: i });
    } else if (lower === 'or') {
      tokens.push({ type: 'OP_LOGICAL', value: 'or', pos: i });
    } else if (lower === 'not') {
      tokens.push({ type: 'NOT', value: 'not', pos: i });
    } else if (['eq', 'ne', 'gt', 'lt', 'ge', 'le'].includes(lower)) {
      const opMap: Record<string, string> = {
        eq: '==',
        ne: '!=',
        gt: '>',
        lt: '<',
        ge: '>=',
        le: '<=',
      };
      tokens.push({ type: 'OP_COMP', value: opMap[lower]!, pos: i });
    } else if (/^\d+$/.test(val) || /^0x[0-9a-fA-F]+$/.test(val)) {
      tokens.push({ type: 'NUMBER', value: val, pos: i });
    } else {
      tokens.push({ type: 'IDENT', value: val, pos: i });
    }
    i = j;
  }

  return { tokens, error: null };
}

/** Parse Wireshark display filter tokens into AST. */
export function parseDisplayFilter(input: string): ParseFilterResult {
  const trimmed = input.trim();
  if (!trimmed) {
    return { ast: null, error: null, isDisplayFilter: false };
  }

  const { tokens, error: tokenError } = tokenize(trimmed);
  if (tokenError) {
    return { ast: null, error: tokenError, isDisplayFilter: false };
  }

  if (tokens.length === 0) {
    return { ast: null, error: null, isDisplayFilter: false };
  }

  let index = 0;
  const peek = () => tokens[index];
  const consume = () => tokens[index++];

  function parseExpr(): FilterASTNode {
    let left = parseAndExpr();
    while (peek()?.type === 'OP_LOGICAL' && peek()?.value === 'or') {
      consume();
      const right = parseAndExpr();
      left = { kind: 'logical', op: 'or', left, right };
    }
    return left;
  }

  function parseAndExpr(): FilterASTNode {
    let left = parseNotExpr();
    while (
      (peek()?.type === 'OP_LOGICAL' && peek()?.value === 'and') ||
      (peek() && peek()?.type !== 'RPAREN' && peek()?.type !== 'OP_LOGICAL')
    ) {
      if (peek()?.type === 'OP_LOGICAL' && peek()?.value === 'and') {
        consume();
      }
      const right = parseNotExpr();
      left = { kind: 'logical', op: 'and', left, right };
    }
    return left;
  }

  function parseNotExpr(): FilterASTNode {
    if (peek()?.type === 'NOT') {
      consume();
      const expr = parsePrimary();
      return { kind: 'not', expr };
    }
    return parsePrimary();
  }

  function parsePrimary(): FilterASTNode {
    const tok = peek();
    if (!tok) {
      throw new Error('Unexpected end of filter expression');
    }

    if (tok.type === 'LPAREN') {
      consume();
      const expr = parseExpr();
      const closing = peek();
      if (!closing || closing.type !== 'RPAREN') {
        throw new Error('Expected closing parenthesis ")"');
      }
      consume();
      return expr;
    }

    if (tok.type === 'IDENT' || tok.type === 'NUMBER' || tok.type === 'STRING') {
      const leftTok = consume()!;
      const next = peek();

      if (next && next.type === 'OP_COMP') {
        const opTok = consume()!;
        const valTok = peek();
        if (!valTok || (valTok.type !== 'IDENT' && valTok.type !== 'NUMBER' && valTok.type !== 'STRING')) {
          throw new Error(`Expected value after comparison operator '${opTok.value}'`);
        }
        consume();
        return {
          kind: 'fieldComparison',
          field: leftTok.value.toLowerCase(),
          op: opTok.value as '==' | '!=' | '>' | '<' | '>=' | '<=',
          value: valTok.value,
        };
      }

      // Check if identifier is a known protocol name or plain search term
      const lower = leftTok.value.toLowerCase();
      if (COMMON_PROTOCOLS.includes(lower)) {
        return { kind: 'protocol', protocolId: lower };
      }

      return { kind: 'text', term: leftTok.value };
    }

    throw new Error(`Unexpected token '${tok.value}'`);
  }

  try {
    const ast = parseExpr();
    const isDisplayFilter =
      tokens.some((t) => t.type === 'OP_COMP' || t.type === 'OP_LOGICAL' || t.type === 'NOT') ||
      (ast.kind === 'protocol');
    return { ast, error: null, isDisplayFilter };
  } catch (err: unknown) {
    return { ast: null, error: (err as Error).message, isDisplayFilter: true };
  }
}

/** Check if a parsed integer / hex number matches comparison. */
function compareNumbers(
  actual: number,
  op: '==' | '!=' | '>' | '<' | '>=' | '<=',
  expectedStr: string,
): boolean {
  const expected = expectedStr.startsWith('0x')
    ? parseInt(expectedStr, 16)
    : parseInt(expectedStr, 10);

  if (Number.isNaN(expected)) return false;

  switch (op) {
    case '==':
      return actual === expected;
    case '!=':
      return actual !== expected;
    case '>':
      return actual > expected;
    case '<':
      return actual < expected;
    case '>=':
      return actual >= expected;
    case '<=':
      return actual <= expected;
  }
}

/** Evaluate AST predicate over a decoded packet. */
export function matchesDisplayFilter(packet: CapturePacket, ast: FilterASTNode): boolean {
  switch (ast.kind) {
    case 'protocol': {
      const pid = ast.protocolId;
      return packet.protocolIds.includes(pid) || packet.topProtocol.toLowerCase() === pid;
    }

    case 'text': {
      const term = ast.term.toLowerCase();
      const haystack = `${packet.summary.toLowerCase()} ${packet.searchText}`;
      return haystack.includes(term);
    }

    case 'not': {
      return !matchesDisplayFilter(packet, ast.expr);
    }

    case 'logical': {
      const leftMatch = matchesDisplayFilter(packet, ast.left);
      if (ast.op === 'and') {
        return leftMatch && matchesDisplayFilter(packet, ast.right);
      }
      return leftMatch || matchesDisplayFilter(packet, ast.right);
    }

    case 'fieldComparison': {
      const f = ast.field;
      const v = ast.value.toLowerCase();
      const op = ast.op;

      // IP Address matching
      if (f === 'ip.src' || f === 'ip.src_host' || f === 'ipv6.src') {
        const src = packet.source?.toLowerCase() ?? '';
        return op === '!=' ? src !== v : src.includes(v);
      }
      if (f === 'ip.dst' || f === 'ip.dst_host' || f === 'ipv6.dst') {
        const dst = packet.destination?.toLowerCase() ?? '';
        return op === '!=' ? dst !== v : dst.includes(v);
      }
      if (f === 'ip.addr' || f === 'ip.host' || f === 'ipv6.addr') {
        const src = packet.source?.toLowerCase() ?? '';
        const dst = packet.destination?.toLowerCase() ?? '';
        const match = src.includes(v) || dst.includes(v);
        return op === '!=' ? !match : match;
      }

      // Ethernet MAC matching
      if (f === 'eth.src' || f === 'eth.dst' || f === 'eth.addr') {
        const haystack = packet.searchText.toLowerCase();
        const match = haystack.includes(v);
        return op === '!=' ? !match : match;
      }

      // Ethernet Type matching (e.g. eth.type == 0x0800)
      if (f === 'eth.type') {
        const ethTypeSpan = packet.packet?.spans.find((s) => s.fieldId === 'etherType');
        if (ethTypeSpan && typeof ethTypeSpan.value === 'number') {
          return compareNumbers(ethTypeSpan.value, op, v);
        }
        return packet.searchText.includes(v);
      }

      // IP Protocol matching (e.g. ip.proto == 6)
      if (f === 'ip.proto') {
        const protoSpan = packet.packet?.spans.find((s) => s.fieldId === 'protocol' || s.fieldId === 'nextHeader');
        if (protoSpan && typeof protoSpan.value === 'number') {
          return compareNumbers(protoSpan.value, op, v);
        }
        return false;
      }

      // Ports matching
      if (f === 'tcp.srcport' || f === 'udp.srcport') {
        return packet.srcPort !== null ? compareNumbers(packet.srcPort, op, v) : false;
      }
      if (f === 'tcp.dstport' || f === 'udp.dstport') {
        return packet.dstPort !== null ? compareNumbers(packet.dstPort, op, v) : false;
      }
      if (f === 'tcp.port' || f === 'udp.port') {
        const srcMatch = packet.srcPort !== null && compareNumbers(packet.srcPort, op, v);
        const dstMatch = packet.dstPort !== null && compareNumbers(packet.dstPort, op, v);
        return op === '!=' ? !srcMatch && !dstMatch : srcMatch || dstMatch;
      }

      // Frame Length
      if (f === 'frame.len' || f === 'frame.length') {
        return compareNumbers(packet.capturedLength, op, v);
      }

      // Frame Number
      if (f === 'frame.number' || f === 'frame.num') {
        return compareNumbers(packet.number, op, v);
      }

      // Fallback for arbitrary protocol field values (e.g. dns.qry.name == example.com)
      const haystack = `${packet.summary.toLowerCase()} ${packet.searchText}`;
      const hasValue = haystack.includes(v);
      return op === '!=' ? !hasValue : hasValue;
    }
  }
}

/** Provide live autocomplete suggestions based on current filter input string. */
export function getFilterAutocompletions(
  input: string,
  packets: CapturePacket[] = [],
): CompletionItem[] {
  // Find last word being typed
  const match = input.match(/([a-zA-Z0-9._-]+)$/);
  const prefix = match ? match[1]!.toLowerCase() : '';

  const items: CompletionItem[] = [];
  const seen = new Set<string>();

  // Add field suggestions
  for (const { field, detail } of COMMON_FIELDS) {
    if (field.startsWith(prefix) || !prefix) {
      items.push({ completion: field, label: field, detail });
      seen.add(field);
    }
  }

  // Add protocols present in current capture
  const captureProtoIds = new Set(packets.flatMap((p) => p.protocolIds));
  for (const proto of COMMON_PROTOCOLS) {
    if ((proto.startsWith(prefix) || !prefix) && !seen.has(proto)) {
      const active = captureProtoIds.has(proto) ? ' (present in capture)' : '';
      items.push({ completion: proto, label: proto, detail: `Protocol layer${active}` });
      seen.add(proto);
    }
  }

  return items.slice(0, 10);
}
