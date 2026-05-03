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
  type PirEventDestinationConfig,
  type RemotePirConfig,
  type RemoteSharingConfig,
  type ResolvedDevice,
} from '../../types';

interface RemoteSensorSharingSectionProps {
  devices: ResolvedDevice[];
  pirLabelsByDeviceUri: Record<string, string[]>;
}

interface SectionStatus {
  tone: 'idle' | 'working' | 'success' | 'error';
  message: string;
}

type RemoteSharingConfigByDeviceUri = Record<string, RemoteSharingConfig>;

function cloneRemotePirConfig(remotePir: RemotePirConfig): RemotePirConfig {
  return { ...remotePir };
}

function cloneRemotePirList(remotePirs: RemotePirConfig[]): RemotePirConfig[] {
  return remotePirs.map((remotePir) => cloneRemotePirConfig(remotePir));
}

function cloneRemoteSharingConfig(config: RemoteSharingConfig): RemoteSharingConfig {
  return {
    eventDestinations: config.eventDestinations.map((destination) => ({ ...destination })),
    remotePirs: cloneRemotePirList(config.remotePirs),
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

function deviceDisplayName(device: ResolvedDevice): string {
  return device.alias.trim().length > 0 ? device.alias : device.name;
}

function formatRemotePirLabel(
  remotePir: RemotePirConfig,
  devicesByName: Record<string, ResolvedDevice>,
  pirLabelsByDeviceUri: Record<string, string[]>
): string {
  if (remotePir.sourceHost.trim().length === 0) {
    return 'Unassigned';
  }
  const sourceDevice = devicesByName[remotePir.sourceHost];
  const sourceName = sourceDevice ? deviceDisplayName(sourceDevice) : remotePir.sourceHost;
  const sourceDeviceUri = sourceDevice ? toDeviceUri(sourceDevice) : null;
  const sourcePirLabel =
    (sourceDeviceUri ? pirLabelsByDeviceUri[sourceDeviceUri]?.[remotePir.sourcePirIndex] : undefined) ??
    `PIR ${remotePir.sourcePirIndex}`;
  return `${sourceName} / ${sourcePirLabel}`;
}

function collectDesiredDestinationHostsForSource(
  sourceDeviceName: string,
  devicesByUri: Record<string, ResolvedDevice>,
  configsByDeviceUri: RemoteSharingConfigByDeviceUri
): string[] {
  const targets = new Set<string>();
  for (const [deviceUri, config] of Object.entries(configsByDeviceUri)) {
    const targetDevice = devicesByUri[deviceUri];
    if (!targetDevice) {
      continue;
    }
    for (const remotePir of config.remotePirs) {
      if (!remotePir.enabled || remotePir.sourceHost.trim().length === 0) {
        continue;
      }
      if (remotePir.sourceHost === sourceDeviceName) {
        targets.add(targetDevice.name);
      }
    }
  }
  return Array.from(targets).sort((left, right) => left.localeCompare(right));
}

function buildManagedDestinations(
  current: PirEventDestinationConfig[],
  desiredHosts: string[],
  sourceDeviceName: string
): PirEventDestinationConfig[] {
  if (desiredHosts.length > current.length) {
    throw new Error(
      `${sourceDeviceName} needs ${desiredHosts.length} outgoing broadcast slots, but the firmware only supports ${current.length}.`
    );
  }

  const desiredSet = new Set(desiredHosts);
  const orderedHosts: string[] = [];
  for (const destination of current) {
    if (!destination.enabled || destination.host.trim().length === 0) {
      continue;
    }
    if (!desiredSet.has(destination.host) || orderedHosts.includes(destination.host)) {
      continue;
    }
    orderedHosts.push(destination.host);
  }
  for (const host of desiredHosts) {
    if (!orderedHosts.includes(host)) {
      orderedHosts.push(host);
    }
  }

  return current.map((_, index) => {
    const host = orderedHosts[index] ?? '';
    return {
      host,
      enabled: host.length > 0,
    };
  });
}

export default function RemoteSensorSharingSection({
  devices,
  pirLabelsByDeviceUri,
}: RemoteSensorSharingSectionProps) {
  const [activeDeviceUri, setActiveDeviceUri] = useState<string>('');
  const [configsByDeviceUri, setConfigsByDeviceUri] = useState<RemoteSharingConfigByDeviceUri>({});
  const [draftRemotePirs, setDraftRemotePirs] = useState<RemotePirConfig[] | null>(null);
  const [status, setStatus] = useState<SectionStatus>({
    tone: 'idle',
    message: 'Remote sharing ready.',
  });
  const [savingKey, setSavingKey] = useState<string | null>(null);

  const deviceOptions = useMemo(
    () =>
      devices.map((device) => {
        const deviceUri = toDeviceUri(device);
        return {
          device,
          deviceUri,
          displayName: deviceDisplayName(device),
        };
      }),
    [devices]
  );
  const activeDevice = deviceOptions.find((option) => option.deviceUri === activeDeviceUri)?.device ?? null;
  const devicesByName = useMemo(() => {
    const next: Record<string, ResolvedDevice> = {};
    for (const device of devices) {
      next[device.name] = device;
    }
    return next;
  }, [devices]);
  const devicesByUri = useMemo(() => {
    const next: Record<string, ResolvedDevice> = {};
    for (const device of devices) {
      next[toDeviceUri(device)] = device;
    }
    return next;
  }, [devices]);
  const activeConfig = activeDeviceUri ? configsByDeviceUri[activeDeviceUri] ?? null : null;
  const hasDirtyRemotePirs =
    activeConfig !== null &&
    draftRemotePirs !== null &&
    draftRemotePirs.some((remotePir, index) => {
      const persistedRemotePir = activeConfig.remotePirs[index];
      return !persistedRemotePir || !isRemotePirEqual(remotePir, persistedRemotePir);
    });

  const loadAllRemoteSharingConfigs = useCallback(async () => {
    if (deviceOptions.length === 0) {
      setConfigsByDeviceUri({});
      setDraftRemotePirs(null);
      setStatus({ tone: 'idle', message: 'No resolved devices available.' });
      return;
    }

    setStatus({ tone: 'working', message: 'Loading remote sharing for all resolved devices...' });
    try {
      const entries = await Promise.all(
        deviceOptions.map(async ({ deviceUri }) => [deviceUri, await getRemoteSharingConfig(deviceUri)] as const)
      );
      const next: RemoteSharingConfigByDeviceUri = {};
      for (const [deviceUri, config] of entries) {
        next[deviceUri] = config;
      }
      setConfigsByDeviceUri(next);
      setStatus({ tone: 'success', message: 'Remote sharing loaded.' });
    } catch (error) {
      setConfigsByDeviceUri({});
      setDraftRemotePirs(null);
      setStatus({ tone: 'error', message: toErrorMessage(error) });
    }
  }, [deviceOptions]);

  useEffect(() => {
    if (deviceOptions.length === 0) {
      setActiveDeviceUri('');
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
    void loadAllRemoteSharingConfigs();
  }, [loadAllRemoteSharingConfigs]);

  useEffect(() => {
    if (!activeConfig) {
      setDraftRemotePirs(null);
      return;
    }
    setDraftRemotePirs(cloneRemotePirList(activeConfig.remotePirs));
  }, [activeConfig]);

  const updateRemotePirDraft = (index: number, patch: Partial<RemotePirConfig>) => {
    setDraftRemotePirs((previous) => {
      if (!previous) {
        return previous;
      }
      const next = cloneRemotePirList(previous);
      const existing = next[index];
      if (!existing) {
        return previous;
      }
      next[index] = { ...existing, ...patch };
      return next;
    });
  };

  const syncDerivedDestinations = useCallback(
    async (
      startingConfigsByDeviceUri: RemoteSharingConfigByDeviceUri
    ): Promise<{ configsByDeviceUri: RemoteSharingConfigByDeviceUri; dirtyDeviceUris: string[] }> => {
      const nextConfigsByDeviceUri: RemoteSharingConfigByDeviceUri = { ...startingConfigsByDeviceUri };
      const dirtyDeviceUris: string[] = [];

      for (const device of devices) {
        const sourceDeviceUri = toDeviceUri(device);
        const currentConfig = nextConfigsByDeviceUri[sourceDeviceUri];
        if (!currentConfig) {
          continue;
        }

        const desiredHosts = collectDesiredDestinationHostsForSource(device.name, devicesByUri, nextConfigsByDeviceUri);
        const desiredDestinations = buildManagedDestinations(
          currentConfig.eventDestinations,
          desiredHosts,
          deviceDisplayName(device)
        );

        let latestConfig = currentConfig;
        for (let index = 0; index < desiredDestinations.length; index += 1) {
          const desiredDestination = desiredDestinations[index];
          if (!desiredDestination) {
            continue;
          }
          const currentDestination = latestConfig.eventDestinations[index];
          if (currentDestination && isDestinationEqual(currentDestination, desiredDestination)) {
            continue;
          }

          latestConfig = await setPirEventDestinationConfig(sourceDeviceUri, index, desiredDestination);
          nextConfigsByDeviceUri[sourceDeviceUri] = cloneRemoteSharingConfig(latestConfig);
          if (!dirtyDeviceUris.includes(sourceDeviceUri)) {
            dirtyDeviceUris.push(sourceDeviceUri);
          }
        }
      }

      return { configsByDeviceUri: nextConfigsByDeviceUri, dirtyDeviceUris };
    },
    [devices, devicesByUri]
  );

  const saveRemotePir = async (index: number) => {
    const remotePir = draftRemotePirs?.[index];
    if (!activeDeviceUri || !remotePir) {
      return;
    }

    setSavingKey(`remote:${index}`);
    setStatus({ tone: 'working', message: `Saving remote input R${index} and syncing broadcasts...` });
    try {
      const updatedActiveConfig = await setRemotePirConfig(activeDeviceUri, index, remotePir);
      const nextConfigsByDeviceUri: RemoteSharingConfigByDeviceUri = {
        ...configsByDeviceUri,
        [activeDeviceUri]: cloneRemoteSharingConfig(updatedActiveConfig),
      };
      const synced = await syncDerivedDestinations(nextConfigsByDeviceUri);

      setConfigsByDeviceUri(synced.configsByDeviceUri);
      const syncedActiveConfig = synced.configsByDeviceUri[activeDeviceUri];
      if (!syncedActiveConfig) {
        throw new Error('Active device config disappeared during remote sharing sync.');
      }
      setDraftRemotePirs(cloneRemotePirList(syncedActiveConfig.remotePirs));
      setStatus({
        tone: 'success',
        message: `Remote input R${index} saved. Broadcasts were synced across the affected devices.`,
      });
    } catch (error) {
      await loadAllRemoteSharingConfigs();
      setStatus({ tone: 'error', message: toErrorMessage(error) });
    } finally {
      setSavingKey(null);
    }
  };

  const persistAllDevices = async () => {
    if (deviceOptions.length === 0) {
      return;
    }

    setSavingKey('persist');
    setStatus({ tone: 'working', message: 'Persisting all resolved devices to flash...' });
    try {
      for (const { deviceUri } of deviceOptions) {
        await saveDeviceConfig(deviceUri, Date.now());
      }
      setStatus({
        tone: 'success',
        message: `Persisted ${deviceOptions.length} resolved device${deviceOptions.length === 1 ? '' : 's'} to flash.`,
      });
    } catch (error) {
      setStatus({ tone: 'error', message: toErrorMessage(error) });
    } finally {
      setSavingKey(null);
    }
  };

  const derivedOutgoingDestinations = useMemo(() => {
    if (!activeDevice || !activeConfig) {
      return [];
    }
    try {
      const desiredHosts = collectDesiredDestinationHostsForSource(activeDevice.name, devicesByUri, configsByDeviceUri);
      return buildManagedDestinations(activeConfig.eventDestinations, desiredHosts, deviceDisplayName(activeDevice));
    } catch {
      return activeConfig.eventDestinations;
    }
  }, [activeConfig, activeDevice, configsByDeviceUri, devicesByUri]);

  return (
    <section className="rounded-lg border bg-white p-5 shadow-sm">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-lg font-semibold text-gray-900">Remote Sensor Sharing</h3>
          <p className="text-sm text-gray-600">Add extra remote inputs on a device, then let the app sync the needed broadcasts.</p>
          <p className="text-xs text-gray-500">Outgoing broadcasts are derived from enabled remote inputs and shown read-only here.</p>
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
            disabled={savingKey !== null}
            onClick={() => {
              void loadAllRemoteSharingConfigs();
            }}
            className="rounded border border-gray-300 px-2 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:border-gray-200 disabled:text-gray-400"
          >
            Refresh All
          </button>
          <button
            type="button"
            disabled={savingKey === 'persist' || hasDirtyRemotePirs || deviceOptions.length === 0}
            onClick={() => {
              void persistAllDevices();
            }}
            className="rounded border border-emerald-300 bg-emerald-50 px-2 py-1.5 text-xs font-medium text-emerald-800 hover:bg-emerald-100 disabled:cursor-not-allowed disabled:border-gray-200 disabled:bg-gray-50 disabled:text-gray-400"
          >
            Save All To Flash
          </button>
        </div>
      </div>

        <div className={`mb-4 rounded border px-3 py-2 text-xs ${statusClass(status.tone)}`}>
        {activeDevice ? `${deviceDisplayName(activeDevice)}: ` : ''}
        {status.message}
        {hasDirtyRemotePirs ? ' Save the active remote input row before persisting.' : ''}
      </div>

      {!activeConfig || !draftRemotePirs ? (
        <div className="rounded border border-slate-200 bg-slate-50 px-3 py-4 text-sm text-slate-600">
          Choose a resolved device to edit remote inputs.
        </div>
      ) : (
        <div className="grid gap-4 xl:grid-cols-2">
          <div>
            <div className="mb-2">
              <h4 className="text-sm font-semibold text-gray-900">Extra Remote Inputs</h4>
              <p className="text-xs text-gray-500">Each enabled row adds one remote trigger source to this device. Slot R0 maps to PIR bit 8, R1 maps to bit 9, and so on.</p>
            </div>
            <div className="space-y-2">
              {draftRemotePirs.map((remotePir, index) => {
                const persisted = activeConfig.remotePirs[index];
                const isDirty = persisted ? !isRemotePirEqual(remotePir, persisted) : false;
                const isInvalid = remotePir.enabled && remotePir.sourceHost.trim().length === 0;
                const selectedSourceDevice = devicesByName[remotePir.sourceHost];
                const selectedSourceDeviceUri = selectedSourceDevice ? toDeviceUri(selectedSourceDevice) : null;
                const remoteInputLabel = formatRemotePirLabel(remotePir, devicesByName, pirLabelsByDeviceUri);
                return (
                  <div key={`remote:${index}`} className="rounded border border-slate-200 bg-slate-50 p-2">
                    <div className="mb-2 flex items-center justify-between gap-2">
                      <div>
                        <div className="text-sm font-medium text-slate-800">Input R{index}</div>
                        <div className="text-xs text-slate-500">{remoteInputLabel}</div>
                      </div>
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
                    <div className="grid gap-2 sm:grid-cols-[1fr_1fr_7rem_auto]">
                      <select
                        value={remotePir.sourceHost}
                        onChange={(event) => {
                          updateRemotePirDraft(index, { sourceHost: event.target.value });
                        }}
                        className="rounded border border-gray-300 bg-white px-2 py-1 text-sm"
                      >
                        <option value="">No remote source</option>
                        {deviceOptions
                          .filter((option) => option.device.name !== activeDevice?.name)
                          .map((option) => (
                            <option key={`remote-source:${option.device.name}`} value={option.device.name}>
                              {option.displayName}
                            </option>
                          ))}
                      </select>
                      <select
                        value={remotePir.sourcePirIndex}
                        onChange={(event) => {
                          updateRemotePirDraft(index, {
                            sourcePirIndex: asPirIndex(event.target.value, remotePir.sourcePirIndex),
                          });
                        }}
                        className="rounded border border-gray-300 bg-white px-2 py-1 text-sm"
                      >
                        {Array.from({ length: PHYSICAL_PIR_COUNT }, (_, pirIndex) => {
                          const optionLabel =
                            (selectedSourceDeviceUri ? pirLabelsByDeviceUri[selectedSourceDeviceUri]?.[pirIndex] : undefined) ??
                            `PIR ${pirIndex}`;
                          return (
                            <option key={`source-pir:${index}:${pirIndex}`} value={pirIndex}>
                              {optionLabel}
                            </option>
                          );
                        })}
                      </select>
                      <input
                        type="number"
                        min={1}
                        value={remotePir.leaseMs}
                        onChange={(event) => {
                          updateRemotePirDraft(index, {
                            leaseMs: asPositiveInt(event.target.value, remotePir.leaseMs),
                          });
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

          <div>
            <div className="mb-2">
              <h4 className="text-sm font-semibold text-gray-900">Derived Outgoing Broadcasts</h4>
              <p className="text-xs text-gray-500">Auto-managed from enabled remote inputs across the workspace. These rows are not directly editable.</p>
            </div>
            <div className="space-y-2">
              {derivedOutgoingDestinations.map((destination, index) => {
                const targetDevice = devicesByName[destination.host];
                const targetName = targetDevice ? deviceDisplayName(targetDevice) : destination.host;
                return (
                  <div key={`derived-destination:${index}`} className="rounded border border-slate-200 bg-slate-50 p-2">
                    <div className="mb-1 text-sm font-medium text-slate-800">Broadcast Slot {index}</div>
                    <div className="rounded border border-slate-200 bg-white px-2 py-2 text-sm text-slate-700">
                      {destination.enabled && destination.host.trim().length > 0 ? (
                        <span>{targetName}</span>
                      ) : (
                        <span className="text-slate-400">Unused</span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
