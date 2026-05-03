import { useEffect, useMemo, useRef, useState } from 'react';
import { getFirmwareVersion } from '../api';
import { toDeviceUri } from '../logical/types';
import { type ResolvedDevice } from '../types';

function filterRecordByKey<T>(record: Record<string, T>, shouldKeep: (key: string) => boolean): Record<string, T> {
  const next: Record<string, T> = {};
  for (const [key, value] of Object.entries(record)) {
    if (shouldKeep(key)) {
      next[key] = value;
    }
  }
  return next;
}

export function useDeviceFirmwareVersions(devices: ResolvedDevice[]): Record<string, string> {
  const [versionByDeviceUri, setVersionByDeviceUri] = useState<Record<string, string>>({});
  const requestedDeviceUrisRef = useRef<Set<string>>(new Set());
  const devicesKey = useMemo(
    () =>
      devices
        .map((device) => toDeviceUri(device))
        .sort()
        .join('|'),
    [devices]
  );

  useEffect(() => {
    let cancelled = false;
    const activeDeviceUris = new Set(devicesKey.length > 0 ? devicesKey.split('|') : []);

    setVersionByDeviceUri((previous) => filterRecordByKey(previous, (deviceUri) => activeDeviceUris.has(deviceUri)));

    for (const requestedDeviceUri of Array.from(requestedDeviceUrisRef.current)) {
      if (!activeDeviceUris.has(requestedDeviceUri)) {
        requestedDeviceUrisRef.current.delete(requestedDeviceUri);
      }
    }

    for (const deviceUri of activeDeviceUris) {
      if (requestedDeviceUrisRef.current.has(deviceUri)) {
        continue;
      }
      requestedDeviceUrisRef.current.add(deviceUri);
      void getFirmwareVersion(deviceUri)
        .then((version) => {
          if (!cancelled) {
            setVersionByDeviceUri((previous) => ({ ...previous, [deviceUri]: version }));
          }
        })
        .catch(() => {
          requestedDeviceUrisRef.current.delete(deviceUri);
        });
    }

    return () => {
      cancelled = true;
    };
  }, [devicesKey]);

  return versionByDeviceUri;
}
