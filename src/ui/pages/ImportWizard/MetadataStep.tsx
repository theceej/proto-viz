import { Check, Plus, Trash2 } from 'lucide-react';
import type { LayerHint } from '../../../core/model';
import { CLAIM_NAMESPACES, LAYER_HINTS, type Claim } from './constants';
import { BackButton, LabeledInput } from './atoms';

/** Step 4: protocol metadata and encapsulation claims, then save to the library. */
export default function MetadataStep({
  protoName,
  onNameChange,
  protoId,
  onIdChange,
  layerHint,
  onLayerHintChange,
  description,
  onDescriptionChange,
  reference,
  onReferenceChange,
  claims,
  onClaimsChange,
  saveError,
  canSave,
  onBack,
  onSave,
}: {
  protoName: string;
  onNameChange: (v: string) => void;
  protoId: string;
  onIdChange: (v: string) => void;
  layerHint: LayerHint;
  onLayerHintChange: (v: LayerHint) => void;
  description: string;
  onDescriptionChange: (v: string) => void;
  reference: string;
  onReferenceChange: (v: string) => void;
  claims: Claim[];
  onClaimsChange: (c: Claim[]) => void;
  saveError: string | null;
  canSave: boolean;
  onBack: () => void;
  onSave: () => void;
}) {
  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-4">
        <LabeledInput label="Protocol name" value={protoName} onChange={onNameChange} />
        <LabeledInput label="Identifier" value={protoId} onChange={onIdChange} mono />
        <label className="block">
          <span className="mb-1 block text-[11px] font-semibold tracking-widest text-zinc-500 uppercase">
            Layer
          </span>
          <select
            className="w-full rounded border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-[13px] text-zinc-200 outline-none focus:border-cyan-600"
            value={layerHint}
            onChange={(e) => onLayerHintChange(e.target.value as LayerHint)}
          >
            {LAYER_HINTS.map((h) => (
              <option key={h} value={h}>
                {h}
              </option>
            ))}
          </select>
        </label>
        <LabeledInput label="Reference (optional)" value={reference} onChange={onReferenceChange} placeholder="RFC 1234" />
      </div>
      <LabeledInput label="Description (optional)" value={description} onChange={onDescriptionChange} />

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
              aria-label={`Claim ${i + 1} namespace`}
              value={claim.namespaceId}
              onChange={(e) =>
                onClaimsChange(claims.map((c, j) => (j === i ? { ...c, namespaceId: e.target.value } : c)))
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
              aria-label={`Claim ${i + 1} value`}
              value={claim.value}
              onChange={(e) =>
                onClaimsChange(claims.map((c, j) => (j === i ? { ...c, value: e.target.value } : c)))
              }
            />
            <button
              className="cursor-pointer p-1.5 text-zinc-500 hover:text-rose-400"
              aria-label="Remove this encapsulation claim"
              onClick={() => onClaimsChange(claims.filter((_, j) => j !== i))}
            >
              <Trash2 className="size-3.5" />
            </button>
          </div>
        ))}
        <button
          className="flex cursor-pointer items-center gap-1 text-[12px] text-cyan-400 hover:text-cyan-300"
          onClick={() => onClaimsChange([...claims, { namespaceId: 'udp-dstport', value: '' }])}
        >
          <Plus className="size-3.5" /> Add claim
        </button>
      </div>

      {saveError && <p className="text-[12px] text-rose-400">{saveError}</p>}

      <div className="flex justify-between">
        <BackButton onClick={onBack} />
        <button
          className="flex cursor-pointer items-center gap-1.5 rounded-md bg-cyan-700 px-4 py-1.5 text-[13px] font-medium text-white hover:bg-cyan-600 disabled:bg-zinc-800 disabled:text-zinc-500"
          disabled={!canSave}
          onClick={onSave}
        >
          <Check className="size-3.5" />
          Save to library
        </button>
      </div>
    </div>
  );
}
