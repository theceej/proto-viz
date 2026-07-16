import { useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Check,
  FileText,
  Plus,
  Trash2,
  Upload,
} from 'lucide-react';
import type { FieldType, LayerHint } from '../../core/model';
import { newLayer } from '../../core/model';
import { createRegistry } from '../../core/registry';
import { serializeStack } from '../../core/serialize';
import { extractSpecText, type ExtractedText } from '../../import/extract/text';
import { findDiagrams, type DiagramParse } from '../../import/diagram';
import { findProseFields } from '../../import/fieldList';
import { buildDraft, draftToDefinition, kebabCase, type DraftField } from '../../import/draft';
import { useLibraryStore } from '../../store/libraryStore';
import { saveCustomProtocol } from '../../store/persistence';
import { enumTables } from '../../protocols';
import BitGrid from '../components/BitGrid';
import { layerColor } from '../colors';
import { bitsLabel } from '../format';

type Step = 'upload' | 'pick' | 'review' | 'metadata';

const FIELD_TYPES: FieldType[] = ['uint', 'flags', 'bytes', 'mac', 'ipv4', 'ipv6', 'string', 'dnsName'];
const LAYER_HINTS: LayerHint[] = ['link', 'network', 'transport', 'application', 'tunnel'];
const CLAIM_NAMESPACES = [
  { id: 'ethertype', label: 'Ethernet — EtherType', hex: true },
  { id: 'ip-proto', label: 'IPv4/IPv6 — IP Protocol number', hex: false },
  { id: 'udp-dstport', label: 'UDP — destination port', hex: false },
  { id: 'tcp-dstport', label: 'TCP — destination port', hex: false },
  { id: 'gre-proto', label: 'GRE — protocol type (EtherType-coded)', hex: true },
  { id: 'ppp-proto', label: 'PPPoE — PPP protocol number', hex: true },
];

interface Claim {
  namespaceId: string;
  value: string;
}

