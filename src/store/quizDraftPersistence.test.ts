import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createAssignmentDraft } from '../core/assignmentAuthoring';
import { deleteQuizDraft, loadQuizDrafts, saveQuizDraft, type QuizDraft } from './persistence';

const database = vi.hoisted(() => ({ put: vi.fn(), getAll: vi.fn(), delete: vi.fn() }));
vi.mock('idb', () => ({ openDB: vi.fn().mockResolvedValue(database) }));

const records = new Map<string, QuizDraft>();
beforeEach(() => {
  records.clear();
  database.put.mockReset().mockImplementation(async (_store: string, draft: QuizDraft) => {
    records.set(draft.id, draft);
  });
  database.getAll.mockReset().mockImplementation(async () => [...records.values()]);
  database.delete.mockReset().mockImplementation(async (_store: string, id: string) => {
    records.delete(id);
  });
});

function draft(title: string): QuizDraft {
  return {
    id: 'draft',
    updatedAt: new Date().toISOString(),
    quiz: { ...createAssignmentDraft(), quizId: 'draft', title },
  };
}

function delayNextWrite() {
  let release = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  database.put.mockImplementationOnce(async (_store: string, record: QuizDraft) => {
    await gate;
    records.set(record.id, record);
  });
  return release;
}

describe('quiz draft persistence ordering', () => {
  it('waits for the closing flush before reading a reopened draft', async () => {
    const release = delayNextWrite();
    const earlier = saveQuizDraft(draft('Earlier edit'));
    const closing = saveQuizDraft(draft('Last edit before closing'));
    const reopened = loadQuizDrafts();
    await vi.waitFor(() => expect(database.put).toHaveBeenCalledOnce());
    expect(database.getAll).not.toHaveBeenCalled();
    release();
    await Promise.all([earlier, closing]);
    const result = await reopened;
    expect(result.ok && result.data[0]!.quiz.title).toBe('Last edit before closing');
  });

  it('allows a retry after a failed write without blocking the queue', async () => {
    database.put.mockRejectedValueOnce(new DOMException('Full', 'QuotaExceededError'));
    await expect(saveQuizDraft(draft('Failed'))).resolves.toEqual({
      ok: false,
      errorName: 'QuotaExceededError',
    });
    await expect(saveQuizDraft(draft('Retried'))).resolves.toMatchObject({ ok: true });
    const result = await loadQuizDrafts();
    expect(result.ok && result.data[0]!.quiz.title).toBe('Retried');
  });

  it('orders deletion after pending writes so an old save cannot restore the draft', async () => {
    const release = delayNextWrite();
    const save = saveQuizDraft(draft('Pending'));
    const deletion = deleteQuizDraft('draft');
    const read = loadQuizDrafts();
    await vi.waitFor(() => expect(database.put).toHaveBeenCalledOnce());
    expect(database.delete).not.toHaveBeenCalled();
    release();
    await Promise.all([save, deletion]);
    await expect(read).resolves.toEqual({ ok: true, data: [] });
  });
});
