import type { ProtocolDefinition } from '../core/model';
import { NS } from '../core/bindings';

export const http1: ProtocolDefinition = {
  id: 'http1',
  name: 'HTTP/1.1',
  fullName: 'Hypertext Transfer Protocol 1.1',
  layerHint: 'application',
  source: 'builtin',
  description:
    'Text-based request framing: start line, header lines, blank line. HTTP is a byte stream, not a fixed header — the bit grid shows the text bytes. A message body (e.g. for POST) goes in the trailing payload.',
  notes: 'Header lines are separated with CRLF; the terminator supplies the final CRLF CRLF.',
  fields: [
    { id: 'startLine', name: 'Start Line', type: 'string', bitLength: 'auto', default: 'GET / HTTP/1.1', description: 'Request line or status line.' },
    { id: 'crlf', name: 'CRLF', type: 'bytes', bitLength: 16, default: Uint8Array.from([0x0d, 0x0a]), description: 'Line terminator.' },
    { id: 'headerLines', name: 'Headers', type: 'string', bitLength: 'auto', default: 'Host: example.com\r\nUser-Agent: proto-viz/1.0', description: 'CRLF-separated header lines.' },
    { id: 'terminator', name: 'End of Headers', type: 'bytes', bitLength: 32, default: Uint8Array.from([0x0d, 0x0a, 0x0d, 0x0a]), description: 'CRLF CRLF.' },
  ],
  providesNamespaces: [],
  encapsulations: [
    { namespaceId: NS.tcpDstPort, value: 80 },
    { namespaceId: NS.tcpDstPort, value: 8080 },
    { namespaceId: NS.tlsPayload, conventional: true },
  ],
};
