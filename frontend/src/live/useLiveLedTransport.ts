import { useCallback, useEffect, useRef, useState } from 'react';
import { saveDeviceConfig, setLedConfig } from '../api';
import { toDeviceUri, type LedEndpoint } from '../logical/types';
import { type LedConfig, type LedConfigUpdate, type ResolvedDevice } from '../types';
import { useDeviceSnapshotPolling } from './useDeviceSnapshotPolling';

const UPDATE_DEBOUNCE_MS = 120;

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

interface UseLiveLedTransportInput {
  devices: ResolvedDevice[];
  endpoints: LedEndpoint[];
  autoRefreshEnabled: boolean;
  pollIntervalMs: number;
  activePollingDeviceUris?: string[];
}

function mergeLedConfig(config: LedConfig, patch: LedConfigUpdate): LedConfig {
  return { ...config, ...patch };
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
  activePollingDeviceUris,
}: UseLiveLedTransportInput) {
  const {
    snapshotsByDeviceUri,
    deviceHealthByUri,
    setDeviceHealthByUri,
    pollingSuppressedByDeviceUri,
    refreshDevice,
    refreshAllDevices,
    retryDevice,
  } = useDeviceSnapshotPolling({
    devices,
    autoRefreshEnabled,
    pollIntervalMs,
    ...(activePollingDeviceUris ? { activePollingDeviceUris } : {}),
  });

  const [draftByEndpointId, setDraftByEndpointId] = useState<Record<string, LedConfig>>({});
  const [dirtyByEndpointId, setDirtyByEndpointId] = useState<Record<string, boolean>>({});
  const [pendingByEndpointId, setPendingByEndpointId] = useState<Record<string, boolean>>({});
  const [persistingByDeviceUri, setPersistingByDeviceUri] = useState<Record<string, boolean>>({});

  const snapshotsByDeviceRef = useRef(snapshotsByDeviceUri);
  const endpointByIdRef = useRef<Map<string, LedEndpoint>>(new Map());
  const draftByEndpointRef = useRef<Record<string, LedConfig>>({});
  const dirtyByEndpointRef = useRef<Record<string, boolean>>({});
  const pendingByDeviceRef = useRef<Record<string, Map<number, PendingLedUpdate>>>({});
  const flushTimerByDeviceRef = useRef<Record<string, ReturnType<typeof setTimeout> | null>>({});
  const isFlushingByDeviceRef = useRef<Record<string, boolean>>({});
  const persistingByDeviceRef = useRef<Record<string, boolean>>({});
  const revisionByEndpointRef = useRef<Record<string, number>>({});
  const pollingSuppressedByDeviceRef = useRef<Record<string, boolean>>({});

  useEffect(() => {
    endpointByIdRef.current = new Map(endpoints.map((endpoint) => [endpoint.id, endpoint]));
  }, [endpoints]);

  useEffect(() => {
    draftByEndpointRef.current = draftByEndpointId;
  }, [draftByEndpointId]);

  useEffect(() => {
    dirtyByEndpointRef.current = dirtyByEndpointId;
  }, [dirtyByEndpointId]);

  useEffect(() => {
    pollingSuppressedByDeviceRef.current = pollingSuppressedByDeviceUri;
  }, [pollingSuppressedByDeviceUri]);

  useEffect(() => {
    snapshotsByDeviceRef.current = snapshotsByDeviceUri;
    setDraftByEndpointId((previous) => {
      let changed = false;
      const next = { ...previous };
      for (const endpoint of endpoints) {
        const baseline = snapshotsByDeviceUri[endpoint.deviceUri]?.ledConfigs[endpoint.ledIndex];
        if (!baseline) {
          continue;
        }
        if (!dirtyByEndpointRef.current[endpoint.id] || !next[endpoint.id]) {
          if (next[endpoint.id] !== baseline) {
            next[endpoint.id] = baseline;
            changed = true;
          }
        }
      }
      if (!changed) {
        return previous;
      }
      draftByEndpointRef.current = next;
      return next;
    });
  }, [endpoints, snapshotsByDeviceUri]);

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

  const updateDeviceQueueDepth = useCallback(
    (deviceUri: string) => {
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
    },
    [setDeviceHealthByUri]
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
              if (revisionByEndpointRef.current[update.endpointId] === update.revision && !hasNewerUpdate) {
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
    [devices, refreshDevice, setDeviceHealthByUri, setEndpointDirty, setEndpointPending, updateDeviceQueueDepth]
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
    [flushDeviceQueue, setDeviceHealthByUri, setDevicePersisting]
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

  useEffect(() => {
    const activeDeviceUris = new Set(devices.map((device) => toDeviceUri(device)));
    const activeEndpointIds = new Set(endpoints.map((endpoint) => endpoint.id));

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

    for (const [deviceUri, queue] of Object.entries(pendingByDeviceRef.current)) {
      if (!activeDeviceUris.has(deviceUri)) {
        if (flushTimerByDeviceRef.current[deviceUri]) {
          window.clearTimeout(flushTimerByDeviceRef.current[deviceUri]);
          flushTimerByDeviceRef.current[deviceUri] = null;
        }
        delete pendingByDeviceRef.current[deviceUri];
        delete isFlushingByDeviceRef.current[deviceUri];
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
