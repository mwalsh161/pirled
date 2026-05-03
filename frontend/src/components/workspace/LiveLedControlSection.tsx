import { useCallback, useEffect, useMemo, useState } from 'react';
import DeviceHealthStrip from './live/DeviceHealthStrip';
import LogicalEndpointSections from './live/LogicalEndpointSections';
import { getRemoteSharingConfig } from '../../api';
import { useLiveLedTransport } from '../../live/useLiveLedTransport';
import { toDeviceUri, type LedEndpoint, type LogicalGroup } from '../../logical/types';
import { type KnownDevice, type RemoteSharingConfig, type ResolvedDevice } from '../../types';

const POLL_INTERVAL_MS = 750;

interface LiveLedControlSectionProps {
  knownDevices: KnownDevice[];
  devices: ResolvedDevice[];
  resolveErrorsByDevice: Record<string, string>;
  endpoints: LedEndpoint[];
  groups: LogicalGroup[];
  pirLabelsByDeviceUri: Record<string, string[]>;
  firmwareVersionByDeviceUri: Record<string, string>;
  onRetryAddress: (deviceName: string) => void;
}

function normalizeLabel(label: string): string {
  return label.trim();
}

function buildVisibleDeviceUris(
  endpoints: LedEndpoint[],
  groups: LogicalGroup[],
  collapsedGroupIds: ReadonlySet<string>
): string[] {
  const endpointsByLabel = new Map<string, LedEndpoint[]>();
  for (const endpoint of endpoints) {
    const label = normalizeLabel(endpoint.label);
    if (!label) {
      continue;
    }
    const current = endpointsByLabel.get(label) ?? [];
    current.push(endpoint);
    endpointsByLabel.set(label, current);
  }

  const groupedLabelSet = new Set<string>();
  for (const group of groups) {
    for (const label of group.labels) {
      const normalized = normalizeLabel(label);
      if (normalized) {
        groupedLabelSet.add(normalized);
      }
    }
  }

  const visibleDeviceUris = new Set<string>();
  for (const group of groups) {
    if (collapsedGroupIds.has(group.id)) {
      continue;
    }
    for (const label of group.labels) {
      const normalized = normalizeLabel(label);
      if (!normalized) {
        continue;
      }
      for (const endpoint of endpointsByLabel.get(normalized) ?? []) {
        visibleDeviceUris.add(endpoint.deviceUri);
      }
    }
  }

  for (const [label, labelEndpoints] of endpointsByLabel.entries()) {
    if (groupedLabelSet.has(label)) {
      continue;
    }
    for (const endpoint of labelEndpoints) {
      visibleDeviceUris.add(endpoint.deviceUri);
    }
  }

  return Array.from(visibleDeviceUris).sort();
}

function formatRemotePirLabel(
  sourceHost: string,
  sourcePirIndex: number,
  devicesByName: Record<string, ResolvedDevice>,
  pirLabelsByDeviceUri: Record<string, string[]>
): string {
  const sourceDevice = devicesByName[sourceHost];
  const sourceDeviceName =
    sourceDevice && sourceDevice.alias.trim().length > 0 ? sourceDevice.alias : sourceDevice?.name ?? sourceHost;
  const sourceDeviceUri = sourceDevice ? toDeviceUri(sourceDevice) : null;
  const sourcePirLabel =
    (sourceDeviceUri ? pirLabelsByDeviceUri[sourceDeviceUri]?.[sourcePirIndex] : undefined) ??
    `PIR ${sourcePirIndex}`;
  return `${sourceDeviceName} / ${sourcePirLabel}`;
}

