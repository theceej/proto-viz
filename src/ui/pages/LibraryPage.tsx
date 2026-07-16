import { useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowDownToLine, ArrowUpFromLine, Search, X } from 'lucide-react';
import type { LayerHint, ProtocolDefinition } from '../../core/model';
import { serializeStack } from '../../core/serialize';
import { carriersOf } from '../../core/bindings';
import { newLayer } from '../../core/model';
import { useLibraryStore } from '../../store/libraryStore';
import BitGrid from '../components/BitGrid';
import { layerColor } from '../colors';
import { bitsLabel } from '../format';

const LAYER_ORDER: LayerHint[] = ['link', 'network', 'transport', 'application', 'tunnel'];
const LAYER_LABEL: Record<LayerHint, string> = {
  link: 'Link layer',
  network: 'Network layer',
  transport: 'Transport layer',
  application: 'Application layer',
  tunnel: 'Tunneling',
};

export default function LibraryPage() {
  const registry = useLibraryStore((s) => s.registry);
  const [query, setQuery] = useState('');
  const { protocolId } = useParams();
  const navigate = useNavigate();

  const selected = protocolId ? registry.get(protocolId) : undefined;

  const groups = useMemo(() => {
    const q = query.toLowerCase();
    const all = registry
      .all()
      .filter(
        (p) =>
          p.name.toLowerCase().includes(q) ||
          (p.fullName ?? '').toLowerCase().includes(q) ||
          p.id.includes(q),
      );
    return LAYER_ORDER.map((layer) => ({
      layer,
      protocols: all.filter((p) => p.layerHint === layer),
    })).filter((g) => g.protocols.length > 0);
  }, [registry, query]);

  return (
    <div className="flex h-full">
      <div className="min-w-0 flex-1 overflow-auto">
        <header className="sticky top-0 z-10 flex items-center gap-3 border-b border-zinc-800 bg-zinc-950/90 px-6 py-3 backdrop-blur">
          <h1 className="text-[15px] font-semibold tracking-tight text-zinc-100">
            Protocol Library
          </h1>
          <div className="relative ml-auto">
            <Search className="absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-zinc-500" />
            <input
              className="w-56 rounded-md border border-zinc-700 bg-zinc-900 py-1 pr-2 pl-7 text-[13px] text-zinc-200 outline-none placeholder:text-zinc-600 focus:border-cyan-600"
              placeholder="Search protocols…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
        </header>
        <div className="flex flex-col gap-6 p-6">
          {groups.map((g) => (
            <section key={g.layer}>
              <h2 className="mb-2 text-[11px] font-semibold tracking-widest text-zinc-500 uppercase">
                {LAYER_LABEL[g.layer]}
              </h2>
              <div className="grid grid-cols-[repeat(auto-fill,minmax(15rem,1fr))] gap-3">
                {g.protocols.map((p) => (
                  <button
                    key={p.id}
                    className={`cursor-pointer rounded-lg border p-3 text-left transition-colors ${
                      selected?.id === p.id
                        ? 'border-cyan-600 bg-cyan-500/5'
                        : 'border-zinc-800 bg-zinc-900/40 hover:border-zinc-600'
                    }`}
                    onClick={() => navigate(`/library/${p.id}`)}
                  >
                    <div className="flex items-baseline gap-2">
                      <span className="text-[14px] font-semibold text-zinc-100">{p.name}</span>
                      {p.source === 'custom' && (
                        <span className="rounded bg-violet-500/20 px-1.5 text-[10px] text-violet-300">
                          custom
                        </span>
                      )}
                      <span className="ml-auto font-mono text-[10px] text-zinc-600">
                        {p.references?.[0] ?? ''}
                      </span>
                    </div>
                    <p className="mt-1 line-clamp-2 text-[12px] leading-snug text-zinc-500">
                      {p.fullName ?? p.description ?? ''}
                    </p>
                  </button>
                ))}
              </div>
            </section>
          ))}
          {groups.length === 0 && (
            <p className="text-sm text-zinc-500">No protocols match “{query}”.</p>
          )}
        </div>
      </div>
      {selected && <DetailPanel def={selected} onClose={() => navigate('/library')} />}
    </div>
  );
}

