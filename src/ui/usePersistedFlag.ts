import { useState } from 'react';

/** Boolean UI preference persisted to localStorage (sidebar, pane collapse). */
export function usePersistedFlag(
  key: string,
  initial: boolean,
): [boolean, (v: boolean) => void] {
  const [value, setValue] = useState(() => {
    const stored = localStorage.getItem(key);
    return stored === null ? initial : stored === 'true';
  });
  return [
    value,
    (v: boolean) => {
      setValue(v);
      localStorage.setItem(key, String(v));
    },
  ];
}
