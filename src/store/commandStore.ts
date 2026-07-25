import { create } from 'zustand';

/**
 * A single palette command. Views register batches of these; the palette and
 * any shortcut reference render whatever is registered, so nothing hard-codes
 * the list. `run` should route to an existing action, not reimplement it.
 */
export interface Command {
  id: string;
  title: string;
  /** Category label used to group the palette (see `COMMAND_GROUP_ORDER`). */
  group: string;
  /** Extra words matched by the filter but not shown. */
  keywords?: string[];
  /** Human-readable shortcut for the reference view, e.g. "Ctrl/⌘+Z". */
  shortcut?: string;
  run: () => void;
}

interface CommandState {
  open: boolean;
  /** Registered command batches, keyed by owner so unmount can drop them. */
  owners: Record<string, Command[]>;
  setOpen(open: boolean): void;
  toggle(): void;
  register(owner: string, commands: Command[]): void;
  unregister(owner: string): void;
}

export const useCommandStore = create<CommandState>((set) => ({
  open: false,
  owners: {},
  setOpen: (open) => set({ open }),
  toggle: () => set((s) => ({ open: !s.open })),
  register: (owner, commands) => set((s) => ({ owners: { ...s.owners, [owner]: commands } })),
  unregister: (owner) =>
    set((s) => {
      if (!(owner in s.owners)) return s;
      const owners = { ...s.owners };
      delete owners[owner];
      return { owners };
    }),
}));

/** Group order for the palette; unlisted groups fall to the end, A–Z. */
export const COMMAND_GROUP_ORDER = ['Navigation', 'Builder'];

/** Flatten registered batches into one list, deduped by id (last wins). */
export function collectCommands(owners: Record<string, Command[]>): Command[] {
  const byId = new Map<string, Command>();
  for (const list of Object.values(owners)) {
    for (const command of list) byId.set(command.id, command);
  }
  return [...byId.values()];
}

/** Filter by a free-text query over title, group, and keywords (all terms must match). */
export function filterCommands(commands: Command[], query: string): Command[] {
  const q = query.trim().toLowerCase();
  if (q === '') return commands;
  const terms = q.split(/\s+/);
  return commands.filter((command) => {
    const haystack =
      `${command.title} ${command.group} ${(command.keywords ?? []).join(' ')}`.toLowerCase();
    return terms.every((term) => haystack.includes(term));
  });
}

/** Order and bucket commands by group for rendering. */
export function groupCommands(commands: Command[]): { group: string; commands: Command[] }[] {
  const rank = new Map(COMMAND_GROUP_ORDER.map((group, index) => [group, index]));
  const groups = new Map<string, Command[]>();
  for (const command of commands) {
    if (!groups.has(command.group)) groups.set(command.group, []);
    groups.get(command.group)!.push(command);
  }
  return [...groups.entries()]
    .sort(([a], [b]) => (rank.get(a) ?? 99) - (rank.get(b) ?? 99) || a.localeCompare(b))
    .map(([group, list]) => ({ group, commands: list }));
}
