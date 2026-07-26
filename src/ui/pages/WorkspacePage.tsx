import { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, Download, FileJson, Upload } from 'lucide-react';
import { useLibraryStore } from '../../store/libraryStore';
import { useStackStore } from '../../store/stackStore';
import { useComparisonStore } from '../../store/comparisonStore';
import {
  clearComposedScenario,
  loadComposedScenario,
  readRawComposedScenario,
  restoreRawComposedScenario,
  saveComposedScenario,
} from '../../store/composedScenarioPersistence';
import {
  applyPersistenceSnapshot,
  loadPersistenceSnapshot,
  type PersistenceSnapshot,
} from '../../store/persistence';
import {
  exportWorkspaceJson,
  parseWorkspaceJson,
  planWorkspaceImport,
  WORKSPACE_VERSION,
  type ParsedWorkspace,
  type WorkspaceImportChoices,
  type WorkspaceImportPlan,
  type WorkspaceLocalSnapshot,
} from '../../store/workspaceJson';

const MAX_FILE_SIZE = 10 * 1024 * 1024;
const DOWNLOAD_NAME = 'workspace.proto-viz-workspace.json';

type Status = { kind: 'success' | 'error'; message: string } | null;

interface ExportSelection {
  customProtocols: boolean;
  savedStacks: boolean;
  currentStack: boolean;
  comparisons: boolean;
  composedScenario: boolean;
}

interface ReviewState {
  incoming: ParsedWorkspace;
  local: WorkspaceLocalSnapshot;
  durable: PersistenceSnapshot;
  durableKey: string;
  localKey: string;
  fileName: string;
}

