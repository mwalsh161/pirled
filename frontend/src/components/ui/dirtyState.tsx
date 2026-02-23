interface DirtyBadgeProps {
  dirty: boolean;
  label?: string;
  reserveSpace?: boolean;
  className?: string;
}

type NeutralTone = 'gray' | 'slate';

function cleanToneClasses(tone: NeutralTone): { card: string; actionButton: string } {
  if (tone === 'slate') {
    return {
      card: 'border-slate-200 bg-white',
      actionButton: 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50',
    };
  }
  return {
    card: 'border-gray-200 bg-white',
    actionButton: 'border-gray-300 text-gray-700 hover:bg-gray-50',
  };
}

export function dirtyCardClass(dirty: boolean, tone: NeutralTone = 'gray'): string {
  if (dirty) {
    return 'border-amber-300 bg-amber-50/40';
  }
  return cleanToneClasses(tone).card;
}

export function dirtyActionButtonClass(dirty: boolean, tone: NeutralTone = 'gray'): string {
  if (dirty) {
    return 'border-amber-300 bg-amber-50 text-amber-800 hover:bg-amber-100';
  }
  return cleanToneClasses(tone).actionButton;
}

export function DirtyBadge({ dirty, label = 'Unsaved', reserveSpace = true, className = '' }: DirtyBadgeProps) {
  const visibilityClass = reserveSpace ? (dirty ? 'opacity-100' : 'opacity-0') : dirty ? '' : 'hidden';
  return (
    <span
      className={`rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-800 transition-opacity ${visibilityClass} ${className}`.trim()}
    >
      {label}
    </span>
  );
}
