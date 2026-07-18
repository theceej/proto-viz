import { useMemo } from 'react';
import { AlertTriangle, ArrowRight, FileText } from 'lucide-react';
import type { ExtractedText } from '../../../import/extract/text';
import type { DiagramParse } from '../../../import/diagram';
import { findProseFields } from '../../../import/fieldList';
import { bitsLabel } from '../../format';
import { BackButton, ConfidenceBadge } from './atoms';

/** Step 2: choose a detected packet diagram, or fall back to the prose field list. */
export default function PickStep({
  extracted,
  fileName,
  diagrams,
  onPick,
  onProse,
  onBack,
}: {
  extracted: ExtractedText;
  fileName: string;
  diagrams: DiagramParse[];
  onPick: (d: DiagramParse) => void;
  onProse: () => void;
  onBack: () => void;
}) {
  const lines = useMemo(() => extracted.text.split(/\r?\n/), [extracted]);
  const proseCount = useMemo(() => findProseFields(extracted.text).length, [extracted]);
  return (
    <div className="flex min-h-0 flex-col gap-3">
      <div className="flex items-center gap-2 text-[13px] text-zinc-400">
        <FileText className="size-4 text-zinc-500" />
        {fileName}
        <span className="text-zinc-600">·</span>
        {diagrams.length} diagram{diagrams.length === 1 ? '' : 's'} detected
      </div>
      {extracted.warnings.map((w, i) => (
        <p key={i} className="flex items-start gap-1.5 text-[12px] text-amber-300">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0" /> {w}
        </p>
      ))}
      <div className="flex min-h-0 flex-col gap-3 overflow-auto">
        {diagrams.map((d, i) => (
          <button
            key={i}
            className="cursor-pointer rounded-lg border border-zinc-800 bg-zinc-900/40 p-3 text-left hover:border-cyan-700"
            onClick={() => onPick(d)}
          >
            <div className="mb-2 flex items-center gap-3">
              <span className="text-[13px] font-medium text-zinc-100">
                Diagram at line {d.startLine + 1}
              </span>
              <ConfidenceBadge value={d.confidence} />
              <span className="font-mono text-[11px] text-zinc-500">
                {d.fields.length} fields · {bitsLabel(d.totalBits)} · {d.bitsPerRow} bits/row
              </span>
              <ArrowRight className="ml-auto size-4 text-zinc-600" />
            </div>
            <pre className="max-h-40 overflow-auto rounded bg-zinc-950/70 p-2 font-mono text-[10px] leading-tight text-zinc-400">
              {lines.slice(d.startLine, Math.min(d.endLine + 1, d.startLine + 14)).join('\n')}
            </pre>
          </button>
        ))}
        {diagrams.length === 0 && (
          <div className="rounded-lg border border-zinc-800 p-4 text-[13px] text-zinc-400">
            No packet diagrams were detected.
            {proseCount > 0 ? (
              <button
                className="ml-2 cursor-pointer text-cyan-400 hover:text-cyan-300"
                onClick={onProse}
              >
                Build from the {proseCount} “Name: N bits” declarations found in the prose →
              </button>
            ) : (
              <span className="text-zinc-500">
                {' '}
                The text also has no “Name: N bits” declarations — check that this is a
                protocol spec with a classic bit diagram.
              </span>
            )}
          </div>
        )}
      </div>
      <div>
        <BackButton onClick={onBack} />
      </div>
    </div>
  );
}