export default function WorkspacePage() {
  const custom = useLibraryStore((state) => state.custom);
  const setCustom = useLibraryStore((state) => state.setCustom);
  const layers = useStackStore((state) => state.layers);
  const trailingPayload = useStackStore((state) => state.trailingPayload);
  const comparisons = useComparisonStore((state) => state.packets);
  const replacePackets = useComparisonStore((state) => state.replacePackets);
  const [selection, setSelection] = useState<ExportSelection>({
    customProtocols: true,
    savedStacks: true,
    currentStack: layers.length > 0,
    comparisons: comparisons.length > 0,
    composedScenario: loadComposedScenario() !== null,
  });
  const [review, setReview] = useState<ReviewState | null>(null);
  const [choices, setChoices] = useState<WorkspaceImportChoices>({});
  const [confirmedReplace, setConfirmedReplace] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<Status>(null);

  const plan = useMemo(
    () => review ? planWorkspaceImport(review.incoming, review.local, choices) : null,
    [review, choices],
  );
  const hasDurableReplace =
    (review?.incoming.customProtocols !== undefined && choices.customProtocols?.mode === 'replace') ||
    (review?.incoming.savedStacks !== undefined && choices.savedStacks?.mode === 'replace') ||
    (review?.incoming.composedScenario !== undefined && choices.composedScenario === 'replace');

  const exportWorkspace = async () => {
    setBusy(true);
    setStatus(null);
    const persisted = await loadPersistenceSnapshot();
    if (!persisted.ok) {
      setStatus({ kind: 'error', message: `Could not read saved workspace data (${persisted.errorName}).` });
      setBusy(false);
      return;
    }
    try {
      const text = exportWorkspaceJson(
        {
          customProtocols: custom,
          savedStacks: persisted.data.savedStacks,
          currentStack: { layers, trailingPayload },
          comparisons,
          composedScenario: loadComposedScenario(),
        },
        selection,
      );
      const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = DOWNLOAD_NAME;
      anchor.click();
      URL.revokeObjectURL(url);
      setStatus({ kind: 'success', message: `Downloaded ${DOWNLOAD_NAME}.` });
    } catch (error) {
      setStatus({ kind: 'error', message: errorMessage(error) });
    } finally {
      setBusy(false);
    }
  };

  const openWorkspace = async (file: File) => {
    setStatus(null);
    setReview(null);
    setConfirmedReplace(false);
    if (file.size > MAX_FILE_SIZE) {
      setStatus({ kind: 'error', message: 'Workspace files must be 10 MiB or smaller.' });
      return;
    }
    setBusy(true);
    try {
      const incoming = parseWorkspaceJson(await file.text());
      const persisted = await loadPersistenceSnapshot();
      if (!persisted.ok) throw new Error(`Could not read existing workspace data (${persisted.errorName}).`);
      const local = currentSnapshot(persisted.data);
      setReview({ incoming, local, durable: persisted.data, durableKey: durableKey(persisted.data), localKey: localSnapshotKey(local), fileName: file.name });
      setChoices(defaultChoices(incoming));
      setStatus({ kind: 'success', message: 'Workspace parsed. Review the proposed changes before applying.' });
    } catch (error) {
      setStatus({ kind: 'error', message: errorMessage(error) });
    } finally {
      setBusy(false);
    }
  };

  const applyImport = async () => {
    if (!review || !plan || !plan.ok || (hasDurableReplace && !confirmedReplace)) return;
    setBusy(true);
    setStatus(null);
    const fresh = await loadPersistenceSnapshot();
    if (!fresh.ok) {
      setStatus({ kind: 'error', message: `Could not re-read workspace data (${fresh.errorName}); nothing was changed.` });
      setBusy(false);
      return;
    }
    const freshLocal = currentSnapshot(fresh.data);
    const freshPlan = planWorkspaceImport(review.incoming, freshLocal, choices);
    if (durableKey(fresh.data) !== review.durableKey || localSnapshotKey(freshLocal) !== review.localKey) {
      setReview({ ...review, local: freshLocal, durable: fresh.data, durableKey: durableKey(fresh.data), localKey: localSnapshotKey(freshLocal) });
      setConfirmedReplace(false);
      setStatus({ kind: 'error', message: 'Local workspace data changed during review. The import plan was refreshed; review it before applying again.' });
      setBusy(false);
      return;
    }
    if (!freshPlan.ok) {
      setReview({ ...review, local: freshLocal, durable: fresh.data });
      setStatus({ kind: 'error', message: 'The refreshed import plan contains errors. Nothing was changed.' });
      setBusy(false);
      return;
    }

    const hasPersistentSections = review.incoming.customProtocols !== undefined || review.incoming.savedStacks !== undefined;
    const persistenceResult = hasPersistentSections
      ? await applyPersistenceSnapshot({
          customProtocols: review.incoming.customProtocols === undefined
            ? { mode: 'untouched' }
            : { mode: choices.customProtocols?.mode ?? 'merge', data: freshPlan.prospective.customProtocols },
          savedStacks: review.incoming.savedStacks === undefined
            ? { mode: 'untouched' }
            : { mode: choices.savedStacks?.mode ?? 'merge', data: freshPlan.prospective.savedStacks },
        }, fresh.data.revision)
      : { ok: true as const, revision: fresh.data.revision };
    if (!persistenceResult.ok) {
      setStatus({ kind: 'error', message: `Import failed in IndexedDB (${persistenceResult.errorName}); nothing was changed.` });
      setBusy(false);
      return;
    }

    const oldRawScenario = readRawComposedScenario();
    const shouldWriteScenario = review.incoming.composedScenario !== undefined &&
      (choices.composedScenario ?? 'replace') === 'replace';
    const scenarioSaved = !shouldWriteScenario || (freshPlan.prospective.composedScenario === null
      ? clearComposedScenario()
      : saveComposedScenario(freshPlan.prospective.composedScenario));
    if (!scenarioSaved) {
      const rollback = hasPersistentSections
        ? await applyPersistenceSnapshot({
            customProtocols: { mode: 'replace', data: review.durable.customProtocols },
            savedStacks: { mode: 'replace', data: review.durable.savedStacks },
          }, persistenceResult.revision)
        : { ok: true as const };
      const scenarioRestored = restoreRawComposedScenario(oldRawScenario);
      const detail = rollback.ok && scenarioRestored
        ? 'Previous data was restored.'
        : 'Automatic rollback was incomplete; reload the page and check your saved data.';
      setStatus({ kind: 'error', message: `The scenario could not be saved. ${detail}` });
      setBusy(false);
      return;
    }

    if (review.incoming.customProtocols !== undefined) {
      setCustom(freshPlan.prospective.customProtocols);
    }
    if (review.incoming.comparisons !== undefined) {
      replacePackets(freshPlan.prospective.comparisons.map(({ label, packet }) => ({ label, packet })));
    }
    if (review.incoming.currentStack !== undefined && (choices.currentStack ?? 'replace') === 'replace') {
      const stackStore = useStackStore.getState();
      stackStore.restoreStack(freshPlan.prospective.currentStack.layers, freshPlan.prospective.currentStack.trailingPayload);
      stackStore.clearHistory();
    }
    setReview(null);
    setStatus({ kind: 'success', message: 'Workspace imported successfully.' });
    setBusy(false);
  };

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-7 sm:px-7 sm:py-9">
      <header className="max-w-2xl">
        <div className="flex items-center gap-2 text-cyan-300">
          <FileJson className="size-5" />
          <span className="text-[11px] font-semibold tracking-[0.18em] uppercase">Local workspace transfer</span>
        </div>
        <h1 className="mt-3 text-2xl font-semibold tracking-tight text-zinc-100">Workspace</h1>
        <p className="mt-2 text-[13px] leading-relaxed text-zinc-400">
          Move your protocol work between browsers with one reviewed JSON file. Files are generated and read locally; nothing is uploaded.
        </p>
      </header>

      {status && (
        <div role={status.kind === 'error' ? 'alert' : 'status'} className={`mt-5 rounded-lg border px-4 py-3 text-[13px] ${status.kind === 'error' ? 'border-red-800 bg-red-950/30 text-red-200' : 'border-emerald-800 bg-emerald-950/30 text-emerald-200'}`}>
          {status.message}
        </div>
      )}

      <div className="mt-6 grid gap-5 lg:grid-cols-2">
        <section className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-5">
          <h2 className="flex items-center gap-2 text-[15px] font-semibold text-zinc-100"><Download className="size-4 text-cyan-400" /> Export</h2>
          <p className="mt-2 text-[12px] leading-relaxed text-zinc-500">Choose what travels with this workspace.</p>
          <fieldset className="mt-4 space-y-2.5">
            <legend className="sr-only">Workspace export sections</legend>
            <Check label={`Custom protocols (${custom.length})`} checked={selection.customProtocols} onChange={(value) => setSelection({ ...selection, customProtocols: value })} />
            <Check label="Saved stacks" checked={selection.savedStacks} onChange={(value) => setSelection({ ...selection, savedStacks: value })} />
            <Check label={`Current Builder stack (${layers.length} layers)`} checked={selection.currentStack} disabled={layers.length === 0} onChange={(value) => setSelection({ ...selection, currentStack: value })} />
            <Check label={`Packet comparisons (${comparisons.length})`} checked={selection.comparisons} disabled={comparisons.length === 0} onChange={(value) => setSelection({ ...selection, comparisons: value })} />
            <Check label="Composed scenario" checked={selection.composedScenario} disabled={loadComposedScenario() === null} onChange={(value) => setSelection({ ...selection, composedScenario: value })} />
          </fieldset>
          <p className="mt-4 rounded-md bg-zinc-950/60 p-3 text-[12px] leading-relaxed text-zinc-400">
            Any custom protocol referenced by an exported stack, comparison, or scenario is included automatically, even if custom protocols are unchecked.
          </p>
          <button type="button" disabled={busy} onClick={() => void exportWorkspace()} className={primaryButton}>
            <Download className="size-4" /> Download workspace
          </button>
        </section>

        <section className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-5">
          <h2 className="flex items-center gap-2 text-[15px] font-semibold text-zinc-100"><Upload className="size-4 text-cyan-400" /> Import</h2>
          <p className="mt-2 text-[12px] leading-relaxed text-zinc-500">Open a workspace JSON file up to 10 MiB. You will review every change before it is written.</p>
          <label className="mt-5 flex min-h-28 cursor-pointer flex-col items-center justify-center rounded-lg border border-dashed border-zinc-700 bg-zinc-950/30 px-4 text-center hover:border-cyan-700">
            <Upload className="mb-2 size-5 text-zinc-500" />
            <span className="text-[13px] font-medium text-zinc-200">Choose workspace file</span>
            <span className="mt-1 text-[11px] text-zinc-500">.proto-viz-workspace.json or legacy library JSON</span>
            <input type="file" accept=".json,.proto-viz-workspace.json,application/json" className="sr-only" disabled={busy} onChange={(event) => { const file = event.target.files?.[0]; if (file) void openWorkspace(file); event.target.value = ''; }} />
          </label>
        </section>
      </div>

      {review && plan && (
        <ImportReview review={review} plan={plan} choices={choices} setChoices={(next) => { setChoices(next); setConfirmedReplace(false); }} confirmedReplace={confirmedReplace} setConfirmedReplace={setConfirmedReplace} hasDurableReplace={hasDurableReplace} busy={busy} onApply={() => void applyImport()} />
      )}
    </div>
  );
}

