import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  Check,
  Download,
  Layers3,
  Plus,
  Search,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import type { LayerHint, ProtocolDefinition } from '../../core/model';
import { serializeStack } from '../../core/serialize';
import { carriersOf } from '../../core/bindings';
import { newLayer } from '../../core/model';
import { useLibraryStore } from '../../store/libraryStore';
import { useStackStore } from '../../store/stackStore';
import { deleteCustomProtocol, saveCustomProtocol } from '../../store/persistence';
import { exportLibraryJson, importLibraryJson } from '../../store/libraryJson';
import BitGrid from '../components/BitGrid';
import OsiModel from '../components/OsiModel';
import { layerColor } from '../colors';
import { usePersistedFlag } from '../usePersistedFlag';
import { bitsLabel } from '../format';
import { referencesFor } from '../../protocols/refs';
import {
  createLibrarySearchIndex,
  type LibrarySearchResult,
  type LibrarySearchResultKind,
} from '../../core/librarySearch';
import {
  PaneResizeHandle,
  usePersistedPaneWidth,
} from '../components/ResizablePanes';

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
  const custom = useLibraryStore((s) => s.custom);
  const addCustom = useLibraryStore((s) => s.addCustom);
  const [query, setQuery] = useState('');
  const [osiOpen, setOsiOpen] = usePersistedFlag('pv-osi-panel', false);
  // false = grouped by layer (each group A–Z); true = one flat A–Z list.
  const [nameSort, setNameSort] = usePersistedFlag('pv-library-name-sort', false);
  const [detailWidth, setDetailWidth] = usePersistedPaneWidth('pv-library-detail-width');
  const addLayer = useStackStore((s) => s.addLayer);
  const { protocolId } = useParams();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();

  const jumpToGroup = (layer: LayerHint) => {
    setQuery('');
    // After a possible query reset the section may not exist yet — defer.
    requestAnimationFrame(() => {
      document
        .getElementById(`layer-${layer}`)
        ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  };

  const exportLibrary = () => {
    const url = URL.createObjectURL(
      new Blob([exportLibraryJson(custom)], { type: 'application/json' }),
    );
    const a = document.createElement('a');
    a.href = url;
    a.download = 'proto-viz-library.json';
    a.click();
    URL.revokeObjectURL(url);
  };

  const importLibrary = async (file: File) => {
    try {
      const defs = importLibraryJson(await file.text());
      for (const def of defs) {
        addCustom(def);
        await saveCustomProtocol(def);
      }
    } catch (e) {
      alert((e as Error).message);
    }
  };

  const selected = protocolId ? registry.get(protocolId) : undefined;
  const focusedFieldId = searchParams.get('field') ?? undefined;

  const searchIndex = useMemo(
    () => createLibrarySearchIndex(registry.all(), referencesFor),
    [registry],
  );
  const searchResults = useMemo(() => searchIndex.search(query), [searchIndex, query]);

  const { sorted, groups } = useMemo(() => {
    const sorted = registry
      .all()
      .sort((a, b) => a.name.localeCompare(b.name, 'en', { sensitivity: 'base' }));
    const groups = LAYER_ORDER.map((layer) => ({
      layer,
      protocols: sorted.filter((p) => p.layerHint === layer),
    })).filter((g) => g.protocols.length > 0);
    return { sorted, groups };
  }, [registry]);

  const openSearchResult = (result: LibrarySearchResult) => {
    const field = result.fieldId ? `?field=${encodeURIComponent(result.fieldId)}` : '';
    navigate(`/library/${result.protocolId}${field}`);
  };

  return (
    <div className="flex h-full">
      {/* On phones the detail panel takes over the screen, so hide the list
          while a protocol is open (the panel's close button brings it back). */}
      <div className={`min-w-0 flex-1 overflow-auto ${selected ? 'max-md:hidden' : ''}`}>
        <header className="sticky top-0 z-10 flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-zinc-800 bg-zinc-950/90 px-6 py-3 backdrop-blur">
          <h1 className="text-[15px] font-semibold tracking-tight text-zinc-100">
            Protocol Library
          </h1>
          <button
            disabled={nameSort}
            className={`flex items-center gap-1 rounded-md border px-2 py-1 text-[12px] transition-colors ${
              nameSort
                ? 'cursor-not-allowed border-zinc-800 text-zinc-600'
                : osiOpen
                  ? 'cursor-pointer border-cyan-700 bg-cyan-500/10 text-cyan-300'
                  : 'cursor-pointer border-zinc-700 text-zinc-300 hover:border-zinc-500'
            }`}
            aria-pressed={osiOpen && !nameSort}
            title={
              nameSort
                ? 'The OSI model view groups by layer — switch to Layer sorting to use it'
                : 'Show how the library maps onto the OSI reference model'
            }
            onClick={() => setOsiOpen(!osiOpen)}
          >
            <Layers3 className="size-3.5" />
            OSI model
          </button>
          <div
            className="flex items-center rounded-md border border-zinc-700 text-[12px]"
            role="group"
            aria-label="Sort protocols"
          >
            <button
              className={`cursor-pointer rounded-l-md px-2 py-1 transition-colors ${
                !nameSort ? 'bg-cyan-500/10 text-cyan-300' : 'text-zinc-400 hover:text-zinc-200'
              }`}
              aria-pressed={!nameSort}
              title="Group by layer, each group A–Z"
              onClick={() => setNameSort(false)}
            >
              Layer
            </button>
            <button
              className={`cursor-pointer rounded-r-md border-l border-zinc-700 px-2 py-1 transition-colors ${
                nameSort ? 'bg-cyan-500/10 text-cyan-300' : 'text-zinc-400 hover:text-zinc-200'
              }`}
              aria-pressed={nameSort}
              title="One flat list, A–Z across all layers"
              onClick={() => setNameSort(true)}
            >
              A–Z
            </button>
          </div>
          <div className="ml-auto flex min-w-0 flex-1 items-center justify-end gap-2 sm:flex-none">
            {custom.length > 0 && (
              <button
                className="flex cursor-pointer items-center gap-1 rounded-md border border-zinc-700 px-2 py-1 text-[12px] text-zinc-300 hover:border-zinc-500"
                aria-label="Export"
                title="Download your custom protocols as JSON"
                onClick={exportLibrary}
              >
                <Download className="size-3.5 shrink-0" />
                <span className="hidden sm:inline">Export</span>
              </button>
            )}
            <label
              className="flex cursor-pointer items-center gap-1 rounded-md border border-zinc-700 px-2 py-1 text-[12px] text-zinc-300 hover:border-zinc-500"
              title="Import a proto-viz library JSON file"
            >
              <Upload className="size-3.5 shrink-0" />
              <span className="hidden sm:inline">Import</span>
              <input
                type="file"
                accept=".json"
                aria-label="Import library JSON"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) void importLibrary(file);
                  e.target.value = '';
                }}
              />
            </label>
            <div className="relative min-w-0 flex-1 sm:flex-none">
              <Search className="absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-zinc-500" />
              <input
                type="search"
                className="w-full rounded-md border border-zinc-700 bg-zinc-900 py-1 pr-2 pl-7 text-[13px] text-zinc-200 outline-none placeholder:text-zinc-600 focus:border-cyan-600 sm:w-56"
                placeholder="Search protocols, fields, values…"
                aria-label="Search protocol library"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </div>
          </div>
        </header>
        {osiOpen && !nameSort && !query.trim() && (
          <OsiModel registry={registry} onJump={jumpToGroup} />
        )}
        <div className="flex flex-col gap-6 p-6">
          {query.trim() ? (
            <SearchResults
              query={query}
              results={searchResults}
              onOpen={openSearchResult}
            />
          ) : nameSort ? (
            <div className="grid grid-cols-[repeat(auto-fill,minmax(15rem,1fr))] gap-3">
              {sorted.map((p) => (
                <ProtocolTile
                  key={p.id}
                  def={p}
                  selected={selected?.id === p.id}
                  onOpen={() => navigate(`/library/${p.id}`)}
                  onAdd={() => addLayer(p.id)}
                />
              ))}
            </div>
          ) : (
            groups.map((g) => (
              <section key={g.layer} id={`layer-${g.layer}`} className="scroll-mt-14">
                <h2 className="mb-2 text-[11px] font-semibold tracking-widest text-zinc-500 uppercase">
                  {LAYER_LABEL[g.layer]}
                </h2>
                <div className="grid grid-cols-[repeat(auto-fill,minmax(15rem,1fr))] gap-3">
                  {g.protocols.map((p) => (
                    <ProtocolTile
                      key={p.id}
                      def={p}
                      selected={selected?.id === p.id}
                      onOpen={() => navigate(`/library/${p.id}`)}
                      onAdd={() => addLayer(p.id)}
                    />
                  ))}
                </div>
              </section>
            ))
          )}
        </div>
      </div>
      {selected && (
        <>
          <PaneResizeHandle
            className="hidden md:block"
            label="Resize protocol list and protocol details"
            reverse
            value={detailWidth}
            onChange={setDetailWidth}
          />
          <DetailPanel
            def={selected}
            focusedFieldId={focusedFieldId}
            width={detailWidth}
            onClose={() => navigate('/library')}
          />
        </>
      )}
    </div>
  );
}

