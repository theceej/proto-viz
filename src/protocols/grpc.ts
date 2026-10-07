import type { ProtocolDefinition } from '../core/model';
import { NS } from '../core/bindings';
import { E } from '../core/expr';

export const grpc: ProtocolDefinition = {
  id: 'grpc',
  name: 'gRPC',
  fullName: 'gRPC length-prefixed message',
  layerHint: 'application',
  source: 'builtin',
  description:
    'One complete gRPC message: a 1-byte compression flag, a 4-byte big-endian length, and opaque message bytes. Carried in HTTP/2 DATA on a nonzero stream; separate HEADERS declare content-type application/grpc and any grpc-encoding. Compression and protobuf interpretation are not performed here.',
  notes:
    'This example aligns one complete message with one unpadded DATA frame. Real messages can span DATA frames, and a DATA frame can contain multiple messages. Importing arbitrary HTTP/2 frame bodies does not identify gRPC without stream header context. TLS examples show application data in the clear for study.',
  fields: [
    {
      id: 'compressed',
      name: 'Compressed Flag',
      type: 'uint',
      bitLength: 8,
      default: 0,
      enumRef: 'grpc-compression',
      description:
        '0 = uncompressed; 1 = already compressed using grpc-encoding from the stream headers.',
    },
    {
      id: 'messageLength',
      name: 'Message Length',
      type: 'uint',
      bitLength: 32,
      computed: { kind: 'expr', expr: E.sub(E.headerBytes(), E.const(5)) },
      description:
        'Length of the message bytes, excluding the 5-byte prefix; compressed byte count when the flag is 1.',
    },
    {
      id: 'message',
      name: 'Message Bytes',
      type: 'bytes',
      bitLength: 'auto',
      default: new Uint8Array([0x0a, 0x05, 0x68, 0x65, 0x6c, 0x6c, 0x6f]),
      decodeBitLength: { expr: E.field('messageLength'), unit: 'bytes' },
      description:
        'Opaque serialized message bytes. The default is protobuf field 1 containing "hello"; no schema is assumed.',
    },
  ],
  lintRules: [
    {
      kind: 'bitsClear',
      fieldId: 'compressed',
      mask: 0xfe,
      severity: 'warning',
      code: 'grpc-compressed-flag',
      message: 'The gRPC compressed flag must be 0 or 1.',
      reference: 'gRPC over HTTP/2',
    },
  ],
  providesNamespaces: [],
  encapsulations: [{ namespaceId: NS.http2Payload, conventional: true }],
};