function ImportReview({ review, plan, choices, setChoices, confirmedReplace, setConfirmedReplace, hasDurableReplace, busy, onApply }: {
  review: ReviewState;
  plan: WorkspaceImportPlan;
  choices: WorkspaceImportChoices;
  setChoices: (choices: WorkspaceImportChoices) => void;
  confirmedReplace: boolean;
  setConfirmedReplace: (value: boolean) => void;
  hasDurableReplace: boolean;
  busy: boolean;
  onApply: () => void;
}) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => headingRef.current?.focus(), []);
  const incoming = review.incoming;
  const hasAnyReplace = choices.customProtocols?.mode === 'replace' ||
    choices.savedStacks?.mode === 'replace' ||
    choices.comparisons?.mode === 'replace' ||
    choices.currentStack === 'replace' ||
    choices.composedScenario === 'replace';
  return (
    <section className="mt-6 rounded-xl border border-zinc-700 bg-zinc-900/60 p-4 sm:p-6" aria-labelledby="review-heading">
      <h2 ref={headingRef} tabIndex={-1} id="review-heading" className="text-lg font-semibold text-zinc-100 outline-none">Review import</h2>
      <dl className="mt-3 grid gap-2 text-[12px] sm:grid-cols-3">
        <Meta term="File" value={review.fileName} />
        <Meta term="Format" value={`Workspace version ${WORKSPACE_VERSION}`} />
        <Meta term="Exported" value={new Date(incoming.exportedAt).toLocaleString()} />
      </dl>
      <div className="mt-5 grid gap-4 md:grid-cols-2">
        {incoming.customProtocols !== undefined && <Category title={`Custom protocols (${incoming.customProtocols.length})`}><RadioGroup label="Protocol import mode" value={choices.customProtocols?.mode ?? 'merge'} options={['merge', 'replace']} onChange={(mode) => setChoices({ ...choices, customProtocols: { ...choices.customProtocols, mode: mode as 'merge' | 'replace', conflict: choices.customProtocols?.conflict ?? 'keep' } })} /><RadioGroup label="Matching protocol IDs" value={choices.customProtocols?.conflict ?? 'keep'} options={['keep', 'overwrite']} onChange={(conflict) => setChoices({ ...choices, customProtocols: { mode: choices.customProtocols?.mode ?? 'merge', conflict: conflict as 'keep' | 'overwrite' } })} /></Category>}
        {incoming.savedStacks !== undefined && <Category title={`Saved stacks (${incoming.savedStacks.length})`}><RadioGroup label="Stack import mode" value={choices.savedStacks?.mode ?? 'merge'} options={['merge', 'replace']} onChange={(mode) => setChoices({ ...choices, savedStacks: { ...choices.savedStacks, mode: mode as 'merge' | 'replace', conflict: choices.savedStacks?.conflict ?? 'keep' } })} /><RadioGroup label="Matching stack IDs" value={choices.savedStacks?.conflict ?? 'keep'} options={['keep', 'overwrite', 'copy']} onChange={(conflict) => setChoices({ ...choices, savedStacks: { mode: choices.savedStacks?.mode ?? 'merge', conflict: conflict as 'keep' | 'overwrite' | 'copy' } })} /></Category>}
        {incoming.comparisons !== undefined && <Category title={`Comparisons (${incoming.comparisons.length})`}><RadioGroup label="Comparison import mode" value={choices.comparisons?.mode ?? 'merge'} options={['merge', 'replace']} onChange={(mode) => setChoices({ ...choices, comparisons: { mode: mode as 'merge' | 'replace' } })} /></Category>}
        {incoming.currentStack !== undefined && <Category title="Current Builder stack (1)"><RadioGroup label="Current stack choice" value={choices.currentStack ?? 'replace'} options={['keep', 'replace']} onChange={(value) => setChoices({ ...choices, currentStack: value as 'keep' | 'replace' })} /></Category>}
        {incoming.composedScenario !== undefined && <Category title={`Composed scenario (${incoming.composedScenario === null ? 'empty' : '1'})`}><RadioGroup label="Scenario choice" value={choices.composedScenario ?? 'replace'} options={['keep', 'replace']} onChange={(value) => setChoices({ ...choices, composedScenario: value as 'keep' | 'replace' })} /></Category>}
      </div>

      <div className="mt-5 rounded-lg border border-zinc-800 bg-zinc-950/40 p-4">
        <h3 className="text-[13px] font-semibold text-zinc-200">Live plan</h3>
        <p className="mt-1 text-[12px] text-zinc-400">Incoming: {plan.counts.protocols} protocols, {plan.counts.stacks} stacks, {plan.counts.comparisons} comparisons, {plan.counts.currentStack} current stack, {plan.counts.composedScenario} scenario.</p>
        <p className="mt-1 text-[12px] text-zinc-500">Result: {plan.prospective.customProtocols.length} custom protocols, {plan.prospective.savedStacks.length} saved stacks, {plan.prospective.comparisons.length} comparisons.</p>
        <Diagnostics title="Warnings and conflicts" items={[...incoming.warnings, ...plan.conflicts]} />
        <Diagnostics title="Errors" items={plan.errors} error />
      </div>

      {hasAnyReplace && (
        <p className="mt-4 flex gap-2 rounded-lg border border-amber-900/70 bg-amber-950/15 p-3 text-[12px] leading-relaxed text-amber-200">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" /> Replace discards the local value or entries in each category set to Replace; merge and keep categories are unaffected.
        </p>
      )}

      {hasDurableReplace && (
        <div className="mt-4 rounded-lg border border-amber-800 bg-amber-950/20 p-4">
          <div className="flex gap-2 text-[13px] font-medium text-amber-200"><AlertTriangle className="mt-0.5 size-4 shrink-0" /> Replace will overwrite durable browser data.</div>
          <label className="mt-3 flex cursor-pointer items-start gap-2 text-[12px] text-zinc-300"><input type="checkbox" className="mt-0.5 accent-cyan-500" checked={confirmedReplace} onChange={(event) => setConfirmedReplace(event.target.checked)} /> I understand that selected saved protocols, stacks, or scenario data will be replaced.</label>
        </div>
      )}
      <button type="button" className={primaryButton} disabled={busy || !plan.ok || (hasDurableReplace && !confirmedReplace)} onClick={onApply}>Apply import</button>
    </section>
  );
}