const RESULT_LABEL: Record<LibrarySearchResultKind, string> = {
  protocol: 'Protocol',
  field: 'Field',
  assignment: 'Assignment',
  reference: 'Reference',
};

function SearchResults({
  query,
  results,
  onOpen,
}: {
  query: string;
  results: LibrarySearchResult[];
  onOpen: (result: LibrarySearchResult) => void;
}) {
  if (results.length === 0) {
    return <p className="text-sm text-zinc-500">No library entries match “{query}”.</p>;
  }
  return (
    <section aria-labelledby="library-search-results-heading">
      <h2
        id="library-search-results-heading"
        className="mb-2 text-[11px] font-semibold tracking-widest text-zinc-500 uppercase"
      >
        Search results
      </h2>
      <p className="sr-only" aria-live="polite">
        {results.length} result{results.length === 1 ? '' : 's'} for {query}
      </p>
      <ul className="grid grid-cols-[repeat(auto-fill,minmax(18rem,1fr))] gap-2">
        {results.map((result) => (
          <li key={result.key}>
            <button
              className="h-full w-full cursor-pointer rounded-lg border border-zinc-800 bg-zinc-900/40 p-3 text-left hover:border-zinc-600 focus-visible:border-cyan-500 focus-visible:outline-none"
              onClick={() => onOpen(result)}
            >
              <div className="flex items-baseline justify-between gap-2">
                <strong className="text-[13px] text-zinc-100">{result.title}</strong>
                <span className="shrink-0 rounded bg-cyan-500/10 px-1.5 py-0.5 text-[10px] font-medium tracking-wide text-cyan-300 uppercase">
                  {RESULT_LABEL[result.kind]}
                </span>
              </div>
              <p className="mt-1 text-[11px] leading-snug text-zinc-500">{result.detail}</p>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * Flash "added" feedback for ~1.2s after an add-to-stack action, then revert.
 * Cleans its timer up on unmount and on repeated clicks.
 */
function useAddedFeedback(): [boolean, () => void] {
  const [added, setAdded] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  const flash = () => {
    setAdded(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setAdded(false), 1200);
  };
  return [added, flash];
}

function ProtocolTile({
  def,
  selected,
  onOpen,
  onAdd,
}: {
  def: ProtocolDefinition;
  selected: boolean;
  onOpen: () => void;
  onAdd: () => void;
}) {
  const [added, flash] = useAddedFeedback();
  const references = referencesFor(def.id, def.references);
  return (
    <div
      className={`group relative flex rounded-lg border transition-colors ${
        selected
          ? 'border-cyan-600 bg-cyan-500/5'
          : 'border-zinc-800 bg-zinc-900/40 hover:border-zinc-600'
      }`}
    >
      <button
        className="min-w-0 flex-1 cursor-pointer p-3 pr-10 text-left"
        onClick={onOpen}
      >
        <div className="flex items-baseline gap-2">
          <span className="truncate text-[14px] font-semibold text-zinc-100">{def.name}</span>
          {def.source === 'custom' && (
            <span className="rounded bg-violet-500/20 px-1.5 text-[10px] text-violet-300">
              custom
            </span>
          )}
        </div>
        <p className="mt-1 line-clamp-2 text-[12px] leading-snug text-zinc-500">
          {def.fullName ?? def.description ?? ''}
        </p>
        {references[0] && (
          <span className="mt-1.5 inline-block rounded border border-zinc-700/60 bg-zinc-800/50 px-1.5 py-0.5 font-mono text-[10px] text-zinc-400">
            {references[0].name}
          </span>
        )}
      </button>
      <button
        className={`absolute top-2 right-2 grid size-6 cursor-pointer place-items-center rounded-md border transition-colors ${
          added
            ? 'border-emerald-600 text-emerald-400'
            : 'border-zinc-700 text-zinc-400 opacity-0 group-hover:opacity-100 focus-visible:opacity-100 hover:border-cyan-600 hover:text-cyan-300'
        }`}
        title={`Add ${def.name} to the stack`}
        aria-label={added ? `${def.name} added to stack` : `Add ${def.name} to the stack`}
        onClick={() => {
          onAdd();
          flash();
        }}
      >
        {added ? <Check className="size-3.5" aria-hidden /> : <Plus className="size-3.5" aria-hidden />}
      </button>
    </div>
  );
}

function DetailPanel({
  def,
  focusedFieldId,
  width,
  onClose,
}: {
  def: ProtocolDefinition;
  focusedFieldId?: string;
  width: number | null;
  onClose: () => void;
}) {
  const registry = useLibraryStore((s) => s.registry);
  const removeCustom = useLibraryStore((s) => s.removeCustom);
  const references = referencesFor(def.id, def.references);
  const focusedField = useRef<HTMLTableRowElement | null>(null);

  useEffect(() => {
    if (!focusedFieldId || !focusedField.current) return;
    focusedField.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
    focusedField.current.focus({ preventScroll: true });
  }, [def.id, focusedFieldId]);

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
    <aside
      aria-label={`${def.name} protocol details`}
      className="flex w-full shrink-0 flex-col overflow-auto border-l border-zinc-800 bg-zinc-900/30 md:w-[var(--library-detail-width)] md:max-w-[calc(100vw-18rem)]"
      style={
        {
          '--library-detail-width': width === null ? '30rem' : `${width}px`,
        } as React.CSSProperties
      }
    >
      <header className="sticky top-0 flex items-start gap-2 border-b border-zinc-800 bg-zinc-950/90 px-5 py-3 backdrop-blur">
        <div>
          <h2 className="text-[15px] font-semibold text-zinc-100">{def.name}</h2>
          {def.fullName && <p className="text-[12px] text-zinc-500">{def.fullName}</p>}
        </div>
        <div className="ml-auto flex items-center gap-1">
          {def.source === 'custom' && (
            <button
              className="cursor-pointer rounded p-1.5 text-zinc-500 hover:bg-zinc-800 hover:text-rose-400"
              title="Delete this custom protocol"
              aria-label={`Delete custom protocol ${def.name}`}
              onClick={() => {
                removeCustom(def.id);
                void deleteCustomProtocol(def.id);
                onClose();
              }}
            >
              <Trash2 className="size-4" />
            </button>
          )}
          <button
            className="cursor-pointer rounded p-1.5 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200"
            aria-label="Close protocol details"
            onClick={onClose}
          >
            <X className="size-4" />
          </button>
        </div>
      </header>
      <div className="flex flex-col gap-5 p-5">
        <AddToStackButton def={def} />

        {def.description && (
          <p className="text-[13px] leading-relaxed text-zinc-400">{def.description}</p>
        )}

        {references.length > 0 && (
          <section aria-labelledby="protocol-references-heading">
            <h3
              id="protocol-references-heading"
              className="mb-1.5 text-[11px] font-semibold tracking-widest text-zinc-500 uppercase"
            >
              References
            </h3>
            <ul className="list-disc space-y-1 pl-5 text-[12px] text-zinc-400">
              {references.map(({ name, url }) => (
                <li key={`${name}:${url ?? ''}`}>
                  {url ? (
                    <a
                      className="underline decoration-zinc-600 hover:text-cyan-300 hover:decoration-cyan-300"
                      href={url}
                      target="_blank"
                      rel="noreferrer noopener"
                      title={`Open ${name} (opens in a new tab)`}
                    >
                      {name}
                    </a>
                  ) : (
                    name
                  )}
                </li>
              ))}
            </ul>
          </section>
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
              minWidthClass=""
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
                <tr
                  key={f.id}
                  ref={f.id === focusedFieldId ? focusedField : undefined}
                  tabIndex={f.id === focusedFieldId ? -1 : undefined}
                  data-focused={f.id === focusedFieldId || undefined}
                  className={`border-b border-zinc-800/60 last:border-0 ${
                    f.id === focusedFieldId
                      ? 'bg-cyan-500/10 outline outline-1 -outline-offset-1 outline-cyan-600'
                      : ''
                  }`}
                >
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

function AddToStackButton({ def }: { def: ProtocolDefinition }) {
  const addLayer = useStackStore((s) => s.addLayer);
  const [added, flash] = useAddedFeedback();
  return (
    <button
      className={`flex cursor-pointer items-center justify-center gap-1.5 rounded-md px-3 py-2 text-[13px] font-medium transition-colors ${
        added
          ? 'bg-emerald-600/20 text-emerald-300'
          : 'bg-cyan-700 text-white hover:bg-cyan-600'
      }`}
      aria-label={added ? `${def.name} added to stack` : `Add ${def.name} to the stack`}
      onClick={() => {
        addLayer(def.id);
        flash();
      }}
    >
      {added ? (
        <>
          <Check className="size-4" aria-hidden /> Added to stack
        </>
      ) : (
        <>
          <Plus className="size-4" aria-hidden /> Add to stack
        </>
      )}
    </button>
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
