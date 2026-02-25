import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { fetchDeviceSnapshot } from '../api';
import { toDeviceUri } from '../logical/types';
import { type DeviceSnapshot, type LedConfig, type ResolvedDevice } from '../types';
import { useStaggeredDevicePolling } from './useStaggeredDevicePolling';

const OFFLINE_POLL_FAILURE_THRESHOLD = 2;

interface RefreshOptions {
  silent?: boolean;
  fromAutoPoll?: boolean;
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

interface UseDeviceSnapshotPollingInput {
  devices: ResolvedDevice[];
  autoRefreshEnabled: boolean;
  pollIntervalMs: number;
  activePollingDeviceUris?: string[];
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

function mergeSnapshot(previousSnapshot: DeviceSnapshot | undefined, nextSnapshot: DeviceSnapshot): DeviceSnapshot {
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

export function useDeviceSnapshotPolling({
  devices,
  autoRefreshEnabled,
  pollIntervalMs,
  activePollingDeviceUris,
}: UseDeviceSnapshotPollingInput) {
  const [snapshotsByDeviceUri, setSnapshotsByDeviceUri] = useState<Record<string, DeviceSnapshot>>({});
  const [deviceHealthByUri, setDeviceHealthByUri] = useState<Record<string, DeviceLiveHealth>>({});
  const [pollingSuppressedByDeviceUri, setPollingSuppressedByDeviceUri] = useState<Record<string, boolean>>({});

  const pollInFlightByDeviceRef = useRef<Record<string, boolean>>({});
  const pollingSuppressedByDeviceRef = useRef<Record<string, boolean>>({});
  const pollFailuresByDeviceRef = useRef<Record<string, number>>({});
  const previousVisibleDeviceUrisRef = useRef<Set<string>>(new Set());
  const hasExplicitActivePollingUris = activePollingDeviceUris !== undefined;
  const activePollingDeviceUrisKey = useMemo(() => {
    if (!hasExplicitActivePollingUris) {
      return null;
    }
    if (!activePollingDeviceUris || activePollingDeviceUris.length === 0) {
      return '';
    }
    return [...activePollingDeviceUris].sort().join('|');
  }, [activePollingDeviceUris, hasExplicitActivePollingUris]);
  const activePollingDeviceUriSet = useMemo(() => {
    if (!hasExplicitActivePollingUris || activePollingDeviceUrisKey === null) {
      return null;
    }
    if (activePollingDeviceUrisKey.length === 0) {
      return new Set<string>();
    }
    return new Set(activePollingDeviceUrisKey.split('|'));
  }, [activePollingDeviceUrisKey, hasExplicitActivePollingUris]);

  const visibleDeviceUriSet = useMemo(() => {
    if (activePollingDeviceUriSet) {
      return activePollingDeviceUriSet;
    }
    return new Set(devices.map((device) => toDeviceUri(device)));
  }, [activePollingDeviceUriSet, devices]);

  const visibleDevices = useMemo(
    () => devices.filter((device) => visibleDeviceUriSet.has(toDeviceUri(device))),
    [devices, visibleDeviceUriSet]
  );

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
        setSnapshotsByDeviceUri((previous) => {
          const mergedSnapshot = mergeSnapshot(previous[deviceUri], snapshot);
          if (mergedSnapshot === previous[deviceUri]) {
            return previous;
          }
          return { ...previous, [deviceUri]: mergedSnapshot };
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
    [setDevicePollingSuppressed]
  );

  const refreshAllDevices = useCallback(
    async (options: RefreshOptions = {}) => {
      await Promise.all(visibleDevices.map((device) => refreshDevice(device, options)));
    },
    [refreshDevice, visibleDevices]
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

    setDeviceHealthByUri((previous) => {
      const next: Record<string, DeviceLiveHealth> = {};
      for (const device of devices) {
        const uri = toDeviceUri(device);
        const existing = previous[uri];
        next[uri] =
          existing ?? {
            deviceName: device.name,
            deviceUri: uri,
            tone: 'idle',
            queueDepth: 0,
            inFlight: false,
          };
      }
      return next;
    });

    setSnapshotsByDeviceUri((previous) => filterRecordByKey(previous, (deviceUri) => activeDeviceUris.has(deviceUri)));
    setPollingSuppressedByDeviceUri((previous) => {
      const next = filterRecordByKey(previous, (deviceUri) => activeDeviceUris.has(deviceUri));
      pollingSuppressedByDeviceRef.current = next;
      return next;
    });

    for (const deviceUri of Object.keys(pollInFlightByDeviceRef.current)) {
      if (!activeDeviceUris.has(deviceUri)) {
        delete pollInFlightByDeviceRef.current[deviceUri];
        delete pollFailuresByDeviceRef.current[deviceUri];
        delete pollingSuppressedByDeviceRef.current[deviceUri];
      }
    }
  }, [devices]);

  useEffect(() => {
    const previousVisibleDeviceUris = previousVisibleDeviceUrisRef.current;
    const newlyVisibleDevices = visibleDevices.filter((device) => !previousVisibleDeviceUris.has(toDeviceUri(device)));
    if (newlyVisibleDevices.length > 0) {
      void Promise.all(newlyVisibleDevices.map((device) => refreshDevice(device, { silent: true })));
    }
    previousVisibleDeviceUrisRef.current = new Set(visibleDevices.map((device) => toDeviceUri(device)));
  }, [refreshDevice, visibleDevices]);

  const pollingDevices = useMemo(
    () => visibleDevices.filter((device) => !pollingSuppressedByDeviceUri[toDeviceUri(device)]),
    [pollingSuppressedByDeviceUri, visibleDevices]
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

  return {
    snapshotsByDeviceUri,
    deviceHealthByUri,
    setDeviceHealthByUri,
    pollingSuppressedByDeviceUri,
    refreshDevice,
    refreshAllDevices,
    retryDevice,
  };
}