function Check({ label, checked, disabled, onChange }: { label: string; checked: boolean; disabled?: boolean; onChange: (value: boolean) => void }) {
  return <label className={`flex items-center gap-2 text-[13px] ${disabled ? 'text-zinc-600' : 'cursor-pointer text-zinc-300'}`}><input type="checkbox" checked={checked} disabled={disabled} className="size-4 accent-cyan-500" onChange={(event) => onChange(event.target.checked)} />{label}</label>;
}

function Category({ title, children }: { title: string; children: React.ReactNode }) {
  return <div className="rounded-lg border border-zinc-800 p-4"><h3 className="text-[13px] font-medium text-zinc-200">{title}</h3><div className="mt-3 space-y-3">{children}</div></div>;
}

function RadioGroup({ label, value, options, onChange }: { label: string; value: string; options: string[]; onChange: (value: string) => void }) {
  return <fieldset><legend className="text-[11px] text-zinc-500">{label}</legend><div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-2">{options.map((option) => <label key={option} className="flex cursor-pointer items-center gap-1.5 text-[12px] capitalize text-zinc-300"><input type="radio" name={label} checked={value === option} onChange={() => onChange(option)} className="accent-cyan-500" />{option}</label>)}</div></fieldset>;
}

function Meta({ term, value }: { term: string; value: string }) {
  return <div className="min-w-0 rounded-md bg-zinc-950/40 px-3 py-2"><dt className="text-zinc-600">{term}</dt><dd className="mt-0.5 truncate text-zinc-300" title={value}>{value}</dd></div>;
}

