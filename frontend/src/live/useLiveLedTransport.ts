import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { fetchDeviceSnapshot, saveDeviceConfig, setLedConfig } from '../api';
import { type DeviceSnapshot, type LedConfig, type LedConfigUpdate, type ResolvedDevice } from '../types';
import { toDeviceUri, type LedEndpoint } from '../logical/types';
import { useStaggeredDevicePolling } from './useStaggeredDevicePolling';

const UPDATE_DEBOUNCE_MS = 120;
const OFFLINE_POLL_FAILURE_THRESHOLD = 2;

const CONFIG_FIELDS: Array<keyof LedConfig> = [
  'brightness',
  'rampOnMs',
  'holdOnMs',
  'rampOffMs',
  'waitOnMs',
  'pirMaskOn',
  'pirMaskOff',
];

interface PendingLedUpdate {
  endpointId: string;
  ledIndex: number;
  update: LedConfigUpdate;
  revision: number;
}

export interface DeviceLiveHealth {
  deviceName: string;
  deviceUri: string;
  tone: 'idle' | 'ok' | 'error' | 'working' | 'offline';
  queueDepth: number;
  inFlight: boolean;
  lastSuccessAt?: number;
  lastError?: string;
}

interface UseLiveLedTransportInput {
  devices: ResolvedDevice[];
  endpoints: LedEndpoint[];
  autoRefreshEnabled: boolean;
  pollIntervalMs: number;
}

interface RefreshOptions {
  silent?: boolean;
  fromAutoPoll?: boolean;
}

function mergeLedConfig(config: LedConfig, patch: LedConfigUpdate): LedConfig {
  return { ...config, ...patch };
}

function isLedConfigEqual(left: LedConfig, right: LedConfig): boolean {
  return (
    left.brightness === right.brightness &&
    left.rampOnMs === right.rampOnMs &&
    left.holdOnMs === right.holdOnMs &&
    left.rampOffMs === right.rampOffMs &&
    left.waitOnMs === right.waitOnMs &&
    left.pirMaskOn === right.pirMaskOn &&
    left.pirMaskOff === right.pirMaskOff
  );
}

function isLedStateEqual(left: DeviceSnapshot['ledStates'][number], right: DeviceSnapshot['ledStates'][number]): boolean {
  return left.brightness === right.brightness && left.state === right.state;
}

function mergeSnapshot(
  previousSnapshot: DeviceSnapshot | undefined,
  nextSnapshot: DeviceSnapshot
): DeviceSnapshot {
  if (!previousSnapshot) {
    return nextSnapshot;
  }

  const mergedConfigs = nextSnapshot.ledConfigs.map((config, index) => {
    const previous = previousSnapshot.ledConfigs[index];
    if (!previous) {
      return config;
    }
    return isLedConfigEqual(previous, config) ? previous : config;
  });
  const mergedStates = nextSnapshot.ledStates.map((state, index) => {
    const previous = previousSnapshot.ledStates[index];
    if (!previous) {
      return state;
    }
    return isLedStateEqual(previous, state) ? previous : state;
  });

  const configsUnchanged =
    mergedConfigs.length === previousSnapshot.ledConfigs.length &&
    mergedConfigs.every((config, index) => config === previousSnapshot.ledConfigs[index]);
  const statesUnchanged =
    mergedStates.length === previousSnapshot.ledStates.length &&
    mergedStates.every((state, index) => state === previousSnapshot.ledStates[index]);
  const metadataUnchanged =
    nextSnapshot.timestamp === previousSnapshot.timestamp &&
    nextSnapshot.pirState === previousSnapshot.pirState &&
    nextSnapshot.pirOverride === previousSnapshot.pirOverride;

  if (configsUnchanged && statesUnchanged && metadataUnchanged) {
    return previousSnapshot;
  }

  return {
    timestamp: nextSnapshot.timestamp,
    pirState: nextSnapshot.pirState,
    pirOverride: nextSnapshot.pirOverride,
    ledConfigs: configsUnchanged ? previousSnapshot.ledConfigs : mergedConfigs,
    ledStates: statesUnchanged ? previousSnapshot.ledStates : mergedStates,
  };
}

function diffLedConfig(nextConfig: LedConfig, baselineConfig: LedConfig): LedConfigUpdate {
  const delta: LedConfigUpdate = {};
  for (const field of CONFIG_FIELDS) {
    if (nextConfig[field] !== baselineConfig[field]) {
      delta[field] = nextConfig[field];
    }
  }
  return delta;
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Unknown device error';
}

