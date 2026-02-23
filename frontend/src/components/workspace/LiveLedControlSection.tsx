import { useState } from 'react';
import DeviceHealthStrip from './live/DeviceHealthStrip';
import LogicalEndpointSections from './live/LogicalEndpointSections';
import { useLiveLedTransport } from '../../live/useLiveLedTransport';
import { type LedEndpoint, type LogicalGroup } from '../../logical/types';
import { type ResolvedDevice } from '../../types';

const POLL_INTERVAL_MS = 750;

interface LiveLedControlSectionProps {
  devices: ResolvedDevice[];
  endpoints: LedEndpoint[];
  groups: LogicalGroup[];
  pirLabelsByDeviceUri: Record<string, string[]>;
}

export default function LiveLedControlSection({ devices, endpoints, groups, pirLabelsByDeviceUri }: LiveLedControlSectionProps) {
  const [isAutoRefreshEnabled, setIsAutoRefreshEnabled] = useState(true);

  const {
    snapshotsByDeviceUri,
    draftByEndpointId,
    dirtyByEndpointId,
    pendingByEndpointId,
    deviceHealthByUri,
    persistingByDeviceUri,
    updateEndpointDraft,
    applyEndpoint,
    resetEndpoint,
    persistDevice,
    refreshAllDevices,
    retryDevice,
  } = useLiveLedTransport({
    devices,
    endpoints,
    autoRefreshEnabled: isAutoRefreshEnabled,
    pollIntervalMs: POLL_INTERVAL_MS,
  });

  return (
    <section className="rounded-xl border border-slate-200 bg-gradient-to-b from-white to-slate-50/40 p-5 shadow-sm">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 pb-4">
        <div className="space-y-1">
          <h3 className="text-lg font-semibold text-slate-900">Live LED Control</h3>
          <p className="text-sm text-slate-600">Logical-first live control with per-device transport status.</p>
          <div className="flex flex-wrap gap-1.5 text-xs">
            <span className="rounded-full border border-slate-300 bg-white px-2 py-0.5 text-slate-600">
              Devices: {devices.length}
            </span>
            <span className="rounded-full border border-slate-300 bg-white px-2 py-0.5 text-slate-600">
              Endpoints: {endpoints.length}
            </span>
            <span className="rounded-full border border-slate-300 bg-white px-2 py-0.5 text-slate-600">
              Groups: {groups.length}
            </span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-1.5 rounded-full border border-slate-300 bg-white px-3 py-1 text-xs font-medium text-slate-700">
            <input
              type="checkbox"
              checked={isAutoRefreshEnabled}
              onChange={(event) => {
                setIsAutoRefreshEnabled(event.target.checked);
              }}
              className="accent-blue-600"
            />
            Auto Refresh
          </label>
          <button
            type="button"
            onClick={() => {
              void refreshAllDevices();
            }}
            disabled={devices.length === 0}
            className="rounded-full border border-blue-200 bg-blue-50 px-3 py-1.5 text-xs font-medium text-blue-700 hover:bg-blue-100 disabled:cursor-not-allowed disabled:border-slate-200 disabled:bg-slate-100 disabled:text-slate-400"
          >
            Refresh All
          </button>
        </div>
      </div>

      {devices.length === 0 ? (
        <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-4 text-sm text-slate-600">
          No resolved devices available yet. Discover devices and retry resolution.
        </div>
      ) : (
        <div className="space-y-6">
          <DeviceHealthStrip
            devices={devices}
            deviceHealthByUri={deviceHealthByUri}
            persistingByDeviceUri={persistingByDeviceUri}
            onPersistDevice={(device) => {
              void persistDevice(device);
            }}
            onRetryDevice={(device) => {
              void retryDevice(device);
            }}
          />
          <LogicalEndpointSections
            endpoints={endpoints}
            groups={groups}
            pirLabelsByDeviceUri={pirLabelsByDeviceUri}
            snapshotsByDeviceUri={snapshotsByDeviceUri}
            draftByEndpointId={draftByEndpointId}
            dirtyByEndpointId={dirtyByEndpointId}
            pendingByEndpointId={pendingByEndpointId}
            onDraftChange={updateEndpointDraft}
            onApply={applyEndpoint}
            onReset={resetEndpoint}
          />
        </div>
      )}
    </section>
  );
}
