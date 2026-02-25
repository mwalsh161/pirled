import { getPirLabel } from './pir';

interface PirChipGroupProps {
  count: number;
  labels?: string[];
  isSelected: (pirIndex: number) => boolean;
  isActive?: (pirIndex: number) => boolean;
  onSelect: (pirIndex: number) => void;
  className?: string;
}

export default function PirChipGroup({
  count,
  labels = [],
  isSelected,
  isActive,
  onSelect,
  className = '',
}: PirChipGroupProps) {
  return (
    <div className={`flex flex-wrap gap-1 ${className}`.trim()}>
      {Array.from({ length: count }, (_, pirIndex) => {
        const selected = isSelected(pirIndex);
        const active = isActive?.(pirIndex) ?? false;
        return (
          <button
            key={`pir:${pirIndex}`}
            type="button"
            aria-pressed={selected}
            onClick={() => {
              onSelect(pirIndex);
            }}
            className={`inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-xs transition ${
              selected
                ? 'border-emerald-300 bg-emerald-50 text-emerald-900'
                : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'
            } ${active ? 'ring-1 ring-rose-300' : ''}`}
          >
            <span className={`h-1.5 w-1.5 rounded-full ${selected ? 'bg-emerald-500' : 'bg-slate-300'}`} />
            {getPirLabel(labels, pirIndex)}
          </button>
        );
      })}
    </div>
  );
}
