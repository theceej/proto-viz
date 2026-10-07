import type { KeyboardEvent } from 'react';

/** Arrow-key selection for the chart's segmented radio controls. */
export function navigateChartRadios(event: KeyboardEvent<HTMLDivElement>) {
  if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return;
  const radios = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="radio"]')];
  const index = radios.indexOf(event.target as HTMLButtonElement);
  if (index < 0) return;
  event.preventDefault();
  const next = event.key === 'Home' ? 0 : event.key === 'End' ? radios.length - 1
    : (index + (event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 1) + radios.length) % radios.length;
  radios[next]?.focus();
  radios[next]?.click();
}
