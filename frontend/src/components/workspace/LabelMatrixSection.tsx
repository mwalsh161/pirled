import { useEffect, useMemo, useState } from 'react';
import { toDeviceUri, type LedEndpoint } from '../../logical/types';
import { type DeviceSnapshot, PHYSICAL_PIR_COUNT, type KnownDevice, type ResolvedDevice } from '../../types';
import { type DeviceLiveHealth } from '../../live/useDeviceSnapshotPolling';
import { dirtyActionButtonClass, dirtyCardClass } from '../ui/dirtyState';
import PirChipGroup from '../ui/PirChipGroup';
import { isMaskEnabled } from '../ui/pir';
import DeviceStatusCard, { type DeviceStatusTone } from './shared/DeviceStatusCard';

type DisplayTone = DeviceLiveHealth['tone'] | 'unresolved';

interface LabelMatrixSectionProps {
  devices: KnownDevice[];
  endpoints: LedEndpoint[];
  aliasesByDevice: Record<string, string>;
  pirAssignmentsByDevice: Record<string, number[]>;
  dirtyLabelDevices: Record<string, boolean>;
  resolvedDevicesByName: Record<string, ResolvedDevice>;
  snapshotsByDeviceUri: Record<string, DeviceSnapshot>;
  deviceHealthByUri: Record<string, DeviceLiveHealth>;
  firmwareVersionByDeviceUri: Record<string, string>;
  hasCompletedLabelSetup: boolean;
  onSetActiveDeviceUri: (deviceUri: string | null) => void;
  onRetryDevice: (deviceName: string) => void;
  onUpdateLabel: (endpointId: string, label: string) => void;
  onUpdateAlias: (deviceName: string, alias: string) => void;
  onAssignDefaultPir: (deviceName: string, ledIndex: number, pirIndex: number) => void;
  onSaveLabelsForDevice: (deviceName: string) => Promise<boolean>;
}

function groupEndpointsByDevice(endpoints: LedEndpoint[]): Map<string, LedEndpoint[]> {
  const grouped = new Map<string, LedEndpoint[]>();
  for (const endpoint of endpoints) {
    const current = grouped.get(endpoint.deviceName) ?? [];
    current.push(endpoint);
    grouped.set(endpoint.deviceName, current);
  }
  return grouped;
}

function toneText(tone: DisplayTone): string {
  if (tone === 'ok') {
    return 'ok';
  }
  if (tone === 'offline') {
    return 'offline';
  }
  if (tone === 'error') {
    return 'error';
  }
  if (tone === 'working') {
    return 'syncing';
  }
  if (tone === 'unresolved') {
    return 'unresolved';
  }
  return 'idle';
}

function activePirCount(pirState: number | undefined): number {
  if (pirState === undefined) {
    return 0;
  }
  let count = 0;
  for (let index = 0; index < PHYSICAL_PIR_COUNT; index += 1) {
    if (isMaskEnabled(pirState, index)) {
      count += 1;
    }
  }
  return count;
}

function ledOnCount(rows: LedEndpoint[], snapshot: DeviceSnapshot | undefined): number {
  if (!snapshot) {
    return 0;
  }
  return rows.reduce((count, endpoint) => {
    const brightness = snapshot.ledStates[endpoint.ledIndex]?.brightness ?? 0;
    return count + (brightness > 0 ? 1 : 0);
  }, 0);
}

