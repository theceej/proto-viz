import { useState } from 'react';

export type InspectionMode = 'compact' | 'explain' | 'deep';

export const INSPECTION_MODE_KEY = 'pv-inspection-mode';

export const INSPECTION_MODES: { value: InspectionMode; label: string; description: string }[] = [
  { value: 'compact', label: 'Compact', description: 'Names and values only' },
  { value: 'explain', label: 'Explain', description: 'Descriptions and validation help' },
  { value: 'deep', label: 'Deep', description: 'Wire ranges and computation provenance' },
];

const isInspectionMode = (value: string | null): value is InspectionMode =>
  value === 'compact' || value === 'explain' || value === 'deep';

export function useInspectionMode(): [InspectionMode, (mode: InspectionMode) => void] {
  const [mode, setModeState] = useState<InspectionMode>(() => {
    const stored = localStorage.getItem(INSPECTION_MODE_KEY);
    return isInspectionMode(stored) ? stored : 'explain';
  });
  const setMode = (next: InspectionMode) => {
    setModeState(next);
    localStorage.setItem(INSPECTION_MODE_KEY, next);
  };
  return [mode, setMode];
}