function DetailPanel({ def, onClose }: { def: ProtocolDefinition; onClose: () => void }) {
  const registry = useLibraryStore((s) => s.registry);

  // Render the header diagram by serializing a single-layer stack with defaults.
  const preview = useMemo(() => {
    try {
      return serializeStack({ layers: [newLayer(def.id)] }, registry);
    } catch {
      return null;
    }
  }, [def, registry]);

  const carriedBy = carriersOf(def, registry.all());
  const carries = registry
    .all()
    .filter((p) =>
      p.encapsulations.some((e) => def.providesNamespaces.some((ns) => ns.id === e.namespaceId)),
    );

  const color = layerColor(0);

  return (
    <aside className="flex w-[30rem] shrink-0 flex-col overflow-auto border-l border-zinc-800 bg-zinc-900/30">
      <header className="sticky top-0 flex items-start gap-2 border-b border-zinc-800 bg-zinc-950/90 px-5 py-3 backdrop-blur">
        <div>
          <h2 className="text-[15px] font-semibold text-zinc-100">{def.name}</h2>
          <p className="text-[12px] text-zinc-500">
            {def.fullName}
            {def.references?.length ? ` · ${def.references.join(', ')}` : ''}
          </p>
        </div>
        <button
          className="ml-auto cursor-pointer rounded p-1 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200"
          onClick={onClose}
        >
          <X className="size-4" />
        </button>
      </header>
      <div className="flex flex-col gap-5 p-5">
        {def.description && (
          <p className="text-[13px] leading-relaxed text-zinc-400">{def.description}</p>
        )}

        {preview && preview.layers[0] && (
          <div>
            <h3 className="mb-1.5 text-[11px] font-semibold tracking-widest text-zinc-500 uppercase">
              Header layout · {bitsLabel(preview.layers[0].headerBytes * 8)}
            </h3>
            <BitGrid
              def={def}
              layout={preview.layers[0]}
              spans={preview.spans}
              color={color}
            />
          </div>
        )}

        <div>
          <h3 className="mb-1.5 text-[11px] font-semibold tracking-widest text-zinc-500 uppercase">
            Fields
          </h3>
          <table className="w-full text-[12px]">
            <tbody>
              {def.fields.map((f) => (
                <tr key={f.id} className="border-b border-zinc-800/60 last:border-0">
                  <td className="py-1 pr-2 whitespace-nowrap text-zinc-200">{f.name}</td>
                  <td className="py-1 pr-2 font-mono whitespace-nowrap text-zinc-500">
                    {typeof f.bitLength === 'number' ? bitsLabel(f.bitLength) : 'variable'}
                  </td>
                  <td className="py-1 text-zinc-500">{f.description ?? ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <RelationList
            title="Carried by"
            icon={<ArrowDownToLine className="size-3.5" />}
            items={carriedBy.map((p) => p.name)}
          />
          <RelationList
            title="Can carry"
            icon={<ArrowUpFromLine className="size-3.5" />}
            items={carries.map((p) => p.name)}
          />
        </div>
      </div>
    </aside>
  );
}

function RelationList({
  title,
  icon,
  items,
}: {
  title: string;
  icon: React.ReactNode;
  items: string[];
}) {
  return (
    <div>
      <h3 className="mb-1.5 flex items-center gap-1 text-[11px] font-semibold tracking-widest text-zinc-500 uppercase">
        {icon}
        {title}
      </h3>
      {items.length > 0 ? (
        <div className="flex flex-wrap gap-1">
          {items.map((name) => (
            <span
              key={name}
              className="rounded bg-zinc-800/80 px-1.5 py-0.5 text-[11px] text-zinc-300"
            >
              {name}
            </span>
          ))}
        </div>
      ) : (
        <p className="text-[12px] text-zinc-600 italic">nothing</p>
      )}
    </div>
  );
}
