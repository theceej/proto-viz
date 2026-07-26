import {
  parseComposedScenario,
  serializeComposedScenario,
  type ComposedScenario,
} from '../core/scenarioComposer';

export const COMPOSED_SCENARIO_STORAGE_KEY = 'pv-composed-scenario-v1';

interface ScenarioStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

function target(storage?: ScenarioStorage): ScenarioStorage {
  return storage ?? localStorage;
}

/** Return the persisted wire value without parsing it. */
export function readRawComposedScenario(storage?: ScenarioStorage): string | null {
  try {
    return target(storage).getItem(COMPOSED_SCENARIO_STORAGE_KEY);
  } catch {
    return null;
  }
}

/** Load a valid scenario, treating missing, malformed, or inaccessible storage as empty. */
export function loadComposedScenario(storage?: ScenarioStorage): ComposedScenario | null {
  const raw = readRawComposedScenario(storage);
  if (raw === null) return null;
  try {
    return parseComposedScenario(raw);
  } catch {
    return null;
  }
}

export function saveComposedScenario(
  scenario: ComposedScenario,
  storage?: ScenarioStorage,
): boolean {
  try {
    target(storage).setItem(COMPOSED_SCENARIO_STORAGE_KEY, serializeComposedScenario(scenario));
    return true;
  } catch {
    return false;
  }
}

export function clearComposedScenario(storage?: ScenarioStorage): boolean {
  try {
    target(storage).removeItem(COMPOSED_SCENARIO_STORAGE_KEY);
    return true;
  } catch {
    return false;
  }
}

/** Restore an exact previous storage value after a failed multi-store import. */
export function restoreRawComposedScenario(
  raw: string | null,
  storage?: ScenarioStorage,
): boolean {
  try {
    if (raw === null) target(storage).removeItem(COMPOSED_SCENARIO_STORAGE_KEY);
    else target(storage).setItem(COMPOSED_SCENARIO_STORAGE_KEY, raw);
    return true;
  } catch {
    return false;
  }
}
