import { type ResolvedDevice } from '../../../types';
import { type DeviceLiveHealth } from '../../../live/useLiveLedTransport';
import { toDeviceUri } from '../../../logical/types';

interface DeviceHealthStripProps {
  devices: ResolvedDevice[];
  deviceHealthByUri: Record<string, DeviceLiveHealth>;
  persistingByDeviceUri: Record<string, boolean>;
  onPersistDevice: (device: ResolvedDevice) => void;
  onRetryDevice: (device: ResolvedDevice) => void;
}

function healthClass(tone: DeviceLiveHealth['tone']): string {
  if (tone === 'ok') {
    return 'border-emerald-200 bg-emerald-50 text-emerald-800';
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
  return 'border-slate-200 bg-slate-50 text-slate-700';
}

function toneDotClass(tone: DeviceLiveHealth['tone']): string {
  if (tone === 'ok') {
    return 'bg-emerald-500';
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
  return 'bg-slate-400';
}

function secondsAgo(timestamp?: number): string {
  if (!timestamp) {
    return 'never';
  }
  const deltaSeconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));
  return `${deltaSeconds}s`;
}

export default function DeviceHealthStrip({
  devices,
  deviceHealthByUri,
  persistingByDeviceUri,
  onPersistDevice,
  onRetryDevice,
}: DeviceHealthStripProps) {
  return (
    <div className="sticky top-2 z-20 rounded-xl border border-slate-200 bg-white/95 p-2 shadow-sm backdrop-blur">
      <div className="flex flex-wrap gap-2">
        {devices.map((device) => {
          const deviceUri = toDeviceUri(device);
          const trimmedAlias = device.alias.trim();
          const deviceDisplayName = trimmedAlias.length > 0 ? trimmedAlias : device.name;
          const health = deviceHealthByUri[deviceUri];
          const tone = health?.tone ?? 'idle';
          const queueDepth = health?.queueDepth ?? 0;
          const isPersisting = persistingByDeviceUri[deviceUri] ?? false;
          const isOffline = tone === 'offline';
          const stateText =
            tone === 'offline'
              ? 'offline'
              : health?.tone === 'error'
                ? 'error'
                : health?.inFlight
                  ? 'syncing'
                  : health?.tone === 'ok'
                    ? 'ok'
                    : 'idle';
          return (
            <div
              key={deviceUri}
              className={`min-w-44 rounded-lg border px-2.5 py-1.5 text-xs font-medium shadow-sm ${healthClass(tone)}`}
            >
              <div className="flex items-center gap-1.5 font-semibold">
                <span className={`inline-block h-2 w-2 rounded-full ${toneDotClass(tone)}`} />
                <span className="truncate">{deviceDisplayName}</span>
              </div>
              <div className="mt-0.5 text-[11px] opacity-80">
                {stateText} | q:{queueDepth} | last {secondsAgo(health?.lastSuccessAt)}
              </div>
              <div className="mt-1">
                <button
                  type="button"
                  onClick={() => {
                    onPersistDevice(device);
                  }}
                  disabled={isPersisting || isOffline}
                  className="rounded border border-slate-300 bg-white px-2 py-0.5 text-[11px] font-semibold text-slate-700 hover:bg-slate-100 disabled:cursor-not-allowed disabled:border-slate-200 disabled:text-slate-400"
                >
                  {isPersisting ? 'Saving...' : 'Save to Device'}
                </button>
                {isOffline ? (
                  <button
                    type="button"
                    onClick={() => {
                      onRetryDevice(device);
                    }}
                    className="ml-1 rounded border border-amber-300 bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-800 hover:bg-amber-200"
                  >
                    Retry
                  </button>
                ) : null}
              </div>
              {health?.lastError ? <div className="mt-0.5 max-w-64 truncate text-[11px]">{health.lastError}</div> : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}
