import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  getRemoteSharingConfig,
  saveDeviceConfig,
  setPirEventDestinationConfig,
  setRemotePirConfig,
} from '../../api';
import { toDeviceUri } from '../../logical/types';
import {
  PHYSICAL_PIR_COUNT,
  REMOTE_PIR_SLOT_COUNT,
  type PirEventDestinationConfig,
  type RemotePirConfig,
  type RemoteSharingConfig,
  type ResolvedDevice,
} from '../../types';

interface RemoteSensorSharingSectionProps {
  devices: ResolvedDevice[];
}

interface SectionStatus {
  tone: 'idle' | 'working' | 'success' | 'error';
  message: string;
}

function cloneRemoteSharingConfig(config: RemoteSharingConfig): RemoteSharingConfig {
  return {
    eventDestinations: config.eventDestinations.map((destination) => ({ ...destination })),
    remotePirs: config.remotePirs.map((remotePir) => ({ ...remotePir })),
  };
}

function isDestinationEqual(left: PirEventDestinationConfig, right: PirEventDestinationConfig): boolean {
  return left.host === right.host && left.enabled === right.enabled;
}

function isRemotePirEqual(left: RemotePirConfig, right: RemotePirConfig): boolean {
  return (
    left.sourceHost === right.sourceHost &&
    left.sourcePirIndex === right.sourcePirIndex &&
    left.leaseMs === right.leaseMs &&
    left.enabled === right.enabled
  );
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Unknown remote sharing error';
}

function statusClass(tone: SectionStatus['tone']): string {
  if (tone === 'success') {
    return 'border-emerald-200 bg-emerald-50 text-emerald-800';
  }
  if (tone === 'error') {
    return 'border-rose-200 bg-rose-50 text-rose-800';
  }
  if (tone === 'working') {
    return 'border-blue-200 bg-blue-50 text-blue-800';
  }
  return 'border-slate-200 bg-slate-50 text-slate-600';
}

function asPositiveInt(value: string, fallback: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.max(1, Math.trunc(parsed));
}

function asPirIndex(value: string, fallback: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.max(0, Math.min(PHYSICAL_PIR_COUNT - 1, Math.trunc(parsed)));
}

