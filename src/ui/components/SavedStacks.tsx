import { useEffect, useState } from 'react';
import { Bookmark, FolderOpen, Trash2 } from 'lucide-react';
import { useEscape } from '../a11y';
import type { StackInstance } from '../../core/model';
import type { Registry } from '../../core/registry';
import { useStackStore } from '../../store/stackStore';
import {
  deleteSavedStack,
  loadSavedStacks,
  saveStack,
  type SavedStack,
} from '../../store/persistence';

/** Save-current-stack button plus a dropdown of saved stacks (IndexedDB). */
export default function SavedStacks({
  stack,
  registry,
}: {
  stack: StackInstance;
  registry: Registry;
}) {
  const restoreStack = useStackStore((s) => s.restoreStack);
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState('');
  const [open, setOpen] = useState(false);
  const [saved, setSaved] = useState<SavedStack[]>([]);

  useEffect(() => {
    if (open) void loadSavedStacks().then(setSaved);
  }, [open]);
  useEscape(saving, () => setSaving(false));
  useEscape(open, () => setOpen(false));

  const defaultName = stack.layers
    .map((l) => registry.get(l.protocolId)?.name ?? l.protocolId)
    .join(' › ');

  const doSave = async () => {
    const snapshot: SavedStack = {
      id: crypto.randomUUID(),
      name: name.trim() || defaultName,
      savedAt: Date.now(),
      layers: stack.layers.map((l) => ({
        protocolId: l.protocolId,
        overrides: { ...l.overrides },
        pinned: [...l.pinned],
      })),
      trailingPayload: stack.trailingPayload ?? new Uint8Array(0),
    };
    await saveStack(snapshot);
    setSaving(false);
    setName('');
  };

  return (
    <div className="flex items-center gap-2">
      <div className="relative">
        <button
          className="flex cursor-pointer items-center gap-1 rounded-md border border-zinc-700 px-2.5 py-1 text-[12px] text-zinc-300 hover:border-zinc-500 disabled:cursor-not-allowed disabled:opacity-40"
          disabled={stack.layers.length === 0}
          title="Save this stack in your browser"
          aria-expanded={saving}
          aria-haspopup="dialog"
          onClick={() => {
            setSaving((s) => !s);
            setName('');
          }}
        >
          <Bookmark className="size-3.5" />
          Save
        </button>
        {saving && (
          <>
            <div className="fixed inset-0 z-10" onClick={() => setSaving(false)} />
            <form
              className="absolute top-full left-0 z-20 mt-1 flex w-72 items-center gap-2 rounded-lg border border-zinc-700 bg-zinc-900 p-2 shadow-xl shadow-black/50"
              onSubmit={(e) => {
                e.preventDefault();
                void doSave();
              }}
            >
              <input
                autoFocus
                className="min-w-0 flex-1 rounded border border-zinc-700 bg-zinc-950/60 px-2 py-1 text-[12px] text-zinc-200 outline-none focus:border-cyan-600"
                placeholder={defaultName}
                aria-label="Name for the saved stack"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
              <button
                type="submit"
                className="cursor-pointer rounded-md bg-cyan-700 px-2.5 py-1 text-[12px] font-medium text-white hover:bg-cyan-600"
              >
                Save
              </button>
            </form>
          </>
        )}
      </div>

      <div className="relative">
        <button
          className="flex cursor-pointer items-center gap-1 rounded-md border border-zinc-700 px-2.5 py-1 text-[12px] text-zinc-300 hover:border-zinc-500"
          title="Load a saved stack"
          aria-expanded={open}
          aria-haspopup="menu"
          onClick={() => setOpen((o) => !o)}
        >
          <FolderOpen className="size-3.5" />
          Saved
        </button>
        {open && (
          <>
            <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
            <div className="absolute top-full left-0 z-20 mt-1 max-h-96 w-80 overflow-auto rounded-lg border border-zinc-700 bg-zinc-900 py-1 shadow-xl shadow-black/50">
              {saved.length === 0 && (
                <p className="px-3 py-2 text-[12px] text-zinc-500">
                  No saved stacks yet — build one and hit Save.
                </p>
              )}
              {saved.map((s) => (
                <div
                  key={s.id}
                  className="group flex items-center gap-2 px-3 py-1.5 hover:bg-zinc-800"
                >
                  <button
                    className="min-w-0 flex-1 cursor-pointer text-left"
                    title="Load this stack"
                    onClick={() => {
                      restoreStack(s.layers, s.trailingPayload);
                      setOpen(false);
                    }}
                  >
                    <span className="block truncate text-[13px] text-zinc-200">{s.name}</span>
                    <span className="block truncate font-mono text-[10px] text-zinc-500">
                      {s.layers.map((l) => l.protocolId).join(' › ')}
                      {s.trailingPayload.length > 0 && ` + ${s.trailingPayload.length}B payload`}
                      {' · '}
                      {new Date(s.savedAt).toLocaleDateString()}
                    </span>
                  </button>
                  <button
                    className="cursor-pointer rounded p-1.5 text-zinc-600 opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100 hover:text-rose-400"
                    aria-label={`Delete saved stack ${s.name}`}
                    onClick={() => {
                      void deleteSavedStack(s.id).then(() =>
                        setSaved((prev) => prev.filter((x) => x.id !== s.id)),
                      );
                    }}
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