function filterRecordByKey<T>(record: Record<string, T>, shouldKeep: (key: string) => boolean): Record<string, T> {
  const next: Record<string, T> = {};
  for (const [key, value] of Object.entries(record)) {
    if (shouldKeep(key)) {
      next[key] = value;
    }
  }
  return next;
}

export function useLiveLedTransport({
  devices,
  endpoints,
  autoRefreshEnabled,
  pollIntervalMs,
}: UseLiveLedTransportInput) {
  const [snapshotsByDeviceUri, setSnapshotsByDeviceUri] = useState<Record<string, DeviceSnapshot>>({});
  const [draftByEndpointId, setDraftByEndpointId] = useState<Record<string, LedConfig>>({});
  const [dirtyByEndpointId, setDirtyByEndpointId] = useState<Record<string, boolean>>({});
  const [pendingByEndpointId, setPendingByEndpointId] = useState<Record<string, boolean>>({});
  const [deviceHealthByUri, setDeviceHealthByUri] = useState<Record<string, DeviceLiveHealth>>({});
  const [persistingByDeviceUri, setPersistingByDeviceUri] = useState<Record<string, boolean>>({});
  const [pollingSuppressedByDeviceUri, setPollingSuppressedByDeviceUri] = useState<Record<string, boolean>>({});

  const snapshotsByDeviceRef = useRef<Record<string, DeviceSnapshot>>({});
  const endpointByIdRef = useRef<Map<string, LedEndpoint>>(new Map());
  const draftByEndpointRef = useRef<Record<string, LedConfig>>({});
  const dirtyByEndpointRef = useRef<Record<string, boolean>>({});
  const pollInFlightByDeviceRef = useRef<Record<string, boolean>>({});
  const pendingByDeviceRef = useRef<Record<string, Map<number, PendingLedUpdate>>>({});
  const flushTimerByDeviceRef = useRef<Record<string, ReturnType<typeof setTimeout> | null>>({});
  const isFlushingByDeviceRef = useRef<Record<string, boolean>>({});
  const persistingByDeviceRef = useRef<Record<string, boolean>>({});
  const revisionByEndpointRef = useRef<Record<string, number>>({});
  const pollingSuppressedByDeviceRef = useRef<Record<string, boolean>>({});
  const pollFailuresByDeviceRef = useRef<Record<string, number>>({});

  useEffect(() => {
    endpointByIdRef.current = new Map(endpoints.map((endpoint) => [endpoint.id, endpoint]));
  }, [endpoints]);

  useEffect(() => {
    draftByEndpointRef.current = draftByEndpointId;
  }, [draftByEndpointId]);

  useEffect(() => {
    dirtyByEndpointRef.current = dirtyByEndpointId;
  }, [dirtyByEndpointId]);

  const setEndpointDirty = useCallback((endpointId: string, dirty: boolean) => {
    const previousValue = dirtyByEndpointRef.current[endpointId] ?? false;
    if (previousValue === dirty) {
      return;
    }

    const next = { ...dirtyByEndpointRef.current };
    if (dirty) {
      next[endpointId] = true;
    } else {
      delete next[endpointId];
    }
    dirtyByEndpointRef.current = next;
    setDirtyByEndpointId(next);
  }, []);

  const setEndpointPending = useCallback((endpointId: string, pending: boolean) => {
    setPendingByEndpointId((previous) => {
      const previousValue = previous[endpointId] ?? false;
      if (previousValue === pending) {
        return previous;
      }

      const next = { ...previous };
      if (pending) {
        next[endpointId] = true;
      } else {
        delete next[endpointId];
      }
      return next;
    });
  }, []);

  const setDevicePersisting = useCallback((deviceUri: string, persisting: boolean) => {
    const previous = persistingByDeviceRef.current;
    const previousValue = previous[deviceUri] ?? false;
    if (previousValue === persisting) {
      return;
    }

    const next = { ...previous };
    if (persisting) {
      next[deviceUri] = true;
    } else {
      delete next[deviceUri];
    }
    persistingByDeviceRef.current = next;
    setPersistingByDeviceUri(next);
  }, []);

  const setDevicePollingSuppressed = useCallback((deviceUri: string, suppressed: boolean) => {
    const previous = pollingSuppressedByDeviceRef.current[deviceUri] ?? false;
    if (previous === suppressed) {
      return;
    }

    const next = { ...pollingSuppressedByDeviceRef.current };
    if (suppressed) {
      next[deviceUri] = true;
    } else {
      delete next[deviceUri];
    }
    pollingSuppressedByDeviceRef.current = next;
    setPollingSuppressedByDeviceUri(next);
  }, []);

  const updateDeviceQueueDepth = useCallback((deviceUri: string) => {
    const queueDepth = pendingByDeviceRef.current[deviceUri]?.size ?? 0;
    setDeviceHealthByUri((previous) => {
      const existing = previous[deviceUri];
      if (!existing || existing.queueDepth === queueDepth) {
        return previous;
      }
      return {
        ...previous,
        [deviceUri]: {
          ...existing,
          queueDepth,
        },
      };
    });
  }, []);

  const refreshDevice = useCallback(
    async (device: ResolvedDevice, options: RefreshOptions = {}) => {
      const deviceUri = toDeviceUri(device);
      if (options.fromAutoPoll && pollingSuppressedByDeviceRef.current[deviceUri]) {
        return;
      }
      if (pollInFlightByDeviceRef.current[deviceUri]) {
        return;
      }

      pollInFlightByDeviceRef.current[deviceUri] = true;
      if (!options.silent) {
        setDeviceHealthByUri((previous) => {
          const existing = previous[deviceUri];
          if (!existing) {
            return previous;
          }
          return {
            ...previous,
            [deviceUri]: {
              ...existing,
              tone: 'working',
              inFlight: true,
            },
          };
        });
      }

      try {
        const snapshot = await fetchDeviceSnapshot(deviceUri);
        let effectiveSnapshot = snapshot;
        setSnapshotsByDeviceUri((previous) => {
          const mergedSnapshot = mergeSnapshot(previous[deviceUri], snapshot);
          effectiveSnapshot = mergedSnapshot;
          if (mergedSnapshot === previous[deviceUri]) {
            return previous;
          }
          const next = { ...previous, [deviceUri]: mergedSnapshot };
          snapshotsByDeviceRef.current = next;
          return next;
        });
        setDraftByEndpointId((previous) => {
          const next = { ...previous };
          for (const endpoint of endpoints) {
            if (endpoint.deviceUri !== deviceUri) {
              continue;
            }
            const baseline = effectiveSnapshot.ledConfigs[endpoint.ledIndex];
            if (!baseline) {
              continue;
            }
            if (!dirtyByEndpointRef.current[endpoint.id] || !next[endpoint.id]) {
              next[endpoint.id] = baseline;
            }
          }
          draftByEndpointRef.current = next;
          return next;
        });

        setDeviceHealthByUri((previous) => {
          const existing = previous[deviceUri];
          if (!existing) {
            return previous;
          }
          const withoutLastError = { ...existing };
          delete withoutLastError.lastError;

          return {
            ...previous,
            [deviceUri]: {
              ...withoutLastError,
              tone: 'ok',
              inFlight: false,
              lastSuccessAt: Date.now(),
            },
          };
        });
        pollFailuresByDeviceRef.current[deviceUri] = 0;
        setDevicePollingSuppressed(deviceUri, false);
      } catch (error) {
        const failureCount = (pollFailuresByDeviceRef.current[deviceUri] ?? 0) + 1;
        pollFailuresByDeviceRef.current[deviceUri] = failureCount;
        const isOffline = failureCount >= OFFLINE_POLL_FAILURE_THRESHOLD;
        if (isOffline) {
          setDevicePollingSuppressed(deviceUri, true);
        }

        setDeviceHealthByUri((previous) => {
          const existing = previous[deviceUri];
          if (!existing) {
            return previous;
          }
          return {
            ...previous,
            [deviceUri]: {
              ...existing,
              tone: isOffline ? 'offline' : 'error',
              inFlight: false,
              lastError: toErrorMessage(error),
            },
          };
        });
      } finally {
        pollInFlightByDeviceRef.current[deviceUri] = false;
      }
    },
    [endpoints, setDevicePollingSuppressed]
  );

  const flushDeviceQueue = useCallback(
    async (deviceUri: string) => {
      if (isFlushingByDeviceRef.current[deviceUri]) {
        return;
      }

      const queue = pendingByDeviceRef.current[deviceUri];
      if (!queue || queue.size === 0) {
        return;
      }

      isFlushingByDeviceRef.current[deviceUri] = true;
      setDeviceHealthByUri((previous) => {
        const existing = previous[deviceUri];
        if (!existing) {
          return previous;
        }
        return {
          ...previous,
          [deviceUri]: {
            ...existing,
            tone: 'working',
            inFlight: true,
          },
        };
      });

      try {
        while ((pendingByDeviceRef.current[deviceUri]?.size ?? 0) > 0) {
          const queueForDevice = pendingByDeviceRef.current[deviceUri];
          if (!queueForDevice) {
            break;
          }
          const updates = Array.from(queueForDevice.values());
          queueForDevice.clear();
          updateDeviceQueueDepth(deviceUri);

          for (const update of updates) {
            setEndpointPending(update.endpointId, true);
            try {
              await setLedConfig(deviceUri, update.ledIndex, update.update);
              const hasNewerUpdate = Boolean(pendingByDeviceRef.current[deviceUri]?.get(update.ledIndex));
              if (
                revisionByEndpointRef.current[update.endpointId] === update.revision &&
                !hasNewerUpdate
              ) {
                setEndpointDirty(update.endpointId, false);
              }
            } catch (error) {
              setDeviceHealthByUri((previous) => {
                const existing = previous[deviceUri];
                if (!existing) {
                  return previous;
                }
                const isOffline = pollingSuppressedByDeviceRef.current[deviceUri] ?? false;
                return {
                  ...previous,
                  [deviceUri]: {
                    ...existing,
                    tone: isOffline ? 'offline' : 'error',
                    lastError: `LED ${update.ledIndex}: ${toErrorMessage(error)}`,
                  },
                };
              });
            } finally {
              setEndpointPending(update.endpointId, false);
            }
          }
        }

        const device = devices.find((candidate) => toDeviceUri(candidate) === deviceUri);
        if (device) {
          await refreshDevice(device, { silent: true });
        }
      } finally {
        isFlushingByDeviceRef.current[deviceUri] = false;
        setDeviceHealthByUri((previous) => {
          const existing = previous[deviceUri];
          if (!existing) {
            return previous;
          }
          const isOffline = pollingSuppressedByDeviceRef.current[deviceUri] ?? false;
          return {
            ...previous,
            [deviceUri]: {
              ...existing,
              inFlight: false,
              tone: isOffline ? 'offline' : existing.tone === 'error' ? 'error' : 'ok',
            },
          };
        });

        if ((pendingByDeviceRef.current[deviceUri]?.size ?? 0) > 0) {
          if (flushTimerByDeviceRef.current[deviceUri]) {
            window.clearTimeout(flushTimerByDeviceRef.current[deviceUri]);
          }
          flushTimerByDeviceRef.current[deviceUri] = window.setTimeout(() => {
            flushTimerByDeviceRef.current[deviceUri] = null;
            void flushDeviceQueue(deviceUri);
          }, UPDATE_DEBOUNCE_MS);
        }
      }
    },
    [devices, refreshDevice, setEndpointDirty, setEndpointPending, updateDeviceQueueDepth]
  );

  const scheduleDeviceFlush = useCallback(
    (deviceUri: string, immediate = false) => {
      if (immediate) {
        if (flushTimerByDeviceRef.current[deviceUri]) {
          window.clearTimeout(flushTimerByDeviceRef.current[deviceUri]);
          flushTimerByDeviceRef.current[deviceUri] = null;
        }
        void flushDeviceQueue(deviceUri);
        return;
      }

      if (flushTimerByDeviceRef.current[deviceUri]) {
        return;
      }
      flushTimerByDeviceRef.current[deviceUri] = window.setTimeout(() => {
        flushTimerByDeviceRef.current[deviceUri] = null;
        void flushDeviceQueue(deviceUri);
      }, UPDATE_DEBOUNCE_MS);
    },
    [flushDeviceQueue]
  );

  const persistDevice = useCallback(
    async (device: ResolvedDevice) => {
      const deviceUri = toDeviceUri(device);
      if (persistingByDeviceRef.current[deviceUri]) {
        return;
      }

      setDevicePersisting(deviceUri, true);
      setDeviceHealthByUri((previous) => {
        const existing = previous[deviceUri];
        if (!existing) {
          return previous;
        }
        return {
          ...previous,
          [deviceUri]: {
            ...existing,
            tone: 'working',
            inFlight: true,
          },
        };
      });

      try {
        if ((pendingByDeviceRef.current[deviceUri]?.size ?? 0) > 0) {
          await flushDeviceQueue(deviceUri);
        }
        await saveDeviceConfig(deviceUri, Date.now());
        setDeviceHealthByUri((previous) => {
          const existing = previous[deviceUri];
          if (!existing) {
            return previous;
          }
          const withoutLastError = { ...existing };
          delete withoutLastError.lastError;
          return {
            ...previous,
            [deviceUri]: {
              ...withoutLastError,
              tone: 'ok',
              inFlight: false,
              lastSuccessAt: Date.now(),
            },
          };
        });
      } catch (error) {
        setDeviceHealthByUri((previous) => {
          const existing = previous[deviceUri];
          if (!existing) {
            return previous;
          }
          const isOffline = pollingSuppressedByDeviceRef.current[deviceUri] ?? false;
          return {
            ...previous,
            [deviceUri]: {
              ...existing,
              tone: isOffline ? 'offline' : 'error',
              inFlight: false,
              lastError: `Save failed: ${toErrorMessage(error)}`,
            },
          };
        });
      } finally {
        setDevicePersisting(deviceUri, false);
      }
    },
    [flushDeviceQueue, setDevicePersisting]
  );

  const queueEndpointConfig = useCallback(
    (endpointId: string, nextConfig: LedConfig, immediate = false) => {
      const endpoint = endpointByIdRef.current.get(endpointId);
      if (!endpoint) {
        return;
      }

      const baseline = snapshotsByDeviceRef.current[endpoint.deviceUri]?.ledConfigs[endpoint.ledIndex];
      if (!baseline) {
        return;
      }

      const diff = diffLedConfig(nextConfig, baseline);
      const deviceUri = endpoint.deviceUri;
      const queue = pendingByDeviceRef.current[deviceUri] ?? new Map<number, PendingLedUpdate>();
      pendingByDeviceRef.current[deviceUri] = queue;

      if (Object.keys(diff).length === 0) {
        queue.delete(endpoint.ledIndex);
        setEndpointDirty(endpointId, false);
        updateDeviceQueueDepth(deviceUri);
        return;
      }

      const nextRevision = (revisionByEndpointRef.current[endpointId] ?? 0) + 1;
      revisionByEndpointRef.current[endpointId] = nextRevision;

      setEndpointDirty(endpointId, true);
      queue.set(endpoint.ledIndex, {
        endpointId,
        ledIndex: endpoint.ledIndex,
        update: diff,
        revision: nextRevision,
      });
      updateDeviceQueueDepth(deviceUri);
      scheduleDeviceFlush(deviceUri, immediate);
    },
    [scheduleDeviceFlush, setEndpointDirty, updateDeviceQueueDepth]
  );

  const updateEndpointDraft = useCallback(
    (endpointId: string, patch: LedConfigUpdate) => {
      const endpoint = endpointByIdRef.current.get(endpointId);
      if (!endpoint) {
        return;
      }

      const baseline = snapshotsByDeviceRef.current[endpoint.deviceUri]?.ledConfigs[endpoint.ledIndex];
      if (!baseline) {
        return;
      }

      const currentDraft = draftByEndpointRef.current[endpointId] ?? baseline;
      const nextDraft = mergeLedConfig(currentDraft, patch);
      setEndpointDirty(endpointId, true);
      setDraftByEndpointId((previous) => {
        const next = { ...previous, [endpointId]: nextDraft };
        draftByEndpointRef.current = next;
        return next;
      });
      queueEndpointConfig(endpointId, nextDraft);
    },
    [queueEndpointConfig, setEndpointDirty]
  );

  const applyEndpoint = useCallback(
    (endpointId: string) => {
      const draft = draftByEndpointRef.current[endpointId];
      if (!draft) {
        return;
      }
      queueEndpointConfig(endpointId, draft, true);
    },
    [queueEndpointConfig]
  );

  const resetEndpoint = useCallback(
    (endpointId: string) => {
      const endpoint = endpointByIdRef.current.get(endpointId);
      if (!endpoint) {
        return;
      }

      const baseline = snapshotsByDeviceRef.current[endpoint.deviceUri]?.ledConfigs[endpoint.ledIndex];
      if (!baseline) {
        return;
      }

      const queue = pendingByDeviceRef.current[endpoint.deviceUri];
      queue?.delete(endpoint.ledIndex);
      updateDeviceQueueDepth(endpoint.deviceUri);
      setEndpointDirty(endpointId, false);
      setEndpointPending(endpointId, false);
      setDraftByEndpointId((previous) => {
        const next = { ...previous, [endpointId]: baseline };
        draftByEndpointRef.current = next;
        return next;
      });
    },
    [setEndpointDirty, setEndpointPending, updateDeviceQueueDepth]
  );

  const refreshAllDevices = useCallback(
    async (options: RefreshOptions = {}) => {
      await Promise.all(devices.map((device) => refreshDevice(device, options)));
    },
    [devices, refreshDevice]
  );

  const retryDevice = useCallback(
    async (device: ResolvedDevice) => {
      const deviceUri = toDeviceUri(device);
      pollFailuresByDeviceRef.current[deviceUri] = 0;
      setDevicePollingSuppressed(deviceUri, false);
      await refreshDevice(device);
    },
    [refreshDevice, setDevicePollingSuppressed]
  );

  useEffect(() => {
    const activeDeviceUris = new Set(devices.map((device) => toDeviceUri(device)));
    const activeEndpointIds = new Set(endpoints.map((endpoint) => endpoint.id));

    setDeviceHealthByUri((previous) => {
      const next: Record<string, DeviceLiveHealth> = {};
      for (const device of devices) {
        const uri = toDeviceUri(device);
        const existing = previous[uri];
        next[uri] = existing ?? {
          deviceName: device.name,
          deviceUri: uri,
          tone: 'idle',
          queueDepth: 0,
          inFlight: false,
        };
      }
      return next;
    });

    setSnapshotsByDeviceUri((previous) => {
      const next = filterRecordByKey(previous, (deviceUri) => activeDeviceUris.has(deviceUri));
      snapshotsByDeviceRef.current = next;
      return next;
    });

    setDraftByEndpointId((previous) => {
      const next = filterRecordByKey(previous, (endpointId) => activeEndpointIds.has(endpointId));
      draftByEndpointRef.current = next;
      return next;
    });

    setDirtyByEndpointId((previous) => {
      const next = filterRecordByKey(previous, (endpointId) => activeEndpointIds.has(endpointId));
      dirtyByEndpointRef.current = next;
      return next;
    });

    setPendingByEndpointId((previous) => filterRecordByKey(previous, (endpointId) => activeEndpointIds.has(endpointId)));
    setPersistingByDeviceUri((previous) => {
      const next = filterRecordByKey(previous, (deviceUri) => activeDeviceUris.has(deviceUri));
      persistingByDeviceRef.current = next;
      return next;
    });
    setPollingSuppressedByDeviceUri((previous) => {
      const next = filterRecordByKey(previous, (deviceUri) => activeDeviceUris.has(deviceUri));
      pollingSuppressedByDeviceRef.current = next;
      return next;
    });

    for (const [deviceUri, queue] of Object.entries(pendingByDeviceRef.current)) {
      if (!activeDeviceUris.has(deviceUri)) {
        if (flushTimerByDeviceRef.current[deviceUri]) {
          window.clearTimeout(flushTimerByDeviceRef.current[deviceUri]);
          flushTimerByDeviceRef.current[deviceUri] = null;
        }
        delete pendingByDeviceRef.current[deviceUri];
        delete isFlushingByDeviceRef.current[deviceUri];
        delete pollInFlightByDeviceRef.current[deviceUri];
        delete pollFailuresByDeviceRef.current[deviceUri];
        delete pollingSuppressedByDeviceRef.current[deviceUri];
      } else {
        for (const [ledIndex, pendingUpdate] of queue.entries()) {
          const endpoint = endpointByIdRef.current.get(pendingUpdate.endpointId);
          if (!endpoint || endpoint.ledIndex !== ledIndex || endpoint.deviceUri !== deviceUri) {
            queue.delete(ledIndex);
          }
        }
      }
    }
  }, [devices, endpoints]);

  useEffect(() => {
    void refreshAllDevices();
  }, [devices, refreshAllDevices]);

  const pollingDevices = useMemo(
    () => devices.filter((device) => !pollingSuppressedByDeviceUri[toDeviceUri(device)]),
    [devices, pollingSuppressedByDeviceUri]
  );

  const pollDevice = useCallback(
    async (device: ResolvedDevice) => {
      await refreshDevice(device, { silent: true, fromAutoPoll: true });
    },
    [refreshDevice]
  );

  useStaggeredDevicePolling({
    devices: pollingDevices,
    enabled: autoRefreshEnabled,
    intervalMs: pollIntervalMs,
    staggerMs: Math.min(250, Math.max(50, Math.floor(pollIntervalMs / 4))),
    onPollDevice: pollDevice,
  });

  useEffect(
    () => () => {
      for (const timer of Object.values(flushTimerByDeviceRef.current)) {
        if (timer) {
          window.clearTimeout(timer);
        }
      }
    },
    []
  );

  return {
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
  };
}
