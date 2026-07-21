import type { SerializedPacket } from '../../core/serialize';
import type { Registry } from '../../core/registry';
import BitGrid from './BitGrid';
import ProtocolInfoLink from './ProtocolInfoLink';
import { layerColor, PAYLOAD_COLOR } from '../colors';
import { bitsLabel } from '../format';

/**
 * The classic RFC-style 32-bit-per-row diagrams for every layer in a packet,
 * plus an opaque-payload block. Shared by the stack builder and the scenario
 * timeline so both render packets identically.
 */
export default function PacketDiagrams({
  packet,
  registry,
}: {
  packet: SerializedPacket;
  registry: Registry;
}) {
  return (
    <div className="flex flex-col gap-5 p-5">
      {packet.layers.map((layout, i) => {
        const def = registry.get(layout.protocolId);
        if (!def) return null;
        const spans = packet.spans.filter((s) => s.layerUid === layout.uid);
        const color = layerColor(i);
        return (
          <div key={layout.uid}>
            <div className="mb-1 flex items-baseline gap-2">
              <span
                className="size-2 self-center rounded-full"
                style={{ background: color.accent }}
              />
              <span className="text-[13px] font-semibold text-zinc-100">{def.name}</span>
              <ProtocolInfoLink protocolId={def.id} name={def.name} />
              <span className="font-mono text-[11px] text-zinc-500">
                {bitsLabel(layout.headerBytes * 8)} · offset {layout.byteOffset}
              </span>
            </div>
            <BitGrid def={def} layout={layout} spans={spans} color={color} />
          </div>
        );
      })}
      {packet.bytes.length > packet.payloadOffset && (
        <div>
          <div className="mb-1 flex items-baseline gap-2">
            <span
              className="size-2 self-center rounded-full"
              style={{ background: PAYLOAD_COLOR.accent }}
            />
            <span className="text-[13px] font-semibold text-zinc-100">Payload</span>
            <span className="font-mono text-[11px] text-zinc-500">
              {packet.bytes.length - packet.payloadOffset} bytes
            </span>
          </div>
          <div
            className="rounded-md px-3 py-2 text-[12px] text-zinc-400 italic"
            style={{
              background: PAYLOAD_COLOR.fill,
              boxShadow: `inset 0 0 0 1px ${PAYLOAD_COLOR.border}`,
            }}
          >
            opaque payload — edit under “Payload” on the left
          </div>
        </div>
      )}
    </div>
  );
}
