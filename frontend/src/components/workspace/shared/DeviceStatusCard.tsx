import { type ReactNode } from 'react';

export type DeviceStatusTone = 'idle' | 'ok' | 'error' | 'working' | 'offline' | 'paused' | 'unresolved';

interface DeviceStatusCardProps {
  deviceDisplayName: string;
  tone: DeviceStatusTone;
  metaText: string;
  detailText?: string;
  errorText?: string;
  actions?: ReactNode;
  onHeaderClick?: () => void;
  className?: string;
}

function healthClass(tone: DeviceStatusTone): string {
  if (tone === 'ok') {
    return 'border-emerald-200 bg-emerald-50 text-emerald-800';
  }
  if (tone === 'paused') {
    return 'border-amber-200 bg-amber-50 text-amber-800';
  }
  if (tone === 'offline') {
    return 'border-amber-200 bg-amber-50 text-amber-800';
  }
  if (tone === 'error') {
    return 'border-rose-200 bg-rose-50 text-rose-800';
  }
  if (tone === 'working') {
    return 'border-sky-200 bg-sky-50 text-sky-800';
  }
  if (tone === 'unresolved') {
    return 'border-slate-300 bg-slate-100 text-slate-700';
  }
  return 'border-slate-200 bg-slate-50 text-slate-700';
}

function toneDotClass(tone: DeviceStatusTone): string {
  if (tone === 'ok') {
    return 'bg-emerald-500';
  }
  if (tone === 'paused') {
    return 'bg-amber-500';
  }
  if (tone === 'offline') {
    return 'bg-amber-500';
  }
  if (tone === 'error') {
    return 'bg-rose-500';
  }
  if (tone === 'working') {
    return 'bg-sky-500';
  }
  if (tone === 'unresolved') {
    return 'bg-slate-400';
  }
  return 'bg-slate-400';
}

export default function DeviceStatusCard({
  deviceDisplayName,
  tone,
  metaText,
  detailText,
  errorText,
  actions,
  onHeaderClick,
  className = '',
}: DeviceStatusCardProps) {
  const headerClassName = 'flex w-full items-center gap-1.5 text-left font-semibold';

  return (
    <div
      className={`rounded-lg border px-2.5 py-1.5 text-xs font-medium shadow-sm ${healthClass(tone)} ${
        onHeaderClick ? 'cursor-pointer' : ''
      } ${className}`.trim()}
      role={onHeaderClick ? 'button' : undefined}
      tabIndex={onHeaderClick ? 0 : undefined}
      onClick={onHeaderClick}
      onKeyDown={
        onHeaderClick
          ? (event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                onHeaderClick();
              }
            }
          : undefined
      }
    >
      {onHeaderClick ? (
        <div className={headerClassName}>
          <span className={`inline-block h-2 w-2 rounded-full ${toneDotClass(tone)}`} />
          <span className="truncate">{deviceDisplayName}</span>
        </div>
      ) : (
        <div className={headerClassName}>
          <span className={`inline-block h-2 w-2 rounded-full ${toneDotClass(tone)}`} />
          <span className="truncate">{deviceDisplayName}</span>
        </div>
      )}
      <div className="mt-0.5 text-[11px] opacity-80">{metaText}</div>
      {detailText ? <div className="mt-1 text-[11px] font-semibold">{detailText}</div> : null}
      {actions ? (
        <div
          className="mt-1"
          onClick={(event) => event.stopPropagation()}
          onKeyDown={(event) => event.stopPropagation()}
        >
          {actions}
        </div>
      ) : null}
      {errorText ? <div className="mt-0.5 max-w-64 truncate text-[11px]">{errorText}</div> : null}
    </div>
  );
}
