import { PHYSICAL_PIR_COUNT, type KnownDevice } from '../../types';
import { type LedEndpoint } from '../../logical/types';
import { useEffect, useMemo, useState } from 'react';
import { dirtyActionButtonClass, dirtyCardClass } from '../ui/dirtyState';

interface LabelMatrixSectionProps {
  devices: KnownDevice[];
  endpoints: LedEndpoint[];
  aliasesByDevice: Record<string, string>;
  pirAssignmentsByDevice: Record<string, number[]>;
  dirtyLabelDevices: Record<string, boolean>;
  isMatrixCollapsed: boolean;
  hasCompletedLabelSetup: boolean;
  onSetMatrixCollapsed: (collapsed: boolean) => void;
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

export default function LabelMatrixSection({
  devices,
  endpoints,
  aliasesByDevice,
  pirAssignmentsByDevice,
  dirtyLabelDevices,
  isMatrixCollapsed,
  hasCompletedLabelSetup,
  onSetMatrixCollapsed,
  onUpdateLabel,
  onUpdateAlias,
  onAssignDefaultPir,
  onSaveLabelsForDevice,
}: LabelMatrixSectionProps) {
  const endpointsByDevice = groupEndpointsByDevice(endpoints);
  const [showDirtyOnly, setShowDirtyOnly] = useState(false);
  const [collapsedDeviceCards, setCollapsedDeviceCards] = useState<Record<string, boolean>>({});

  useEffect(() => {
    setCollapsedDeviceCards((previous) => {
      const next: Record<string, boolean> = {};
      for (const device of devices) {
        next[device.name] = previous[device.name] ?? hasCompletedLabelSetup;
      }
      return next;
    });
  }, [devices, hasCompletedLabelSetup]);

  const dirtyDevices = useMemo(
    () => devices.filter((device) => dirtyLabelDevices[device.name] ?? false),
    [devices, dirtyLabelDevices]
  );
  const visibleDevices = showDirtyOnly ? dirtyDevices : devices;

  const setAllDeviceCardsCollapsed = (collapsed: boolean) => {
    setCollapsedDeviceCards(() => {
      const next: Record<string, boolean> = {};
      for (const device of devices) {
        next[device.name] = collapsed;
      }
      return next;
    });
  };

  const expandDirtyCards = () => {
    setCollapsedDeviceCards((previous) => {
      const next = { ...previous };
      for (const device of dirtyDevices) {
        next[device.name] = false;
      }
      return next;
    });
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
            onClick={() => setAllDeviceCardsCollapsed(false)}
            className="rounded border border-gray-300 px-2 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50"
          >
            Expand All
          </button>
          <button
            type="button"
            onClick={expandDirtyCards}
            disabled={dirtyDevices.length === 0}
            className="rounded border border-gray-300 px-2 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:border-gray-200 disabled:text-gray-400"
          >
            Expand Dirty
          </button>
          <button
            type="button"
            onClick={() => {
              onSetMatrixCollapsed(!isMatrixCollapsed);
            }}
            className="rounded border border-gray-300 px-2 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50"
          >
            {isMatrixCollapsed ? 'Show Matrix' : 'Hide Matrix'}
          </button>
        </div>
      </div>

      {isMatrixCollapsed ? null : (
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
      )}

      {isMatrixCollapsed ? (
        <div className="rounded border border-gray-200 bg-gray-50 px-3 py-3 text-sm text-gray-600">
          Matrix hidden to reduce scrolling. Use "Show Matrix" when editing labels.
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {visibleDevices.map((device) => {
            const aliasDraft = aliasesByDevice[device.name] ?? device.alias;
            const trimmedAlias = aliasDraft.trim();
            const deviceDisplayName = trimmedAlias.length > 0 ? trimmedAlias : device.name;
            const rows = [...(endpointsByDevice.get(device.name) ?? [])].sort((left, right) => left.ledIndex - right.ledIndex);
            const assignment = pirAssignmentsByDevice[device.name] ?? [0, 1, 2, 3];
            const hasUnsavedLabels = dirtyLabelDevices[device.name] ?? false;
            const cardCollapsed = collapsedDeviceCards[device.name] ?? false;
            return (
              <article
                key={device.name}
                className={`rounded border p-4 transition-colors ${dirtyCardClass(hasUnsavedLabels, 'gray')}`}
              >
                <div className="mb-3 flex items-center justify-between gap-3">
                  <div>
                    <h4 className="flex items-center gap-2 font-semibold text-gray-900">
                      <span
                        className={`h-2 w-2 rounded-full transition-colors ${
                          device.resolved ? 'bg-emerald-500' : 'bg-gray-300'
                        }`}
                      />
                      {deviceDisplayName}
                    </h4>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        setCollapsedDeviceCards((previous) => ({
                          ...previous,
                          [device.name]: !cardCollapsed,
                        }));
                      }}
                      className="rounded border border-gray-300 px-2 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50"
                    >
                      {cardCollapsed ? 'Expand' : 'Collapse'}
                    </button>
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
                </div>
                {cardCollapsed ? null : (
                  <>
                    <label className="mb-3 block text-xs font-medium text-gray-600">
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
                    <div className="space-y-2">
                      {rows.map((endpoint) => {
                        return (
                          <div key={endpoint.id} className="rounded border border-gray-200 p-2">
                            <div className="flex items-center gap-2 text-sm">
                              <span className="w-16 text-gray-600">LED {endpoint.ledIndex}</span>
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
                            <p className="pl-16 pt-1 text-xs text-gray-500">Leave blank to mark unused.</p>
                            <div className="mt-2 flex items-center gap-3 pl-16 text-xs text-gray-600">
                              <span className="font-medium text-gray-500">Default PIR:</span>
                              {Array.from({ length: PHYSICAL_PIR_COUNT }, (_, pirIndex) => {
                                const isChecked = assignment[pirIndex] === endpoint.ledIndex;
                                return (
                                  <label key={`${endpoint.id}:pir:${pirIndex}`} className="flex items-center gap-1">
                                    <input
                                      type="checkbox"
                                      checked={isChecked}
                                      onChange={(event) => {
                                        if (!event.target.checked) {
                                          return;
                                        }
                                        onAssignDefaultPir(device.name, endpoint.ledIndex, pirIndex);
                                      }}
                                    />
                                    PIR {pirIndex}
                                  </label>
                                );
                              })}
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
      )}

      {!isMatrixCollapsed && showDirtyOnly && visibleDevices.length === 0 ? (
        <div className="mt-3 rounded border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-600">
          No dirty devices right now.
        </div>
      ) : null}
    </section>
  );
}
