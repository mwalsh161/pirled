import { useEffect } from 'react';
import { type ResolvedDevice } from '../types';

interface UseStaggeredDevicePollingInput {
  devices: ResolvedDevice[];
  enabled: boolean;
  intervalMs: number;
  staggerMs?: number;
  onPollDevice: (device: ResolvedDevice) => Promise<void>;
}

export function useStaggeredDevicePolling({
  devices,
  enabled,
  intervalMs,
  staggerMs = 120,
  onPollDevice,
}: UseStaggeredDevicePollingInput) {
  useEffect(() => {
    if (!enabled || devices.length === 0) {
      return;
    }

    let disposed = false;
    const timers = new Set<ReturnType<typeof setTimeout>>();

    const scheduleDevicePoll = (device: ResolvedDevice, initialDelayMs: number) => {
      const tick = async () => {
        if (disposed) {
          return;
        }
        await onPollDevice(device);
        if (disposed) {
          return;
        }
        const timer = window.setTimeout(() => {
          timers.delete(timer);
          void tick();
        }, intervalMs);
        timers.add(timer);
      };

      const timer = window.setTimeout(() => {
        timers.delete(timer);
        void tick();
      }, initialDelayMs);
      timers.add(timer);
    };

    devices.forEach((device, index) => {
      scheduleDevicePoll(device, index * staggerMs);
    });

    return () => {
      disposed = true;
      for (const timer of timers) {
        window.clearTimeout(timer);
      }
      timers.clear();
    };
  }, [devices, enabled, intervalMs, onPollDevice, staggerMs]);
}
