import { useEffect, useMemo, useRef, useState } from 'react';
import { useEscape, useModalFocus } from '../a11y';
import { usePrefersReducedMotion } from '../usePrefersReducedMotion';
import {
  collectCommands,
  filterCommands,
  groupCommands,
  useCommandStore,
  type Command,
} from '../../store/commandStore';

const OPTION_ID = (id: string) => `command-option-${id.replace(/[^a-z0-9]/gi, '-')}`;

/** Does the event target already capture typing (so `?` shouldn't open us)? */
function isTypingTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
}

/**
 * Global command palette: ⌘K / Ctrl-K (or `?`) opens a filterable list of
 * every registered command. Fully keyboard-operable, focus-trapped, and
 * dismissible with Escape.
 */
export default function CommandPalette() {
  const open = useCommandStore((s) => s.open);
  const setOpen = useCommandStore((s) => s.setOpen);
  const toggle = useCommandStore((s) => s.toggle);
  const owners = useCommandStore((s) => s.owners);

  // Global open shortcut: ⌘K / Ctrl-K toggles; `?` opens (outside text fields).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && !e.altKey && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        toggle();
      } else if (e.key === '?' && !isTypingTarget(e.target)) {
        e.preventDefault();
        setOpen(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [toggle, setOpen]);

  if (!open) return null;
  return <Palette owners={owners} onClose={() => setOpen(false)} />;
}

function Palette({
  owners,
  onClose,
}: {
  owners: Record<string, Command[]>;
  onClose: () => void;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const reducedMotion = usePrefersReducedMotion();
  useEscape(true, onClose);
  useModalFocus(dialogRef);

  const all = useMemo(() => collectCommands(owners), [owners]);
  const groups = useMemo(() => groupCommands(filterCommands(all, query)), [all, query]);
  const flat = useMemo(() => groups.flatMap((g) => g.commands), [groups]);

  // Keep the active index in range as the filter narrows the list.
  const activeIndex = Math.min(active, Math.max(0, flat.length - 1));
  const activeCommand = flat[activeIndex];

  useEffect(() => {
    if (!activeCommand) return;
    document
      .getElementById(OPTION_ID(activeCommand.id))
      ?.scrollIntoView({ block: 'nearest' });
  }, [activeCommand]);

  const run = (command: Command | undefined) => {
    if (!command) return;
    onClose();
    command.run();
  };

  const onInputKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive(Math.min(flat.length - 1, activeIndex + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive(Math.max(0, activeIndex - 1));
    } else if (e.key === 'Home') {
      e.preventDefault();
      setActive(0);
    } else if (e.key === 'End') {
      e.preventDefault();
      setActive(flat.length - 1);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      run(activeCommand);
    }
  };

  return (
    <div
      className={`fixed inset-0 z-50 flex items-start justify-center bg-black/60 px-4 pt-[12vh] ${
        reducedMotion ? '' : 'motion-safe:animate-[fade-in_120ms_ease-out]'
      }`}
      onClick={onClose}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        className="flex max-h-[70vh] w-[min(38rem,100%)] flex-col overflow-hidden rounded-xl border border-zinc-700 bg-zinc-900 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <input
          type="text"
          role="combobox"
          aria-expanded="true"
          aria-controls="command-list"
          aria-activedescendant={activeCommand ? OPTION_ID(activeCommand.id) : undefined}
          aria-label="Search commands"
          placeholder="Search commands…"
          className="border-b border-zinc-800 bg-transparent px-4 py-3 text-[14px] text-zinc-100 outline-none placeholder:text-zinc-500"
          value={query}
          spellCheck={false}
          autoComplete="off"
          onChange={(e) => {
            setQuery(e.target.value);
            setActive(0);
          }}
          onKeyDown={onInputKey}
        />
        <div id="command-list" role="listbox" aria-label="Commands" className="overflow-y-auto py-1">
          {flat.length === 0 && (
            <p className="px-4 py-6 text-center text-[13px] text-zinc-500">
              No commands match “{query}”.
            </p>
          )}
          {groups.map(({ group, commands }) => (
            <div key={group} role="group" aria-label={group}>
              <p
                aria-hidden
                className="px-4 pt-2 pb-1 text-[10px] font-semibold tracking-widest text-zinc-500 uppercase"
              >
                {group}
              </p>
              {commands.map((command) => {
                const isActive = command === activeCommand;
                return (
                  <div
                    key={command.id}
                    id={OPTION_ID(command.id)}
                    role="option"
                    aria-selected={isActive}
                    className={`flex cursor-pointer items-center gap-3 px-4 py-1.5 text-[13px] ${
                      isActive ? 'bg-cyan-600/25 text-zinc-100' : 'text-zinc-300'
                    }`}
                    onMouseMove={() => setActive(flat.indexOf(command))}
                    onClick={() => run(command)}
                  >
                    <span className="flex-1">{command.title}</span>
                    {command.shortcut && (
                      <kbd className="rounded border border-zinc-700 bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] text-zinc-400">
                        {command.shortcut}
                      </kbd>
                    )}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
        <div className="flex items-center gap-3 border-t border-zinc-800 px-4 py-2 text-[10px] text-zinc-500">
          <span>
            <kbd className="font-mono">↑↓</kbd> navigate
          </span>
          <span>
            <kbd className="font-mono">↵</kbd> run
          </span>
          <span>
            <kbd className="font-mono">esc</kbd> close
          </span>
        </div>
      </div>
    </div>
  );
}
