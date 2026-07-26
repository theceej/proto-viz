import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { readCaptureBytes } from '../src/core/capture';
import { LINKTYPE, writePcap } from '../src/core/pcap';

/** Repeat the checked-in TCP/DNS sample's five frames into a deterministic 2,000-packet pcap. */
export function captureProfileFixture(): Uint8Array {
  const fixture = new Uint8Array(
    readFileSync(fileURLToPath(new URL('../fixtures/capture-handshake.pcap', import.meta.url))),
  );
  const records = readCaptureBytes(fixture).records;
  return writePcap(
    Array.from({ length: 2_000 }, (_, index) => ({
      bytes: records[index % records.length]!.bytes,
      tsSec: 1_760_000_000 + Math.floor(index / 1_000),
      tsUsec: (index % 1_000) * 1_000,
    })),
    LINKTYPE.ETHERNET,
  );
}
