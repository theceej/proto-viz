import { describe, expect, it, vi } from 'vitest';
import { readPersisted } from './persistence';

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