export default function LiveLedControlSection({
  knownDevices,
  devices,
  resolveErrorsByDevice,
  endpoints,
  groups,
  pirLabelsByDeviceUri,
  firmwareVersionByDeviceUri,
  onRetryAddress,
}: LiveLedControlSectionProps) {
  const [isAutoRefreshEnabled, setIsAutoRefreshEnabled] = useState(true);
  const [collapsedGroupIds, setCollapsedGroupIds] = useState<string[]>([]);
  const [remoteSharingByDeviceUri, setRemoteSharingByDeviceUri] = useState<Record<string, RemoteSharingConfig>>({});

  useEffect(() => {
    const validGroupIds = new Set(groups.map((group) => group.id));
    setCollapsedGroupIds((previous) => previous.filter((groupId) => validGroupIds.has(groupId)));
  }, [groups]);

  useEffect(() => {
    let cancelled = false;
    const deviceUris = devices.map((device) => toDeviceUri(device));

    setRemoteSharingByDeviceUri((previous) => {
      const next: Record<string, RemoteSharingConfig> = {};
      for (const deviceUri of deviceUris) {
        if (previous[deviceUri]) {
          next[deviceUri] = previous[deviceUri];
        }
      }
      return next;
    });

    void Promise.all(
      deviceUris.map(async (deviceUri) => {
        try {
          const config = await getRemoteSharingConfig(deviceUri);
          if (!cancelled) {
            setRemoteSharingByDeviceUri((previous) => ({ ...previous, [deviceUri]: config }));
          }
        } catch {
          if (!cancelled) {
            setRemoteSharingByDeviceUri((previous) => {
              const next = { ...previous };
              delete next[deviceUri];
              return next;
            });
          }
        }
      })
    );

    return () => {
      cancelled = true;
    };
  }, [devices]);

  const collapsedGroupIdSet = useMemo(() => new Set(collapsedGroupIds), [collapsedGroupIds]);
  const visibleDeviceUris = useMemo(
    () => buildVisibleDeviceUris(endpoints, groups, collapsedGroupIdSet),
    [endpoints, groups, collapsedGroupIdSet]
  );
  const visibleDeviceUriSet = useMemo(() => new Set(visibleDeviceUris), [visibleDeviceUris]);
  const unresolvedCount = Math.max(0, knownDevices.length - devices.length);
  const resolvedDevicesByName = useMemo(() => {
    const next: Record<string, ResolvedDevice> = {};
    for (const device of devices) {
      next[device.name] = device;
    }
    return next;
  }, [devices]);

  const pausedByDeviceUri = useMemo<Record<string, boolean>>(() => {
    const next: Record<string, boolean> = {};
    for (const device of devices) {
      const deviceUri = toDeviceUri(device);
      next[deviceUri] = !visibleDeviceUriSet.has(deviceUri);
    }
    return next;
  }, [devices, visibleDeviceUriSet]);
  const livePirLabelsByDeviceUri = useMemo(() => {
    const next: Record<string, string[]> = {};
    for (const device of devices) {
      const deviceUri = toDeviceUri(device);
      const labels = [...(pirLabelsByDeviceUri[deviceUri] ?? [])];
      const remoteSharing = remoteSharingByDeviceUri[deviceUri];
      if (remoteSharing) {
        remoteSharing.remotePirs.forEach((remotePir, slotIndex) => {
          if (!remotePir.enabled || remotePir.sourceHost.trim().length === 0) {
            return;
          }
          labels[8 + slotIndex] = formatRemotePirLabel(
            remotePir.sourceHost,
            remotePir.sourcePirIndex,
            resolvedDevicesByName,
            pirLabelsByDeviceUri
          );
        });
      }
      next[deviceUri] = labels;
    }
    return next;
  }, [devices, pirLabelsByDeviceUri, remoteSharingByDeviceUri, resolvedDevicesByName]);

  const toggleGroupCollapse = useCallback((groupId: string) => {
    setCollapsedGroupIds((previous) => {
      if (previous.includes(groupId)) {
        return previous.filter((id) => id !== groupId);
      }
      return [...previous, groupId];
    });
  }, []);

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
    activePollingDeviceUris: visibleDeviceUris,
  });

  return (
    <section className="rounded-xl border border-slate-200 bg-gradient-to-b from-white to-slate-50/40 p-5 shadow-sm">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 pb-4">
        <div className="space-y-1">
          <h3 className="text-lg font-semibold text-slate-900">Live LED Control</h3>
          <p className="text-sm text-slate-600">Logical-first live control with per-device transport status.</p>
          <div className="flex flex-wrap gap-1.5 text-xs">
            <span className="rounded-full border border-slate-300 bg-white px-2 py-0.5 text-slate-600">
              Resolved: {devices.length}
            </span>
            <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-amber-700">
              Unresolved: {unresolvedCount}
            </span>
            <span className="rounded-full border border-slate-300 bg-white px-2 py-0.5 text-slate-600">
              Visible: {visibleDeviceUris.length}
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
            disabled={visibleDeviceUris.length === 0}
            className="rounded-full border border-blue-200 bg-blue-50 px-3 py-1.5 text-xs font-medium text-blue-700 hover:bg-blue-100 disabled:cursor-not-allowed disabled:border-slate-200 disabled:bg-slate-100 disabled:text-slate-400"
          >
            Refresh Visible
          </button>
        </div>
      </div>

      {knownDevices.length === 0 ? (
        <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-4 text-sm text-slate-600">
          No known devices in the cache yet. Refresh the device cache to start.
        </div>
      ) : (
        <div className="space-y-6">
          <DeviceHealthStrip
            knownDevices={knownDevices}
            resolvedDevicesByName={resolvedDevicesByName}
            resolveErrorsByDevice={resolveErrorsByDevice}
            deviceHealthByUri={deviceHealthByUri}
            firmwareVersionByDeviceUri={firmwareVersionByDeviceUri}
            persistingByDeviceUri={persistingByDeviceUri}
            pausedByDeviceUri={pausedByDeviceUri}
            onPersistDevice={(device) => {
              void persistDevice(device);
            }}
            onRetryDevice={(device) => {
              void retryDevice(device);
            }}
            onRetryAddress={onRetryAddress}
          />
          {devices.length === 0 ? (
            <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-4 text-sm text-slate-600">
              No resolved devices in the cache yet. Refresh the device cache or retry an unresolved address.
            </div>
          ) : (
            <LogicalEndpointSections
              endpoints={endpoints}
              groups={groups}
              collapsedGroupIds={collapsedGroupIdSet}
              onToggleGroupCollapse={toggleGroupCollapse}
              pirLabelsByDeviceUri={livePirLabelsByDeviceUri}
              snapshotsByDeviceUri={snapshotsByDeviceUri}
              draftByEndpointId={draftByEndpointId}
              dirtyByEndpointId={dirtyByEndpointId}
              pendingByEndpointId={pendingByEndpointId}
              onDraftChange={updateEndpointDraft}
              onApply={applyEndpoint}
              onReset={resetEndpoint}
            />
          )}
        </div>
      )}
    </section>
  );
}
