import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  collectCommands,
  filterCommands,
  groupCommands,
  useCommandStore,
  type Command,
} from './commandStore';

const cmd = (id: string, title: string, group: string, keywords?: string[]): Command => ({
  id,
  title,
  group,
  keywords,
  run: vi.fn(),
});

describe('commandStore', () => {
  beforeEach(() => useCommandStore.setState({ open: false, owners: {} }));

  it('registers and unregisters command batches by owner', () => {
    const { register, unregister } = useCommandStore.getState();
    register('nav', [cmd('nav:a', 'Go to A', 'Navigation')]);
    register('builder', [cmd('b1', 'Do thing', 'Builder')]);
    expect(collectCommands(useCommandStore.getState().owners)).toHaveLength(2);

    unregister('builder');
    expect(collectCommands(useCommandStore.getState().owners).map((c) => c.id)).toEqual(['nav:a']);
  });

  it('dedupes by id across owners, last registration winning', () => {
    const owners = {
      a: [cmd('dup', 'Old title', 'Builder')],
      b: [cmd('dup', 'New title', 'Builder')],
    };
    const list = collectCommands(owners);
    expect(list).toHaveLength(1);
    expect(list[0]!.title).toBe('New title');
  });

  it('toggles and sets the open flag', () => {
    const { toggle, setOpen } = useCommandStore.getState();
    toggle();
    expect(useCommandStore.getState().open).toBe(true);
    toggle();
    expect(useCommandStore.getState().open).toBe(false);
    setOpen(true);
    expect(useCommandStore.getState().open).toBe(true);
  });

  describe('filterCommands', () => {
    const commands = [
      cmd('nav:lib', 'Go to Protocol Library', 'Navigation', ['library']),
      cmd('b.decode', 'Decode packet from hex', 'Builder', ['paste', 'bytes']),
      cmd('b.share', 'Share stack', 'Builder', ['link', 'code']),
    ];

    it('returns everything for an empty query', () => {
      expect(filterCommands(commands, '   ')).toHaveLength(3);
    });

    it('matches title, keywords, and group case-insensitively', () => {
      expect(filterCommands(commands, 'LIBRARY').map((c) => c.id)).toEqual(['nav:lib']);
      expect(filterCommands(commands, 'paste').map((c) => c.id)).toEqual(['b.decode']);
      expect(filterCommands(commands, 'builder').map((c) => c.id)).toEqual(['b.decode', 'b.share']);
    });

    it('requires every whitespace-separated term to match', () => {
      expect(filterCommands(commands, 'share stack').map((c) => c.id)).toEqual(['b.share']);
      expect(filterCommands(commands, 'share library')).toEqual([]);
    });
  });

  it('orders groups with known groups first, then alphabetically', () => {
    const grouped = groupCommands([
      cmd('z', 'Z', 'Zzz'),
      cmd('b', 'B', 'Builder'),
      cmd('n', 'N', 'Navigation'),
      cmd('a', 'A', 'Aaa'),
    ]);
    expect(grouped.map((g) => g.group)).toEqual(['Navigation', 'Builder', 'Aaa', 'Zzz']);
  });
});
