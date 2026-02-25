import { type KnownDevice, type ResolvedDevice } from '../../../types';
import { type DeviceLiveHealth } from '../../../live/useDeviceSnapshotPolling';
import { toDeviceUri } from '../../../logical/types';
import DeviceStatusCard, { type DeviceStatusTone } from '../shared/DeviceStatusCard';

interface DeviceHealthStripProps {
  knownDevices: KnownDevice[];
  resolvedDevicesByName: Record<string, ResolvedDevice>;
  deviceHealthByUri: Record<string, DeviceLiveHealth>;
  persistingByDeviceUri: Record<string, boolean>;
  pausedByDeviceUri: Record<string, boolean>;
  onPersistDevice: (device: ResolvedDevice) => void;
  onRetryDevice: (device: ResolvedDevice) => void;
}

function secondsAgo(timestamp?: number): string {
  if (!timestamp) {
    return 'never';
  }
  const deltaSeconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));
  return `${deltaSeconds}s`;
}

export default function DeviceHealthStrip({
  knownDevices,
  resolvedDevicesByName,
  deviceHealthByUri,
  persistingByDeviceUri,
  pausedByDeviceUri,
  onPersistDevice,
  onRetryDevice,
}: DeviceHealthStripProps) {
  return (
    <div className="sticky top-2 z-20 rounded-xl border border-slate-200 bg-white/95 p-2 shadow-sm backdrop-blur">
      <div className="flex flex-wrap gap-2">
        {knownDevices.map((knownDevice) => {
          const resolvedDevice = resolvedDevicesByName[knownDevice.name];
          const trimmedAlias = knownDevice.alias.trim();
          const deviceDisplayName = trimmedAlias.length > 0 ? trimmedAlias : knownDevice.name;
          if (!resolvedDevice) {
            return (
              <DeviceStatusCard
                key={knownDevice.name}
                className="min-w-44"
                deviceDisplayName={deviceDisplayName}
                tone="unresolved"
                metaText="unresolved | q:0 | last never"
                detailText="Not reachable"
              />
            );
          }

          const deviceUri = toDeviceUri(resolvedDevice);
          const health = deviceHealthByUri[deviceUri];
          const isPaused = pausedByDeviceUri[deviceUri] ?? false;
          const queueDepth = health?.queueDepth ?? 0;
          const isPersisting = persistingByDeviceUri[deviceUri] ?? false;
          const showPaused = isPaused && !health?.inFlight && !isPersisting;
          const tone: DeviceStatusTone = showPaused ? 'paused' : health?.tone ?? 'idle';
          const isOffline = tone === 'offline';
          const stateText =
            tone === 'paused'
              ? 'paused'
              : tone === 'offline'
                ? 'offline'
                : health?.tone === 'error'
                  ? 'error'
                  : health?.inFlight
                    ? 'syncing'
                    : health?.tone === 'ok'
                      ? 'ok'
                      : 'idle';
          return (
            <DeviceStatusCard
              key={knownDevice.name}
              className="min-w-44"
              deviceDisplayName={deviceDisplayName}
              tone={tone}
              metaText={`${stateText} | q:${queueDepth} | last ${secondsAgo(health?.lastSuccessAt)}`}
              {...(health?.lastError ? { errorText: health.lastError } : {})}
              actions={
                <>
                  <button
                    type="button"
                    onClick={() => {
                      onPersistDevice(resolvedDevice);
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
                        onRetryDevice(resolvedDevice);
                      }}
                      className="ml-1 rounded border border-amber-300 bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-800 hover:bg-amber-200"
                    >
                      Retry
                    </button>
                  ) : null}
                </>
              }
            />
          );
        })}
      </div>
    </div>
  );
}
