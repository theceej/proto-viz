import { useMemo, useState } from 'react';
import { ArrowRight, List, Map, Search } from 'lucide-react';
import { useNavigate } from 'react-router';
import {
  bindingLabel,
  buildEncapsulationGraph,
  findCarrierPaths,
  type EncapsulationEdge,
} from '../../core/encapsulationGraph';
import type { LayerHint, ProtocolDefinition } from '../../core/model';
import { useLibraryStore } from '../../store/libraryStore';
import { useStackStore } from '../../store/stackStore';

const LAYERS: { value: '' | LayerHint; label: string }[] = [
  { value: '', label: 'All layers' },
  { value: 'link', label: 'Link' },
  { value: 'network', label: 'Network' },
  { value: 'transport', label: 'Transport' },
  { value: 'application', label: 'Application' },
  { value: 'tunnel', label: 'Tunnel' },
];

export default function EncapsulationMapPage() {
  const registry = useLibraryStore((state) => state.registry);
  const setStack = useStackStore((state) => state.setStack);
  const navigate = useNavigate();
  const graph = useMemo(() => buildEncapsulationGraph(registry.all()), [registry]);
  const protocols = useMemo(
    () =>
      [...graph.protocols].sort((a, b) =>
        a.name.localeCompare(b.name, 'en', { sensitivity: 'base' }),
      ),
    [graph],
  );
  const [query, setQuery] = useState('');
  const [layer, setLayer] = useState<'' | LayerHint>('');
  const [selectedId, setSelectedId] = useState('ipv4');
  const [targetId, setTargetId] = useState('vxlan');
  const [selectedEdge, setSelectedEdge] = useState<EncapsulationEdge | null>(null);
  const [view, setView] = useState<'map' | 'list'>('map');

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return protocols.filter(
      (protocol) =>
        (!layer || protocol.layerHint === layer) &&
        (!needle ||
          [protocol.id, protocol.name, protocol.fullName, protocol.description]
            .filter(Boolean)
            .some((value) => value!.toLowerCase().includes(needle))),
    );
  }, [protocols, query, layer]);
  const visibleIds = new Set(filtered.map((protocol) => protocol.id));
  const selected = registry.get(selectedId) ?? protocols[0];
  const incoming = graph.edges.filter((edge) => edge.innerId === selected?.id);
  const outgoing = graph.edges.filter((edge) => edge.outerId === selected?.id);
  const visibleEdges = graph.edges.filter(
    (edge) => visibleIds.has(edge.outerId) || visibleIds.has(edge.innerId),
  );
  const paths = useMemo(() => findCarrierPaths(graph, targetId), [graph, targetId]);

  const openPath = (protocolIds: string[]) => {
    setStack(protocolIds);
    navigate('/builder');
  };

  return (
    <div className="min-h-full p-6">
      <header className="flex flex-wrap items-end gap-3">
        <div className="mr-auto">
          <h1 className="text-[17px] font-semibold text-zinc-100">Encapsulation Map</h1>
          <p className="mt-1 max-w-3xl text-[12px] leading-relaxed text-zinc-500">
            Explore carrier relationships derived from the live protocol registry, including
            custom protocols.
          </p>
        </div>
        <label className="relative min-w-52 flex-1 sm:max-w-72">
          <span className="sr-only">Search protocols</span>
          <Search className="absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-zinc-500" />
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search protocols…"
            className="w-full rounded-md border border-zinc-700 bg-zinc-900 py-1.5 pr-2 pl-7 text-[13px] text-zinc-200 outline-none focus:border-cyan-600"
          />
        </label>
        <label>
          <span className="sr-only">Filter by layer</span>
          <select
            value={layer}
            onChange={(event) => setLayer(event.target.value as '' | LayerHint)}
            className="rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-[13px] text-zinc-200 outline-none focus:border-cyan-600"
          >
            {LAYERS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
      </header>

      <section
        aria-labelledby="pathfinder-heading"
        className="mt-5 rounded-lg border border-zinc-800 bg-zinc-900/40 p-4"
      >
        <div className="flex flex-wrap items-center gap-3">
          <div className="mr-auto">
            <h2 id="pathfinder-heading" className="text-[14px] font-semibold text-zinc-200">
              Stack pathfinder
            </h2>
            <p className="text-[11px] text-zinc-500">
              Shortest valid paths from a link-layer protocol.
            </p>
          </div>
          <label className="flex items-center gap-2 text-[12px] text-zinc-400">
            Target
            <select
              aria-label="Target protocol"
              value={targetId}
              onChange={(event) => setTargetId(event.target.value)}
              className="rounded-md border border-zinc-700 bg-zinc-950 px-2 py-1.5 text-zinc-200 outline-none focus:border-cyan-600"
            >
              {protocols.map((protocol) => (
                <option key={protocol.id} value={protocol.id}>
                  {protocol.name}
                </option>
              ))}
            </select>
          </label>
        </div>
        {paths.length > 0 ? (
          <ol className="mt-3 grid gap-2 lg:grid-cols-2">
            {paths.map((path) => (
              <li
                key={path.protocolIds.join('>')}
                className="flex items-center gap-3 rounded-md border border-zinc-800 bg-zinc-950/50 p-3"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-1 text-[12px] text-zinc-200">
                    {path.protocolIds.map((id, index) => (
                      <span key={`${id}-${index}`} className="contents">
                        {index > 0 && <ArrowRight className="size-3 text-zinc-600" aria-hidden />}
                        <span>{registry.get(id)?.name ?? id}</span>
                      </span>
                    ))}
                  </div>
                  <p className="mt-1 truncate font-mono text-[10px] text-zinc-500">
                    {path.edges.map(bindingLabel).join(' · ') || 'Link-layer start'}
                  </p>
                </div>
                <button
                  className="shrink-0 cursor-pointer rounded-md bg-cyan-700 px-2 py-1.5 text-[11px] font-medium text-white hover:bg-cyan-600"
                  onClick={() => openPath(path.protocolIds)}
                >
                  Open in Builder
                </button>
              </li>
            ))}
          </ol>
        ) : (
          <p className="mt-3 text-[12px] text-amber-300">
            No bounded carrier path was found for this protocol.
          </p>
        )}
      </section>

      <section aria-labelledby="browser-heading" className="mt-5">
        <div className="flex flex-wrap items-center gap-3">
          <h2 id="browser-heading" className="mr-auto text-[14px] font-semibold text-zinc-200">
            Relationship browser
          </h2>
          <div
            className="flex rounded-md border border-zinc-700 text-[12px]"
            role="group"
            aria-label="Relationship view"
          >
            <ViewButton active={view === 'map'} onClick={() => setView('map')} icon={Map}>
              Map
            </ViewButton>
            <ViewButton active={view === 'list'} onClick={() => setView('list')} icon={List}>
              List
            </ViewButton>
          </div>
        </div>

        {selectedEdge && (
          <EdgeExplanation edge={selectedEdge} protocols={protocols} />
        )}

        <div className="mt-3 grid min-h-96 gap-4 xl:grid-cols-[16rem_minmax(0,1fr)]">
          <div className="rounded-lg border border-zinc-800 bg-zinc-900/30 p-2">
            <h3 className="px-2 py-1 text-[10px] font-semibold tracking-widest text-zinc-500 uppercase">
              Protocols · {filtered.length}
            </h3>
            <ul className="max-h-[34rem] space-y-1 overflow-auto">
              {filtered.map((protocol) => (
                <li key={protocol.id}>
                  <button
                    aria-pressed={protocol.id === selected?.id}
                    className={`w-full cursor-pointer rounded px-2 py-1.5 text-left text-[12px] ${
                      protocol.id === selected?.id
                        ? 'bg-cyan-500/10 text-cyan-300'
                        : 'text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200'
                    }`}
                    onClick={() => setSelectedId(protocol.id)}
                  >
                    <span className="font-medium">{protocol.name}</span>
                    <span className="ml-2 text-[10px] text-zinc-600">{protocol.layerHint}</span>
                  </button>
                </li>
              ))}
            </ul>
            {filtered.length === 0 && (
              <p className="px-2 py-3 text-[12px] text-zinc-600">No matching protocols.</p>
            )}
          </div>

          {view === 'map' ? (
            <RelationshipMap
              selected={selected}
              incoming={incoming}
              outgoing={outgoing}
              registry={registry}
              onSelectProtocol={setSelectedId}
              onSelectEdge={setSelectedEdge}
            />
          ) : (
            <RelationshipList
              edges={visibleEdges}
              registry={registry}
              onSelect={setSelectedEdge}
            />
          )}
        </div>
      </section>
    </div>
  );
}