export default function ImportWizard() {
  const navigate = useNavigate();
  const addCustom = useLibraryStore((s) => s.addCustom);

  const [step, setStep] = useState<Step>('upload');
  const [extracted, setExtracted] = useState<ExtractedText | null>(null);
  const [fileName, setFileName] = useState('');
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [diagrams, setDiagrams] = useState<DiagramParse[]>([]);
  const [fields, setFields] = useState<DraftField[]>([]);
  const [draftWarnings, setDraftWarnings] = useState<string[]>([]);
  const [confidence, setConfidence] = useState(1);

  const [protoName, setProtoName] = useState('');
  const [protoId, setProtoId] = useState('');
  const [layerHint, setLayerHint] = useState<LayerHint>('application');
  const [description, setDescription] = useState('');
  const [reference, setReference] = useState('');
  const [claims, setClaims] = useState<Claim[]>([{ namespaceId: 'udp-dstport', value: '' }]);
  const [saveError, setSaveError] = useState<string | null>(null);

  const ingest = async (file: File) => {
    setUploadError(null);
    try {
      const result = await extractSpecText(file);
      setExtracted(result);
      setFileName(file.name);
      const found = findDiagrams(result.text);
      setDiagrams(found);
      const base = file.name.replace(/\.[a-z0-9]+$/i, '');
      setProtoName(base);
      setProtoId(kebabCase(base));
      setStep('pick');
    } catch (e) {
      setUploadError((e as Error).message);
    }
  };

  const pickDiagram = (d: DiagramParse) => {
    const draft = buildDraft(d, protoName);
    setFields(draft.fields);
    setDraftWarnings(draft.warnings);
    setConfidence(draft.confidence);
    setStep('review');
  };

  const pickProse = () => {
    if (!extracted) return;
    const prose = findProseFields(extracted.text);
    setFields(
      prose.map((p, i) => ({
        id: `field${i}`,
        name: p.name,
        bitLength: p.bits,
        type: 'uint' as FieldType,
        variable: false,
        flags: [],
        inference: 'from prose field list',
      })),
    );
    setDraftWarnings(['Built from the prose field list — verify order and widths.']);
    setConfidence(0.5);
    setStep('review');
  };

  const save = async () => {
    setSaveError(null);
    try {
      const def = draftToDefinition(
        { name: protoName, fields, warnings: [], confidence },
        {
          id: protoId,
          name: protoName,
          layerHint,
          description: description || undefined,
          references: reference ? [reference] : undefined,
          encapsulations: claims
            .filter((c) => c.namespaceId)
            .map((c) => ({
              namespaceId: c.namespaceId,
              value: c.value.trim() === '' ? undefined : Number(c.value),
            })),
        },
      );
      addCustom(def);
      await saveCustomProtocol(def);
      navigate(`/library/${def.id}`);
    } catch (e) {
      setSaveError((e as Error).message);
    }
  };

  return (
    <div className="mx-auto flex h-full max-w-4xl flex-col p-6">
      <header className="mb-6">
        <h1 className="text-[15px] font-semibold tracking-tight text-zinc-100">
          Import a Protocol Spec
        </h1>
        <p className="mt-1 text-[13px] text-zinc-500">
          Upload an RFC or spec (TXT, HTML, DOCX, PDF). Packet diagrams are detected and
          parsed; you review everything before it joins the library.
        </p>
        <StepIndicator step={step} />
      </header>

      {step === 'upload' && <UploadStep onFile={ingest} error={uploadError} />}

      {step === 'pick' && extracted && (
        <PickStep
          extracted={extracted}
          fileName={fileName}
          diagrams={diagrams}
          onPick={pickDiagram}
          onProse={pickProse}
          onBack={() => setStep('upload')}
        />
      )}

      {step === 'review' && (
        <ReviewStep
          fields={fields}
          setFields={setFields}
          warnings={draftWarnings}
          confidence={confidence}
          onBack={() => setStep('pick')}
          onNext={() => setStep('metadata')}
        />
      )}

      {step === 'metadata' && (
        <div className="flex flex-col gap-4">
          <div className="grid grid-cols-2 gap-4">
            <LabeledInput label="Protocol name" value={protoName} onChange={(v) => {
              setProtoName(v);
              setProtoId(kebabCase(v));
            }} />
            <LabeledInput label="Identifier" value={protoId} onChange={setProtoId} mono />
            <label className="block">
              <span className="mb-1 block text-[11px] font-semibold tracking-widest text-zinc-500 uppercase">
                Layer
              </span>
              <select
                className="w-full rounded border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-[13px] text-zinc-200 outline-none focus:border-cyan-600"
                value={layerHint}
                onChange={(e) => setLayerHint(e.target.value as LayerHint)}
              >
                {LAYER_HINTS.map((h) => (
                  <option key={h} value={h}>
                    {h}
                  </option>
                ))}
              </select>
            </label>
            <LabeledInput label="Reference (optional)" value={reference} onChange={setReference} placeholder="RFC 1234" />
          </div>
          <LabeledInput label="Description (optional)" value={description} onChange={setDescription} />

          <div>
            <span className="mb-1 block text-[11px] font-semibold tracking-widest text-zinc-500 uppercase">
              Where can this protocol sit? (encapsulation claims)
            </span>
            <p className="mb-2 text-[12px] text-zinc-500">
              These make the stack builder accept the protocol and auto-set carrier selector
              fields (EtherType, IP protocol, ports).
            </p>
            {claims.map((claim, i) => (
              <div key={i} className="mb-1.5 flex items-center gap-2">
                <select
                  className="rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-[13px] text-zinc-200"
                  value={claim.namespaceId}
                  onChange={(e) =>
                    setClaims(claims.map((c, j) => (j === i ? { ...c, namespaceId: e.target.value } : c)))
                  }
                >
                  {CLAIM_NAMESPACES.map((ns) => (
                    <option key={ns.id} value={ns.id}>
                      {ns.label}
                    </option>
                  ))}
                </select>
                <input
                  className="w-28 rounded border border-zinc-700 bg-zinc-950/60 px-2 py-1 font-mono text-[13px] text-zinc-200 outline-none focus:border-cyan-600"
                  placeholder="value"
                  value={claim.value}
                  onChange={(e) =>
                    setClaims(claims.map((c, j) => (j === i ? { ...c, value: e.target.value } : c)))
                  }
                />
                <button
                  className="cursor-pointer text-zinc-500 hover:text-rose-400"
                  onClick={() => setClaims(claims.filter((_, j) => j !== i))}
                >
                  <Trash2 className="size-3.5" />
                </button>
              </div>
            ))}
            <button
              className="flex cursor-pointer items-center gap-1 text-[12px] text-cyan-400 hover:text-cyan-300"
              onClick={() => setClaims([...claims, { namespaceId: 'udp-dstport', value: '' }])}
            >
              <Plus className="size-3.5" /> Add claim
            </button>
          </div>

          {saveError && <p className="text-[12px] text-rose-400">{saveError}</p>}

          <div className="flex justify-between">
            <BackButton onClick={() => setStep('review')} />
            <button
              className="flex cursor-pointer items-center gap-1.5 rounded-md bg-cyan-700 px-4 py-1.5 text-[13px] font-medium text-white hover:bg-cyan-600 disabled:bg-zinc-800 disabled:text-zinc-500"
              disabled={!protoName || !protoId || fields.length === 0}
              onClick={save}
            >
              <Check className="size-3.5" />
              Save to library
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function StepIndicator({ step }: { step: Step }) {
  const steps: { key: Step; label: string }[] = [
    { key: 'upload', label: 'Upload' },
    { key: 'pick', label: 'Detect' },
    { key: 'review', label: 'Review fields' },
    { key: 'metadata', label: 'Save' },
  ];
  const activeIdx = steps.findIndex((s) => s.key === step);
  return (
    <div className="mt-4 flex items-center gap-2">
      {steps.map((s, i) => (
        <div key={s.key} className="flex items-center gap-2">
          <span
            className={`rounded-full px-2.5 py-0.5 text-[11px] ${
              i === activeIdx
                ? 'bg-cyan-500/15 font-medium text-cyan-300'
                : i < activeIdx
                  ? 'text-emerald-400'
                  : 'text-zinc-600'
            }`}
          >
            {i < activeIdx ? '✓ ' : ''}
            {s.label}
          </span>
          {i < steps.length - 1 && <span className="text-zinc-700">→</span>}
        </div>
      ))}
    </div>
  );
}

function UploadStep({ onFile, error }: { onFile: (f: File) => void; error: string | null }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  return (
    <div>
      <div
        className={`flex h-52 cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed transition-colors ${
          dragging ? 'border-cyan-500 bg-cyan-500/5' : 'border-zinc-700 hover:border-zinc-500'
        }`}
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          const file = e.dataTransfer.files[0];
          if (file) onFile(file);
        }}
      >
        <Upload className="size-6 text-zinc-500" />
        <p className="text-[13px] text-zinc-400">Drop a spec here, or click to browse</p>
        <p className="text-[11px] text-zinc-600">TXT · HTML · DOCX · PDF — parsed entirely in your browser</p>
        <input
          ref={inputRef}
          type="file"
          accept=".txt,.text,.html,.htm,.docx,.doc,.pdf"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) onFile(file);
          }}
        />
      </div>
      {error && (
        <p className="mt-3 flex items-start gap-1.5 text-[13px] text-rose-400">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
          {error}
        </p>
      )}
      <p className="mt-4 text-[12px] text-zinc-600">
        Tip: for RFCs, the plain-text version from rfc-editor.org parses most reliably —
        packet diagrams keep their exact column alignment.
      </p>
    </div>
  );
}

