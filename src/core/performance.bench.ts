import { bench, describe } from 'vitest';
import { createBuiltinRegistry } from '../protocols';
import { newLayer } from './model';
import { serializeStack } from './serialize';
import { LINKTYPE, writePcap } from './pcap';
import { openCaptureFile, readCaptureBytes } from './capture';
import { EMPTY_FILTER, filterPackets } from './captureFilter';

const registry = createBuiltinRegistry();
const packet = serializeStack(
  { layers: [newLayer('ethernet'), newLayer('ipv4'), newLayer('tcp')] },
  registry,
);
const captureBytes = writePcap(
  Array.from({ length: 2_000 }, (_, index) => ({
    bytes: packet.bytes,
    tsSec: 1_700_000_000,
    tsUsec: index,
  })),
  LINKTYPE.ETHERNET,
);
const capture = openCaptureFile(captureBytes, registry, 'benchmark.pcap');

describe('capture performance', () => {
  bench('parse 2,000 packet records', () => {
    readCaptureBytes(captureBytes);
  });

  bench('decode and index 2,000 packets', () => {
    openCaptureFile(captureBytes, registry, 'benchmark.pcap');
  });

  bench('apply a display filter to 2,000 packets', () => {
    filterPackets(capture.packets, { ...EMPTY_FILTER, text: 'tcp.port == 80' });
  });
});
