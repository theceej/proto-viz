import type { LucideIcon } from 'lucide-react';

/**
 * Base classes for a header toolbar button. The label text is a separate span
 * so it can be hidden at narrow container widths (see `labelClass`) while the
 * icon — and the button's accessible name, which comes from `aria-label`, not
 * the visible text — stay put.
 */
export const toolbarButtonClass = (
  hover = 'hover:border-cyan-600 hover:text-cyan-300',
) =>
  `flex cursor-pointer items-center gap-1 rounded-md border border-zinc-700 px-2 py-1 text-[12px] text-zinc-300 disabled:cursor-not-allowed disabled:border-zinc-800 disabled:text-zinc-600 ${hover}`;

export default function ToolbarButton({
  icon: Icon,
  label,
  title,
  onClick,
  disabled = false,
  hover,
  labelClass = '',
}: {
  icon: LucideIcon;
  label: string;
  /** Tooltip; defaults to the label. */
  title?: string;
  onClick: () => void;
  disabled?: boolean;
  hover?: string;
  /** Extra classes controlling when the label shows (e.g. container-query variants). */
  labelClass?: string;
}) {
  return (
    <button
      type="button"
      className={toolbarButtonClass(hover)}
      aria-label={label}
      title={title ?? label}
      disabled={disabled}
      onClick={onClick}
    >
      <Icon className="size-3.5 shrink-0" aria-hidden />
      <span className={labelClass}>{label}</span>
    </button>
  );
}