function PickStep({
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

function ReviewStep({
  fields,
  setFields,
  warnings,
  confidence,
  onBack,
  onNext,
}: {
  fields: DraftField[];
  setFields: (f: DraftField[]) => void;
  warnings: string[];
  confidence: number;
  onBack: () => void;
  onNext: () => void;
}) {
  const totalBits = fields.reduce((n, f) => n + f.bitLength, 0);
  const registry = useMemo(() => createRegistry([], enumTables), []);

  // Live preview: serialize a single-layer stack of the draft.
  const preview = useMemo(() => {
    try {
      const def = draftToDefinition(
        { name: 'preview', fields, warnings: [], confidence: 1 },
        { id: 'preview', name: 'Preview', layerHint: 'application', encapsulations: [] },
      );
      // Give variable fields a visible placeholder size.
      for (const f of def.fields) {
        if (f.bitLength === 'auto') f.default = new Uint8Array(4);
      }
      const reg = createRegistry([def], enumTables);
      const packet = serializeStack({ layers: [newLayer('preview')] }, reg);
      return { def, packet };
    } catch {
      return null;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fields, registry]);

  const update = (i: number, patch: Partial<DraftField>) =>
    setFields(fields.map((f, j) => (j === i ? { ...f, ...patch } : f)));

  return (
    <div className="flex min-h-0 flex-col gap-3">
      <div className="flex items-center gap-3">
        <ConfidenceBadge value={confidence} />
        <span
          className={`font-mono text-[12px] ${totalBits % 8 === 0 ? 'text-zinc-400' : 'text-amber-400'}`}
        >
          total {bitsLabel(totalBits)}
          {totalBits % 8 !== 0 && ' — not byte-aligned!'}
        </span>
      </div>
      {warnings.map((w, i) => (
        <p key={i} className="flex items-start gap-1.5 text-[12px] text-amber-300">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0" /> {w}
        </p>
      ))}

      <div className="min-h-0 overflow-auto rounded-lg border border-zinc-800">
        <table className="w-full text-[12px]">
          <thead className="sticky top-0 bg-zinc-900 text-left text-[11px] tracking-widest text-zinc-500 uppercase">
            <tr>
              <th className="px-3 py-2">Field</th>
              <th className="px-2 py-2">Bits</th>
              <th className="px-2 py-2">Type</th>
              <th className="px-2 py-2">Notes</th>
              <th className="px-2 py-2" />
            </tr>
          </thead>
          <tbody>
            {fields.map((f, i) => (
              <tr key={i} className="border-t border-zinc-800/60">
                <td className="px-3 py-1">
                  <input
                    className={`w-full rounded border bg-zinc-950/60 px-2 py-0.5 text-zinc-200 outline-none focus:border-cyan-600 ${
                      f.flags.includes('unnamed') ? 'border-amber-600' : 'border-zinc-800'
                    }`}
                    value={f.name}
                    onChange={(e) => update(i, { name: e.target.value })}
                  />
                </td>
                <td className="px-2 py-1">
                  <input
                    className={`w-16 rounded border bg-zinc-950/60 px-2 py-0.5 font-mono text-zinc-200 outline-none focus:border-cyan-600 ${
                      f.flags.includes('misaligned') ? 'border-amber-600' : 'border-zinc-800'
                    }`}
                    value={f.bitLength}
                    onChange={(e) => {
                      const n = Number(e.target.value);
                      if (Number.isInteger(n) && n >= 0) update(i, { bitLength: n });
                    }}
                  />
                </td>
                <td className="px-2 py-1">
                  <select
                    className="rounded border border-zinc-800 bg-zinc-950/60 px-1 py-0.5 text-zinc-200"
                    value={f.type}
                    onChange={(e) => update(i, { type: e.target.value as FieldType })}
                  >
                    {FIELD_TYPES.map((t) => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                  </select>
                  {f.variable && <span className="ml-1 text-[10px] text-zinc-500">var</span>}
                </td>
                <td className="px-2 py-1 text-[11px] text-zinc-500">
                  {[...f.flags, f.inference].filter(Boolean).join(', ')}
                </td>
                <td className="px-2 py-1">
                  <button
                    className="cursor-pointer text-zinc-600 hover:text-rose-400"
                    onClick={() => setFields(fields.filter((_, j) => j !== i))}
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <button
        className="flex w-fit cursor-pointer items-center gap-1 text-[12px] text-cyan-400 hover:text-cyan-300"
        onClick={() =>
          setFields([
            ...fields,
            { id: `field${fields.length}`, name: 'New Field', bitLength: 8, type: 'uint', variable: false, flags: [] },
          ])
        }
      >
        <Plus className="size-3.5" /> Add field
      </button>

      {preview && preview.packet.layers[0] && (
        <div>
          <h3 className="mb-1 text-[11px] font-semibold tracking-widest text-zinc-500 uppercase">
            Live preview
          </h3>
          <BitGrid
            def={preview.def}
            layout={preview.packet.layers[0]}
            spans={preview.packet.spans}
            color={layerColor(2)}
          />
        </div>
      )}

      <div className="flex justify-between">
        <BackButton onClick={onBack} />
        <button
          className="flex cursor-pointer items-center gap-1.5 rounded-md bg-cyan-700 px-4 py-1.5 text-[13px] font-medium text-white hover:bg-cyan-600 disabled:bg-zinc-800 disabled:text-zinc-500"
          disabled={fields.length === 0}
          onClick={onNext}
        >
          Continue
          <ArrowRight className="size-3.5" />
        </button>
      </div>
    </div>
  );
}

function ConfidenceBadge({ value }: { value: number }) {
  const pct = Math.round(value * 100);
  const cls =
    value >= 0.8
      ? 'bg-emerald-500/15 text-emerald-300'
      : value >= 0.5
        ? 'bg-amber-500/15 text-amber-300'
        : 'bg-rose-500/15 text-rose-300';
  return <span className={`rounded px-2 py-0.5 text-[11px] ${cls}`}>{pct}% confidence</span>;
}

function BackButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      className="flex cursor-pointer items-center gap-1 rounded-md px-2 py-1.5 text-[13px] text-zinc-400 hover:text-zinc-200"
      onClick={onClick}
    >
      <ArrowLeft className="size-3.5" />
      Back
    </button>
  );
}

function LabeledInput({
  label,
  value,
  onChange,
  mono,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  mono?: boolean;
  placeholder?: string;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-[11px] font-semibold tracking-widest text-zinc-500 uppercase">
        {label}
      </span>
      <input
        className={`w-full rounded border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-[13px] text-zinc-200 outline-none focus:border-cyan-600 ${
          mono ? 'font-mono' : ''
        }`}
        value={value}
        placeholder={placeholder}
        spellCheck={false}
        onChange={(e) => onChange(e.target.value)}
      />
    </label>
  );
}