function ViewButton({
  active,
  onClick,
  icon: Icon,
  children,
}: {
  active: boolean;
  onClick: () => void;
  icon: typeof Map;
  children: React.ReactNode;
}) {
  return (
    <button
      aria-pressed={active}
      className={`flex cursor-pointer items-center gap-1 px-2 py-1 ${
        active ? 'bg-cyan-500/10 text-cyan-300' : 'text-zinc-400 hover:text-zinc-200'
      }`}
      onClick={onClick}
    >
      <Icon className="size-3.5" aria-hidden />
      {children}
    </button>
  );
}

function RelationshipMap({
  selected,
  incoming,
  outgoing,
  registry,
  onSelectProtocol,
  onSelectEdge,
}: {
  selected?: ProtocolDefinition;
  incoming: EncapsulationEdge[];
  outgoing: EncapsulationEdge[];
  registry: ReturnType<typeof useLibraryStore.getState>['registry'];
  onSelectProtocol: (id: string) => void;
  onSelectEdge: (edge: EncapsulationEdge) => void;
}) {
  if (!selected) return null;
  return (
    <div
      className="grid items-start gap-4 rounded-lg border border-zinc-800 bg-zinc-900/20 p-4 md:grid-cols-[1fr_auto_1fr]"
      aria-label={`Relationships for ${selected.name}`}
    >
      <RelationColumn
        title="Carriers"
        edges={incoming}
        protocolFor={(edge) => registry.get(edge.outerId)}
        onSelectProtocol={onSelectProtocol}
        onSelectEdge={onSelectEdge}
      />
      <div className="self-center rounded-lg border-2 border-cyan-700 bg-cyan-500/10 px-5 py-4 text-center">
        <strong className="text-[14px] text-cyan-200">{selected.name}</strong>
        <p className="mt-1 text-[10px] text-zinc-500">{selected.layerHint} layer</p>
      </div>
      <RelationColumn
        title="Payloads"
        edges={outgoing}
        protocolFor={(edge) => registry.get(edge.innerId)}
        onSelectProtocol={onSelectProtocol}
        onSelectEdge={onSelectEdge}
      />
    </div>
  );
}