export default function LabelMatrixSection({
  devices,
  endpoints,
  aliasesByDevice,
  pirAssignmentsByDevice,
  dirtyLabelDevices,
  resolvedDevicesByName,
  snapshotsByDeviceUri,
  deviceHealthByUri,
  firmwareVersionByDeviceUri,
  hasCompletedLabelSetup,
  onSetActiveDeviceUri,
  onRetryDevice,
  onUpdateLabel,
  onUpdateAlias,
  onAssignDefaultPir,
  onSaveLabelsForDevice,
}: LabelMatrixSectionProps) {
  const endpointsByDevice = groupEndpointsByDevice(endpoints);
  const [showDirtyOnly, setShowDirtyOnly] = useState(false);
  const [openDeviceName, setOpenDeviceName] = useState<string | null>(null);

  const dirtyDevices = useMemo(
    () => devices.filter((device) => dirtyLabelDevices[device.name] ?? false),
    [devices, dirtyLabelDevices]
  );
  const visibleDevices = showDirtyOnly ? dirtyDevices : devices;
  const visibleDeviceNameSet = useMemo(() => new Set(visibleDevices.map((device) => device.name)), [visibleDevices]);

  useEffect(() => {
    if (!openDeviceName || !visibleDeviceNameSet.has(openDeviceName)) {
      onSetActiveDeviceUri(null);
      if (openDeviceName) {
        setOpenDeviceName(null);
      }
      return;
    }

    const resolved = resolvedDevicesByName[openDeviceName];
    onSetActiveDeviceUri(resolved ? toDeviceUri(resolved) : null);
  }, [onSetActiveDeviceUri, openDeviceName, resolvedDevicesByName, visibleDeviceNameSet]);

  const openFirstDirtyCard = () => {
    const firstDirty = dirtyDevices[0];
    if (!firstDirty) {
      return;
    }
    setOpenDeviceName(firstDirty.name);
  };

  const saveAllDirtyDevices = () => {
    void (async () => {
      for (const device of dirtyDevices) {
        await onSaveLabelsForDevice(device.name);
      }
    })();
  };

  return (
    <section className="rounded-lg border bg-white p-5 shadow-sm">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-lg font-semibold text-gray-900">Label Matrix</h3>
          <p className="text-sm text-gray-600">Rename LEDs to logical labels and persist by device.</p>
          <p className="text-xs text-gray-500">
            Devices: {devices.length} | Dirty: {dirtyDevices.length}
            {hasCompletedLabelSetup ? ' | Setup complete' : ''}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={saveAllDirtyDevices}
            disabled={dirtyDevices.length === 0}
            className={`rounded border px-2 py-1 text-xs font-medium ${dirtyActionButtonClass(dirtyDevices.length > 0, 'gray')} disabled:cursor-not-allowed disabled:border-gray-200 disabled:text-gray-400`}
          >
            Save All Dirty
          </button>
          <button
            type="button"
            onClick={openFirstDirtyCard}
            disabled={dirtyDevices.length === 0}
            className="rounded border border-gray-300 px-2 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:border-gray-200 disabled:text-gray-400"
          >
            Open Dirty
          </button>
        </div>
      </div>

      <div className="mb-4 flex items-center gap-2 text-xs text-gray-700">
        <label className="flex items-center gap-2 rounded border border-gray-300 bg-gray-50 px-2 py-1">
          <input
            type="checkbox"
            checked={showDirtyOnly}
            onChange={(event) => {
              setShowDirtyOnly(event.target.checked);
            }}
          />
          Show Dirty Only
        </label>
      </div>

      <div className="space-y-3">
          {visibleDevices.map((device) => {
            const aliasDraft = aliasesByDevice[device.name] ?? device.alias;
            const trimmedAlias = aliasDraft.trim();
            const deviceDisplayName = trimmedAlias.length > 0 ? trimmedAlias : device.name;
            const rows = [...(endpointsByDevice.get(device.name) ?? [])].sort((left, right) => left.ledIndex - right.ledIndex);
            const assignment = pirAssignmentsByDevice[device.name] ?? [0, 1, 2, 3];
            const hasUnsavedLabels = dirtyLabelDevices[device.name] ?? false;
            const resolved = resolvedDevicesByName[device.name];
            const deviceUri = resolved ? toDeviceUri(resolved) : null;
            const deviceUrl = deviceUri ? `http://${deviceUri}` : null;
            const deviceLogsUrl = deviceUrl ? `${deviceUrl}/logs` : null;
            const snapshot = deviceUri ? snapshotsByDeviceUri[deviceUri] : undefined;
            const health = deviceUri ? deviceHealthByUri[deviceUri] : undefined;
            const tone: DisplayTone = !resolved ? 'unresolved' : health?.tone ?? 'idle';
            const isOpen = openDeviceName === device.name;
            const pirLabels = Array.from({ length: PHYSICAL_PIR_COUNT }, (_, pirIndex) => `PIR ${pirIndex}`);
            const isOffline = tone === 'offline';

            return (
              <article
                key={device.name}
                className={`rounded border p-4 transition-colors ${dirtyCardClass(hasUnsavedLabels, 'gray')}`}
              >
                <DeviceStatusCard
                  className="mb-2"
                  deviceDisplayName={deviceDisplayName}
                  tone={tone as DeviceStatusTone}
                  metaText={`${toneText(tone)} | LED on ${ledOnCount(rows, snapshot)}/${rows.length} | PIR active ${activePirCount(snapshot?.pirState)}/${PHYSICAL_PIR_COUNT}`}
                  {...(deviceUri && firmwareVersionByDeviceUri[deviceUri]
                    ? { versionText: firmwareVersionByDeviceUri[deviceUri] }
                    : {})}
                  {...(health?.lastError ? { errorText: health.lastError } : {})}
                  onHeaderClick={() => {
                    setOpenDeviceName((previous) => (previous === device.name ? null : device.name));
                  }}
                  actions={
                    <div className="flex items-center gap-2">
                      {isOffline ? (
                        <button
                          type="button"
                          onClick={() => {
                            onRetryDevice(device.name);
                          }}
                          className="rounded border border-amber-300 bg-amber-100 px-2 py-1 text-xs font-medium text-amber-800 hover:bg-amber-200"
                        >
                          Retry
                        </button>
                      ) : null}
                      {deviceLogsUrl ? (
                        <a
                          href={deviceLogsUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="rounded border border-gray-300 bg-white px-2 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50"
                        >
                          Logs
                        </a>
                      ) : null}
                      <button
                        type="button"
                        onClick={() => {
                          void onSaveLabelsForDevice(device.name);
                        }}
                        className={`rounded border px-2 py-1 text-xs font-medium ${dirtyActionButtonClass(hasUnsavedLabels, 'gray')}`}
                      >
                        Save Labels
                      </button>
                    </div>
                  }
                />
                {!isOpen ? null : (
                  <>
                    <label className="mb-3 mt-3 block text-xs font-medium text-gray-600">
                      Alias
                      <input
                        type="text"
                        value={aliasDraft}
                        placeholder={device.name}
                        onChange={(event) => {
                          onUpdateAlias(device.name, event.target.value);
                        }}
                        className="mt-1 w-full rounded border border-gray-300 px-2 py-1 text-sm text-gray-900"
                      />
                    </label>
                    <div className="space-y-1.5">
                      {rows.map((endpoint) => {
                        const liveBrightness = snapshot?.ledStates[endpoint.ledIndex]?.brightness;
                        const isLedOn = (liveBrightness ?? 0) > 0;
                        return (
                          <div key={endpoint.id} className="rounded border border-gray-200 p-1.5">
                            <div className="flex items-start gap-2 text-sm">
                              <div className="w-16 shrink-0 text-gray-600">
                                <div>LED {endpoint.ledIndex}</div>
                                <div className="pt-0.5">
                                  <span
                                    className={`rounded-full border px-1.5 py-0.5 text-[10px] font-medium ${
                                      liveBrightness === undefined
                                        ? 'border-slate-300 bg-slate-100 text-slate-600'
                                        : isLedOn
                                          ? 'border-emerald-300 bg-emerald-50 text-emerald-800'
                                          : 'border-slate-300 bg-slate-100 text-slate-600'
                                    }`}
                                  >
                                    {liveBrightness === undefined ? 'No data' : isLedOn ? 'ON' : 'OFF'}
                                  </span>
                                </div>
                              </div>
                              <input
                                type="text"
                                value={endpoint.label}
                                placeholder="Unused"
                                onChange={(event) => {
                                  onUpdateLabel(endpoint.id, event.target.value);
                                }}
                                className="w-full rounded border border-gray-300 px-2 py-1"
                              />
                            </div>
                            <p className="pl-16 pt-0.5 text-xs text-gray-500">Leave blank to mark unused.</p>
                            <div className="mt-1 pl-16 text-xs text-gray-600">
                              <div className="mb-0.5 font-medium text-gray-500">Default PIR</div>
                              <PirChipGroup
                                count={PHYSICAL_PIR_COUNT}
                                labels={pirLabels}
                                isSelected={(pirIndex) => assignment[pirIndex] === endpoint.ledIndex}
                                isActive={(pirIndex) => isMaskEnabled(snapshot?.pirState ?? 0, pirIndex)}
                                onSelect={(pirIndex) => {
                                  onAssignDefaultPir(device.name, endpoint.ledIndex, pirIndex);
                                }}
                              />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </>
                )}
              </article>
            );
          })}
      </div>

      {showDirtyOnly && visibleDevices.length === 0 ? (
        <div className="mt-3 rounded border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-600">
          No dirty devices right now.
        </div>
      ) : null}
    </section>
  );
}