export default function RemoteSensorSharingSection({ devices }: RemoteSensorSharingSectionProps) {
  const [activeDeviceUri, setActiveDeviceUri] = useState<string>('');
  const [persistedConfig, setPersistedConfig] = useState<RemoteSharingConfig | null>(null);
  const [draftConfig, setDraftConfig] = useState<RemoteSharingConfig | null>(null);
  const [status, setStatus] = useState<SectionStatus>({ tone: 'idle', message: 'Remote sharing ready.' });
  const [savingKey, setSavingKey] = useState<string | null>(null);

  const deviceOptions = useMemo(
    () =>
      devices.map((device) => {
        const deviceUri = toDeviceUri(device);
        const displayName = device.alias.trim().length > 0 ? device.alias : device.name;
        return { device, deviceUri, displayName };
      }),
    [devices]
  );
  const activeDevice = deviceOptions.find((option) => option.deviceUri === activeDeviceUri);
  const knownHostnames = deviceOptions.map((option) => option.device.name);
  const hasDirtyConfig =
    persistedConfig !== null &&
    draftConfig !== null &&
    (draftConfig.eventDestinations.some(
      (destination, index) => {
        const persistedDestination = persistedConfig.eventDestinations[index];
        return !persistedDestination || !isDestinationEqual(destination, persistedDestination);
      }
    ) ||
      draftConfig.remotePirs.some((remotePir, index) => {
        const persistedRemotePir = persistedConfig.remotePirs[index];
        return !persistedRemotePir || !isRemotePirEqual(remotePir, persistedRemotePir);
      }));

  const loadRemoteSharingConfig = useCallback(async (deviceUri: string) => {
    setStatus({ tone: 'working', message: 'Loading remote sensor sharing...' });
    try {
      const next = await getRemoteSharingConfig(deviceUri);
      setPersistedConfig(next);
      setDraftConfig(cloneRemoteSharingConfig(next));
      setStatus({ tone: 'success', message: 'Remote sharing loaded.' });
    } catch (error) {
      setPersistedConfig(null);
      setDraftConfig(null);
      setStatus({ tone: 'error', message: toErrorMessage(error) });
    }
  }, []);

  useEffect(() => {
    if (deviceOptions.length === 0) {
      setActiveDeviceUri('');
      setPersistedConfig(null);
      setDraftConfig(null);
      return;
    }
    if (!activeDeviceUri || !deviceOptions.some((option) => option.deviceUri === activeDeviceUri)) {
      const firstDevice = deviceOptions[0];
      if (firstDevice) {
        setActiveDeviceUri(firstDevice.deviceUri);
      }
    }
  }, [activeDeviceUri, deviceOptions]);

  useEffect(() => {
    if (!activeDeviceUri) {
      return;
    }
    void loadRemoteSharingConfig(activeDeviceUri);
  }, [activeDeviceUri, loadRemoteSharingConfig]);

  const updateDestinationDraft = (index: number, patch: Partial<PirEventDestinationConfig>) => {
    setDraftConfig((previous) => {
      if (!previous) {
        return previous;
      }
      const next = cloneRemoteSharingConfig(previous);
      const existing = next.eventDestinations[index];
      if (!existing) {
        return previous;
      }
      next.eventDestinations[index] = { ...existing, ...patch };
      return next;
    });
  };

  const updateRemotePirDraft = (index: number, patch: Partial<RemotePirConfig>) => {
    setDraftConfig((previous) => {
      if (!previous) {
        return previous;
      }
      const next = cloneRemoteSharingConfig(previous);
      const existing = next.remotePirs[index];
      if (!existing) {
        return previous;
      }
      next.remotePirs[index] = { ...existing, ...patch };
      return next;
    });
  };

  const saveDestination = async (index: number) => {
    const destination = draftConfig?.eventDestinations[index];
    if (!activeDeviceUri || !destination) {
      return;
    }
    setSavingKey(`destination:${index}`);
    setStatus({ tone: 'working', message: `Saving destination ${index}...` });
    try {
      const next = await setPirEventDestinationConfig(activeDeviceUri, index, destination);
      setPersistedConfig(next);
      setDraftConfig(cloneRemoteSharingConfig(next));
      setStatus({ tone: 'success', message: `Destination ${index} saved.` });
    } catch (error) {
      setStatus({ tone: 'error', message: toErrorMessage(error) });
    } finally {
      setSavingKey(null);
    }
  };

  const saveRemotePir = async (index: number) => {
    const remotePir = draftConfig?.remotePirs[index];
    if (!activeDeviceUri || !remotePir) {
      return;
    }
    setSavingKey(`remote:${index}`);
    setStatus({ tone: 'working', message: `Saving remote PIR R${index}...` });
    try {
      const next = await setRemotePirConfig(activeDeviceUri, index, remotePir);
      setPersistedConfig(next);
      setDraftConfig(cloneRemoteSharingConfig(next));
      setStatus({ tone: 'success', message: `Remote PIR R${index} saved.` });
    } catch (error) {
      setStatus({ tone: 'error', message: toErrorMessage(error) });
    } finally {
      setSavingKey(null);
    }
  };

  const persistActiveDevice = async () => {
    if (!activeDeviceUri) {
      return;
    }
    setSavingKey('persist');
    setStatus({ tone: 'working', message: 'Persisting remote sharing config...' });
    try {
      await saveDeviceConfig(activeDeviceUri, Date.now());
      setStatus({ tone: 'success', message: 'Remote sharing config persisted to device flash.' });
    } catch (error) {
      setStatus({ tone: 'error', message: toErrorMessage(error) });
    } finally {
      setSavingKey(null);
    }
  };

  return (
    <section className="rounded-lg border bg-white p-5 shadow-sm">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-lg font-semibold text-gray-900">Remote Sensor Sharing</h3>
          <p className="text-sm text-gray-600">Share local PIR edges and map incoming sources into remote PIR slots.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={activeDeviceUri}
            onChange={(event) => {
              setActiveDeviceUri(event.target.value);
            }}
            disabled={deviceOptions.length === 0}
            className="rounded border border-gray-300 bg-white px-2 py-1.5 text-sm text-gray-900"
          >
            {deviceOptions.length === 0 ? <option value="">No resolved devices</option> : null}
            {deviceOptions.map((option) => (
              <option key={option.deviceUri} value={option.deviceUri}>
                {option.displayName}
              </option>
            ))}
          </select>
          <button
            type="button"
            disabled={!activeDeviceUri}
            onClick={() => {
              void loadRemoteSharingConfig(activeDeviceUri);
            }}
            className="rounded border border-gray-300 px-2 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:border-gray-200 disabled:text-gray-400"
          >
            Refresh
          </button>
          <button
            type="button"
            disabled={!activeDeviceUri || savingKey === 'persist' || hasDirtyConfig}
            onClick={() => {
              void persistActiveDevice();
            }}
            className="rounded border border-emerald-300 bg-emerald-50 px-2 py-1.5 text-xs font-medium text-emerald-800 hover:bg-emerald-100 disabled:cursor-not-allowed disabled:border-gray-200 disabled:bg-gray-50 disabled:text-gray-400"
          >
            Save To Flash
          </button>
        </div>
      </div>

      <div className={`mb-4 rounded border px-3 py-2 text-xs ${statusClass(status.tone)}`}>
        {activeDevice ? `${activeDevice.displayName}: ` : ''}
        {status.message}
        {hasDirtyConfig ? ' Unsaved row changes must be saved before persisting.' : ''}
      </div>

      {!draftConfig ? (
        <div className="rounded border border-slate-200 bg-slate-50 px-3 py-4 text-sm text-slate-600">
          Choose a resolved device to edit remote sensor sharing.
        </div>
      ) : (
        <div className="grid gap-4 xl:grid-cols-2">
          <div>
            <div className="mb-2">
              <h4 className="text-sm font-semibold text-gray-900">Outgoing Event Destinations</h4>
              <p className="text-xs text-gray-500">Configured on the device that owns the physical PIR sensors.</p>
            </div>
            <div className="space-y-2">
              {draftConfig.eventDestinations.map((destination, index) => {
                const persisted = persistedConfig?.eventDestinations[index];
                const isDirty = persisted ? !isDestinationEqual(destination, persisted) : false;
                const isInvalid = destination.enabled && destination.host.trim().length === 0;
                return (
                  <div key={`destination:${index}`} className="rounded border border-slate-200 bg-slate-50 p-2">
                    <div className="mb-2 flex items-center justify-between gap-2">
                      <span className="text-sm font-medium text-slate-800">Destination {index}</span>
                      <label className="flex items-center gap-1.5 text-xs font-medium text-slate-700">
                        <input
                          type="checkbox"
                          checked={destination.enabled}
                          onChange={(event) => {
                            updateDestinationDraft(index, { enabled: event.target.checked });
                          }}
                        />
                        Enabled
                      </label>
                    </div>
                    <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
                      <input
                        type="text"
                        list="remote-sharing-hosts"
                        value={destination.host}
                        placeholder="pirled-7BF498"
                        onChange={(event) => {
                          updateDestinationDraft(index, { host: event.target.value.trim() });
                        }}
                        className="rounded border border-gray-300 px-2 py-1 text-sm"
                      />
                      <button
                        type="button"
                        disabled={!isDirty || isInvalid || savingKey !== null}
                        onClick={() => {
                          void saveDestination(index);
                        }}
                        className="rounded border border-blue-300 bg-blue-50 px-2 py-1 text-xs font-medium text-blue-800 hover:bg-blue-100 disabled:cursor-not-allowed disabled:border-gray-200 disabled:bg-gray-50 disabled:text-gray-400"
                      >
                        Save
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div>
            <div className="mb-2">
              <h4 className="text-sm font-semibold text-gray-900">Incoming Remote PIR Slots</h4>
              <p className="text-xs text-gray-500">Slot R0 maps to PIR bit 8, R1 maps to bit 9, and so on.</p>
            </div>
            <div className="space-y-2">
              {draftConfig.remotePirs.slice(0, REMOTE_PIR_SLOT_COUNT).map((remotePir, index) => {
                const persisted = persistedConfig?.remotePirs[index];
                const isDirty = persisted ? !isRemotePirEqual(remotePir, persisted) : false;
                const isInvalid = remotePir.enabled && remotePir.sourceHost.trim().length === 0;
                return (
                  <div key={`remote:${index}`} className="rounded border border-slate-200 bg-slate-50 p-2">
                    <div className="mb-2 flex items-center justify-between gap-2">
                      <span className="text-sm font-medium text-slate-800">PIR R{index}</span>
                      <label className="flex items-center gap-1.5 text-xs font-medium text-slate-700">
                        <input
                          type="checkbox"
                          checked={remotePir.enabled}
                          onChange={(event) => {
                            updateRemotePirDraft(index, { enabled: event.target.checked });
                          }}
                        />
                        Enabled
                      </label>
                    </div>
                    <div className="grid gap-2 sm:grid-cols-[1fr_5rem_7rem_auto]">
                      <input
                        type="text"
                        list="remote-sharing-hosts"
                        value={remotePir.sourceHost}
                        placeholder="pirled-7BF498"
                        onChange={(event) => {
                          updateRemotePirDraft(index, { sourceHost: event.target.value.trim() });
                        }}
                        className="rounded border border-gray-300 px-2 py-1 text-sm"
                      />
                      <select
                        value={remotePir.sourcePirIndex}
                        onChange={(event) => {
                          updateRemotePirDraft(index, {
                            sourcePirIndex: asPirIndex(event.target.value, remotePir.sourcePirIndex),
                          });
                        }}
                        className="rounded border border-gray-300 bg-white px-2 py-1 text-sm"
                      >
                        {Array.from({ length: PHYSICAL_PIR_COUNT }, (_, pirIndex) => (
                          <option key={`source-pir:${pirIndex}`} value={pirIndex}>
                            PIR {pirIndex}
                          </option>
                        ))}
                      </select>
                      <input
                        type="number"
                        min={1}
                        value={remotePir.leaseMs}
                        onChange={(event) => {
                          updateRemotePirDraft(index, { leaseMs: asPositiveInt(event.target.value, remotePir.leaseMs) });
                        }}
                        className="rounded border border-gray-300 px-2 py-1 text-sm"
                      />
                      <button
                        type="button"
                        disabled={!isDirty || isInvalid || savingKey !== null}
                        onClick={() => {
                          void saveRemotePir(index);
                        }}
                        className="rounded border border-blue-300 bg-blue-50 px-2 py-1 text-xs font-medium text-blue-800 hover:bg-blue-100 disabled:cursor-not-allowed disabled:border-gray-200 disabled:bg-gray-50 disabled:text-gray-400"
                      >
                        Save
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      <datalist id="remote-sharing-hosts">
        {knownHostnames.map((hostname) => (
          <option key={hostname} value={hostname} />
        ))}
      </datalist>
    </section>
  );
}
