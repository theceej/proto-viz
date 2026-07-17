import type { FieldDef, ProtocolDefinition } from '../core/model';
import { NS } from '../core/bindings';

/**
 * Conversational text protocols, modeled like HTTP/1.1: editable text
 * fields that serialize to the wire bytes. Each shows one representative
 * client message; these are byte streams, not fixed headers.
 */

const CRLF: FieldDef = {
  id: 'crlf',
  name: 'CRLF',
  type: 'bytes',
  bitLength: 16,
  default: Uint8Array.from([0x0d, 0x0a]),
  description: 'Line terminator.',
};

function textLine(command: string, description: string): FieldDef[] {
  return [
    { id: 'command', name: 'Command Line', type: 'string', bitLength: 'auto', default: command, description },
    CRLF,
  ];
}

export const ftp: ProtocolDefinition = {
  id: 'ftp',
  name: 'FTP',
  fullName: 'File Transfer Protocol (control channel)',
  layerHint: 'application',
  source: 'builtin',
  references: ['RFC 959'],
  description:
    'Text command channel on TCP 21; file data flows on a separate connection negotiated with PORT/PASV.',
  fields: textLine('RETR firmware.bin', 'One FTP command with its argument.'),
  providesNamespaces: [],
  encapsulations: [{ namespaceId: NS.tcpDstPort, value: 21 }],
};

export const smtp: ProtocolDefinition = {
  id: 'smtp',
  name: 'SMTP',
  fullName: 'Simple Mail Transfer Protocol',
  layerHint: 'application',
  source: 'builtin',
  references: ['RFC 5321'],
  description:
    'Mail relay dialogue on TCP 25: EHLO, MAIL FROM, RCPT TO, DATA. One command per packet here.',
  fields: textLine('EHLO client.example.com', 'One SMTP command.'),
  providesNamespaces: [],
  encapsulations: [{ namespaceId: NS.tcpDstPort, value: 25 }],
};

export const pop3: ProtocolDefinition = {
  id: 'pop3',
  name: 'POP3',
  fullName: 'Post Office Protocol version 3',
  layerHint: 'application',
  source: 'builtin',
  references: ['RFC 1939'],
  description: 'Simple mailbox retrieval on TCP 110: USER, PASS, LIST, RETR, DELE.',
  fields: textLine('RETR 1', 'One POP3 command.'),
  providesNamespaces: [],
  encapsulations: [{ namespaceId: NS.tcpDstPort, value: 110 }],
};

export const imap: ProtocolDefinition = {
  id: 'imap',
  name: 'IMAP',
  fullName: 'Internet Message Access Protocol',
  layerHint: 'application',
  source: 'builtin',
  references: ['RFC 9051'],
  description:
    'Server-side mailbox access on TCP 143. Every client command carries a tag the server echoes in its response.',
  fields: textLine('a001 SELECT INBOX', 'Tagged IMAP command.'),
  providesNamespaces: [],
  encapsulations: [{ namespaceId: NS.tcpDstPort, value: 143 }],
};

export const telnet: ProtocolDefinition = {
  id: 'telnet',
  name: 'Telnet',
  fullName: 'Telnet remote terminal',
  layerHint: 'application',
  source: 'builtin',
  references: ['RFC 854'],
  description:
    'Raw terminal bytes on TCP 23, with in-band option negotiation: 0xFF (IAC) introduces commands like DO/WILL. Modeled as one negotiation followed by text.',
  fields: [
    { id: 'iac', name: 'IAC Negotiation', type: 'bytes', bitLength: 24, default: Uint8Array.from([0xff, 0xfd, 0x01]), description: 'IAC DO ECHO.' },
    { id: 'text', name: 'Text', type: 'string', bitLength: 'auto', default: 'login: ', description: 'Terminal data.' },
  ],
  providesNamespaces: [],
  encapsulations: [{ namespaceId: NS.tcpDstPort, value: 23 }],
};

export const irc: ProtocolDefinition = {
  id: 'irc',
  name: 'IRC',
  fullName: 'Internet Relay Chat',
  layerHint: 'application',
  source: 'builtin',
  references: ['RFC 2812'],
  description: 'Chat protocol on TCP 6667: one CRLF-terminated command per line.',
  fields: textLine('PRIVMSG #network :hello from proto-viz', 'One IRC message.'),
  providesNamespaces: [],
  encapsulations: [{ namespaceId: NS.tcpDstPort, value: 6667 }],
};

