import type { ByteRange } from '../../core/quiz';

/**
 * A deliberately *unannotated* hex dump.
 *
 * The main `HexView` tints bytes by layer and names the protocol under the
 * cursor, which is exactly what a practice question is asking the learner to
 * work out — using it here would print the answer next to the question. This
 * shows offsets, bytes, and ASCII with a single highlighted range and nothing
 * else, so the only information available is the one thing that should be:
 * the bytes on the wire.
 */
const BYTES_PER_ROW = 16;

export default function QuizHexView({
  bytes,
  range,
  /** Dims the highlight once the answer is showing, so the reveal leads. */
  muted = false,
}: {
  bytes: Uint8Array;
  range: ByteRange;
  muted?: boolean;
}) {
  const rows: number[] = [];
  for (let offset = 0; offset < bytes.length; offset += BYTES_PER_ROW) rows.push(offset);

  const inRange = (index: number) => index >= range.offset && index < range.offset + range.length;
  // Text stays on the zinc ramp, which index.css inverts for light mode; a
  // fixed near-white would be unreadable on the light surface.
  const highlight = muted
    ? 'bg-cyan-500/20 text-zinc-200'
    : 'bg-cyan-500/40 text-zinc-100 outline-1 outline-cyan-400';

  return (
    // The dump scrolls, so it needs to be reachable and scrollable by
    // keyboard in its own right (WCAG 2.1.1).
    <div
      className="overflow-auto focus-visible:outline-2 focus-visible:outline-cyan-400"
      tabIndex={0}
      role="group"
      aria-label="Packet bytes in hexadecimal"
    >
      <table className="border-separate border-spacing-0 font-mono text-[12px] leading-6">
        <caption className="sr-only">
          Packet bytes in hexadecimal. Bytes {range.offset} to{' '}
          {range.offset + range.length - 1} are highlighted as the subject of the question.
        </caption>
        <tbody>
          {rows.map((rowOffset) => {
            const row = [...bytes.subarray(rowOffset, rowOffset + BYTES_PER_ROW)];
            return (
              <tr key={rowOffset}>
                <th
                  scope="row"
                  className="pr-3 text-right font-normal text-zinc-600 select-none"
                >
                  {rowOffset.toString(16).padStart(4, '0')}
                </th>
                {row.map((byte, i) => (
                  <td
                    key={i}
                    className={`px-[3px] text-center ${
                      inRange(rowOffset + i) ? highlight : 'text-zinc-300'
                    }`}
                  >
                    {byte.toString(16).padStart(2, '0')}
                  </td>
                ))}
                {/* Keep the ASCII gutter aligned on a short final row. */}
                {row.length < BYTES_PER_ROW && (
                  <td colSpan={BYTES_PER_ROW - row.length} aria-hidden />
                )}
                <td className="pl-3 whitespace-pre text-zinc-500">
                  {row
                    .map((byte) => (byte >= 0x20 && byte < 0x7f ? String.fromCharCode(byte) : '.'))
                    .join('')}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