function RelationColumn({
  title,
  edges,
  protocolFor,
  onSelectProtocol,
  onSelectEdge,
}: {
  title: string;
  edges: EncapsulationEdge[];
  protocolFor: (edge: EncapsulationEdge) => ProtocolDefinition | undefined;
  onSelectProtocol: (id: string) => void;
  onSelectEdge: (edge: EncapsulationEdge) => void;
}) {
  return (
    <div>
      <h3 className="mb-2 text-center text-[10px] font-semibold tracking-widest text-zinc-500 uppercase">
        {title}
      </h3>
      {edges.length > 0 ? (
        <ul className="space-y-2">
          {edges.map((edge) => {
            const protocol = protocolFor(edge);
            return (
              <li
                key={`${edge.outerId}>${edge.innerId}`}
                className="rounded-md border border-zinc-800 bg-zinc-950/50 p-2"
              >
                <button
                  className="w-full cursor-pointer text-left text-[12px] font-medium text-zinc-200 hover:text-cyan-300"
                  onClick={() => protocol && onSelectProtocol(protocol.id)}
                >
                  {protocol?.name ?? 'Unknown protocol'}
                </button>
                <button
                  className="mt-1 cursor-pointer font-mono text-[10px] text-zinc-500 hover:text-cyan-300"
                  onClick={() => onSelectEdge(edge)}
                >
                  {bindingLabel(edge)}
                </button>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="text-center text-[11px] text-zinc-600 italic">none</p>
      )}
    </div>
  );
}

function RelationshipList({
  edges,
  registry,
  onSelect,
}: {
  edges: EncapsulationEdge[];
  registry: ReturnType<typeof useLibraryStore.getState>['registry'];
  onSelect: (edge: EncapsulationEdge) => void;
}) {
  return (
    <div className="overflow-auto rounded-lg border border-zinc-800">
      <table className="w-full text-left text-[12px]">
        <thead className="sticky top-0 bg-zinc-900 text-[10px] tracking-widest text-zinc-500 uppercase">
          <tr>
            <th className="px-3 py-2">Carrier</th>
            <th className="px-3 py-2">Payload</th>
            <th className="px-3 py-2">Binding</th>
          </tr>
        </thead>
        <tbody>
          {edges.map((edge) => (
            <tr key={`${edge.outerId}>${edge.innerId}`} className="border-t border-zinc-800">
              <td className="px-3 py-2 text-zinc-300">{registry.get(edge.outerId)?.name}</td>
              <td className="px-3 py-2 text-zinc-300">{registry.get(edge.innerId)?.name}</td>
              <td className="px-3 py-2">
                <button
                  className="cursor-pointer font-mono text-zinc-500 hover:text-cyan-300"
                  onClick={() => onSelect(edge)}
                >
                  {bindingLabel(edge)}
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function EdgeExplanation({
  edge,
  protocols,
}: {
  edge: EncapsulationEdge;
  protocols: readonly ProtocolDefinition[];
}) {
  const name = (id: string) => protocols.find((protocol) => protocol.id === id)?.name ?? id;
  return (
    <div
      role="status"
      className="mt-3 rounded-md border border-cyan-800 bg-cyan-500/5 px-3 py-2 text-[12px] text-zinc-300"
    >
      <strong>{name(edge.outerId)}</strong> carries <strong>{name(edge.innerId)}</strong> via{' '}
      <span className="font-mono text-cyan-300">{bindingLabel(edge)}</span>
      {edge.selectorFieldId && (
        <span className="text-zinc-500"> · selector field {edge.selectorFieldId}</span>
      )}
    </div>
  );
}
