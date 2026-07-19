import { INSPECTION_MODES, type InspectionMode } from '../inspectionMode';

export default function InspectionModeSelector({
  mode,
  onChange,
}: {
  mode: InspectionMode;
  onChange: (mode: InspectionMode) => void;
}) {
  return (
    <div className="flex items-center gap-1" data-tour="inspection-mode">
      <span className="mr-1 text-[10px] text-zinc-600">Detail</span>
      <div
        className="flex rounded-md border border-zinc-800 p-0.5"
        role="radiogroup"
        aria-label="Inspection detail"
      >
        {INSPECTION_MODES.map((option) => (
          <button
            key={option.value}
            role="radio"
            aria-checked={mode === option.value}
            title={option.description}
            className={`cursor-pointer rounded px-1.5 py-0.5 text-[10px] ${
              mode === option.value
                ? 'bg-zinc-800 font-medium text-zinc-100'
                : 'text-zinc-500 hover:text-zinc-200'
            }`}
            onClick={() => onChange(option.value)}
          >
            {option.label}
          </button>
        ))}
      </div>
      <span className="sr-only" role="status" aria-live="polite">
        {INSPECTION_MODES.find((option) => option.value === mode)!.label} inspection mode selected
      </span>
    </div>
  );
}