function Diagnostics({ title, items, error = false }: { title: string; items: ParsedWorkspace['warnings']; error?: boolean }) {
  if (items.length === 0) return null;
  return <div className="mt-3" role={error ? 'alert' : undefined}><h4 className={`text-[12px] font-medium ${error ? 'text-red-300' : 'text-amber-300'}`}>{title}</h4><ul className="mt-1 list-disc space-y-1 pl-5 text-[12px] text-zinc-400">{items.map((item, index) => <li key={`${item.code}-${item.path ?? index}`}>{item.message}{item.path ? ` (${item.path})` : ''}</li>)}</ul></div>;
}

function currentSnapshot(persisted: PersistenceSnapshot): WorkspaceLocalSnapshot {
  const stack = useStackStore.getState();
  return {
    customProtocols: persisted.customProtocols,
    savedStacks: persisted.savedStacks,
    currentStack: { layers: stack.layers, trailingPayload: stack.trailingPayload },
    comparisons: useComparisonStore.getState().packets,
    composedScenario: loadComposedScenario(),
  };
}

function defaultChoices(incoming: ParsedWorkspace): WorkspaceImportChoices {
  return {
    ...(incoming.customProtocols === undefined ? {} : { customProtocols: { mode: 'merge', conflict: 'keep' } }),
    ...(incoming.savedStacks === undefined ? {} : { savedStacks: { mode: 'merge', conflict: 'keep' } }),
    ...(incoming.comparisons === undefined ? {} : { comparisons: { mode: 'merge' } }),
    ...(incoming.currentStack === undefined ? {} : { currentStack: 'replace' }),
    ...(incoming.composedScenario === undefined ? {} : { composedScenario: 'replace' }),
  };
}

function durableKey(snapshot: PersistenceSnapshot): string {
  return JSON.stringify({
    revision: snapshot.revision,
    protocols: snapshot.customProtocols,
    stacks: snapshot.savedStacks.map((stack) => ({ ...stack, trailingPayload: Array.from(stack.trailingPayload) })),
  }, (_key, value) => typeof value === 'bigint' ? { $bigint: value.toString() } : value instanceof Uint8Array ? { $bytes: Array.from(value) } : value);
}

function localSnapshotKey(snapshot: WorkspaceLocalSnapshot): string {
  return JSON.stringify(snapshot, (_key, value) => {
    if (typeof value === 'bigint') return { $bigint: value.toString() };
    if (value instanceof Uint8Array) return { $bytes: Array.from(value) };
    return value;
  });
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'The workspace operation failed.';
}

const primaryButton = 'mt-5 flex min-h-10 cursor-pointer items-center justify-center gap-2 rounded-md bg-cyan-700 px-4 py-2 text-[13px] font-medium text-white hover:bg-cyan-600 disabled:cursor-not-allowed disabled:opacity-40';
