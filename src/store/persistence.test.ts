import { describe, expect, it, vi } from 'vitest';
import {
  applyPersistenceTransaction,
  readPersisted,
  type PersistenceStoreName,
  type PersistenceTransactionOperations,
} from './persistence';

describe('readPersisted', () => {
  it('distinguishes successful empty and populated reads', async () => {
    await expect(readPersisted(async () => [])).resolves.toEqual({ ok: true, data: [] });
    await expect(readPersisted(async () => [1, 2])).resolves.toEqual({ ok: true, data: [1, 2] });
  });

  it('returns a diagnostic failure without writing or inventing empty data', async () => {
    const read = vi.fn().mockRejectedValue(new DOMException('blocked', 'InvalidStateError'));
    const result = await readPersisted(read);
    expect(result).toEqual({ ok: false, errorName: 'InvalidStateError' });
    expect(result).not.toHaveProperty('data');
    expect(read).toHaveBeenCalledOnce();
  });
});

describe('applyPersistenceTransaction', () => {
  function recorder() {
    const calls: Array<{ operation: 'clear' | 'put'; store: PersistenceStoreName; value?: unknown }> = [];
    const transaction: PersistenceTransactionOperations = {
      clear: async (store) => {
        calls.push({ operation: 'clear', store });
      },
      put: async (store, value) => {
        calls.push({ operation: 'put', store, value });
      },
      done: Promise.resolve(),
    };
    return { calls, transaction };
  }

  it('only replaces selected categories with caller-supplied final data', async () => {
    const { calls, transaction } = recorder();
    const stack = {
      id: 'stack-1',
      name: 'Imported',
      savedAt: 1,
      layers: [],
      trailingPayload: new Uint8Array([1]),
    };

    await expect(applyPersistenceTransaction(transaction, {
      customProtocols: { mode: 'untouched' },
      savedStacks: { mode: 'merge', data: [stack] },
    })).resolves.toEqual({ ok: true });

    expect(calls).toEqual([
      { operation: 'clear', store: 'savedStacks' },
      { operation: 'put', store: 'savedStacks', value: stack },
    ]);
  });

  it('clears a selected category when its final replacement is empty', async () => {
    const { calls, transaction } = recorder();

    await expect(applyPersistenceTransaction(transaction, {
      customProtocols: { mode: 'replace', data: [] },
      savedStacks: { mode: 'untouched' },
    })).resolves.toEqual({ ok: true });

    expect(calls).toEqual([{ operation: 'clear', store: 'customProtocols' }]);
  });

  it('rejects with the transaction operation failure and stops applying', async () => {
    const failure = new DOMException('write failed', 'ConstraintError');
    const transaction: PersistenceTransactionOperations = {
      clear: vi.fn().mockResolvedValue(undefined),
      put: vi.fn().mockRejectedValue(failure),
      done: Promise.resolve(),
    };

    await expect(
      applyPersistenceTransaction(transaction, {
        customProtocols: {
          mode: 'replace',
          data: [{ id: 'one' }, { id: 'two' }] as never[],
        },
        savedStacks: { mode: 'replace', data: [] },
      }),
    ).resolves.toEqual({ ok: false, errorName: 'ConstraintError' });
    expect(transaction.put).toHaveBeenCalledOnce();
    expect(transaction.clear).toHaveBeenCalledOnce();
  });
});