export const sip: ProtocolDefinition = {
  id: 'sip',
  name: 'SIP',
  fullName: 'Session Initiation Protocol',
  layerHint: 'application',
  source: 'builtin',
  references: ['RFC 3261'],
  description:
    'Call signalling for VoIP, HTTP-like text over UDP 5060. An INVITE sets up the session; the media itself flows as RTP.',
  fields: [
    { id: 'startLine', name: 'Start Line', type: 'string', bitLength: 'auto', default: 'INVITE sip:bob@example.com SIP/2.0', description: 'Request line or status line.' },
    CRLF,
    {
      id: 'headerLines', name: 'Headers', type: 'string', bitLength: 'auto',
      default:
        'Via: SIP/2.0/UDP client.example.com;branch=z9hG4bK776\r\nFrom: <sip:alice@example.com>;tag=1928\r\nTo: <sip:bob@example.com>\r\nCall-ID: a84b4c76e66710\r\nCSeq: 314159 INVITE\r\nContent-Length: 0',
      description: 'CRLF-separated header lines.',
    },
    { id: 'terminator', name: 'End of Headers', type: 'bytes', bitLength: 32, default: Uint8Array.from([0x0d, 0x0a, 0x0d, 0x0a]), description: 'CRLF CRLF.' },
  ],
  providesNamespaces: [],
  encapsulations: [{ namespaceId: NS.udpDstPort, value: 5060 }],
};

export const rtsp: ProtocolDefinition = {
  id: 'rtsp',
  name: 'RTSP',
  fullName: 'Real Time Streaming Protocol',
  layerHint: 'application',
  source: 'builtin',
  references: ['RFC 7826'],
  description:
    'VCR-style control (DESCRIBE, SETUP, PLAY) for media sessions on TCP 554; the media flows separately as RTP.',
  fields: [
    { id: 'startLine', name: 'Start Line', type: 'string', bitLength: 'auto', default: 'DESCRIBE rtsp://example.com/stream RTSP/1.0' },
    CRLF,
    { id: 'headerLines', name: 'Headers', type: 'string', bitLength: 'auto', default: 'CSeq: 1' },
    { id: 'terminator', name: 'End of Headers', type: 'bytes', bitLength: 32, default: Uint8Array.from([0x0d, 0x0a, 0x0d, 0x0a]) },
  ],
  providesNamespaces: [],
  encapsulations: [{ namespaceId: NS.tcpDstPort, value: 554 }],
};

export const syslog: ProtocolDefinition = {
  id: 'syslog',
  name: 'Syslog',
  fullName: 'Syslog event message',
  layerHint: 'application',
  source: 'builtin',
  references: ['RFC 5424'],
  description:
    'Event logging on UDP 514. The priority combines facility and severity: <134> is facility 16 (local0), severity 6 (info).',
  fields: [
    { id: 'priority', name: 'Priority', type: 'string', bitLength: 'auto', default: '<134>', description: '<facility * 8 + severity>.' },
    { id: 'message', name: 'Message', type: 'string', bitLength: 'auto', default: '1 2026-07-17T12:00:00Z gw1 proto-viz - - - Interface up', description: 'Version, timestamp, hostname, app, and text.' },
  ],
  providesNamespaces: [],
  encapsulations: [{ namespaceId: NS.udpDstPort, value: 514 }],
};

export const ssdp: ProtocolDefinition = {
  id: 'ssdp',
  name: 'SSDP',
  fullName: 'Simple Service Discovery Protocol',
  layerHint: 'application',
  source: 'builtin',
  references: ['UPnP Device Architecture 2.0'],
  description:
    'UPnP device discovery: HTTP-formatted requests multicast to 239.255.255.250 on UDP 1900.',
  fields: [
    { id: 'startLine', name: 'Start Line', type: 'string', bitLength: 'auto', default: 'M-SEARCH * HTTP/1.1' },
    CRLF,
    {
      id: 'headerLines', name: 'Headers', type: 'string', bitLength: 'auto',
      default: 'HOST: 239.255.255.250:1900\r\nMAN: "ssdp:discover"\r\nMX: 2\r\nST: ssdp:all',
    },
    { id: 'terminator', name: 'End of Headers', type: 'bytes', bitLength: 32, default: Uint8Array.from([0x0d, 0x0a, 0x0d, 0x0a]) },
  ],
  providesNamespaces: [],
  encapsulations: [{ namespaceId: NS.udpDstPort, value: 1900 }],
};
