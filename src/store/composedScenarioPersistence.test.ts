import { describe, expect, it, vi } from 'vitest';
import { createComposedScenario } from '../core/scenarioComposer';
import {
  clearComposedScenario,
  COMPOSED_SCENARIO_STORAGE_KEY,
  loadComposedScenario,
  readRawComposedScenario,
  restoreRawComposedScenario,
  saveComposedScenario,
} from './composedScenarioPersistence';

function memoryStorage(initial?: string) {
  let value: string | null = initial ?? null;
  return {
    getItem: vi.fn(() => value),
    setItem: vi.fn((_key: string, next: string) => {
      value = next;
    }),
    removeItem: vi.fn(() => {
      value = null;
    }),
  };
}

describe('composedScenarioPersistence', () => {
  it('saves, reads raw, loads, and clears through the centralized key', () => {
    const storage = memoryStorage();
    const scenario = createComposedScenario({ layers: [], trailingPayload: new Uint8Array([1]) });

    expect(saveComposedScenario(scenario, storage)).toBe(true);
    expect(storage.setItem).toHaveBeenCalledWith(
      COMPOSED_SCENARIO_STORAGE_KEY,
      expect.any(String),
    );
    expect(readRawComposedScenario(storage)).toBeTypeOf('string');
    expect(loadComposedScenario(storage)).toEqual(scenario);
    expect(clearComposedScenario(storage)).toBe(true);
    expect(readRawComposedScenario(storage)).toBeNull();
    expect(restoreRawComposedScenario('damaged-but-preserved', storage)).toBe(true);
    expect(readRawComposedScenario(storage)).toBe('damaged-but-preserved');
  });

  it('safely treats malformed persisted data as no scenario while preserving the raw value', () => {
    const storage = memoryStorage('{"version":1,"steps":"invalid"}');

    expect(loadComposedScenario(storage)).toBeNull();
    expect(readRawComposedScenario(storage)).toBe('{"version":1,"steps":"invalid"}');
  });

  it('reports inaccessible writes and clears without throwing', () => {
    const failure = () => {
      throw new DOMException('blocked', 'SecurityError');
    };
    const storage = { getItem: failure, setItem: failure, removeItem: failure };
    const scenario = createComposedScenario({ layers: [], trailingPayload: new Uint8Array() });

    expect(readRawComposedScenario(storage)).toBeNull();
    expect(loadComposedScenario(storage)).toBeNull();
    expect(saveComposedScenario(scenario, storage)).toBe(false);
    expect(clearComposedScenario(storage)).toBe(false);
    expect(restoreRawComposedScenario('old', storage)).toBe(false);
  });
});
