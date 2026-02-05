import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  applyMoodConfig,
  createLogicalGroup,
  deleteLogicalGroup,
  deleteMoodConfig,
  fetchDeviceSnapshot,
  getDeviceLabelMetadata,
  getDevices,
  getLogicalGroups,
  getMoodConfig,
  getMoodConfigs,
  saveDeviceLabelMetadata,
  saveMoodConfig,
} from '../api';
import {
  LED_COUNT,
  PHYSICAL_PIR_COUNT,
  type Device,
  type DeviceLabelMetadata,
  type DeviceSnapshot,
  type LedConfig,
  isLedConfig,
} from '../types';
import {
  endpointId,
  type ApplyReport,
  type LedEndpoint,
  type LogicalGroup,
  type MoodDetail,
  type MoodSummary,
  type PersistedMoodPayload,
  toDeviceUri,
} from './types';

interface WorkspaceStatus {
  tone: 'idle' | 'success' | 'error' | 'working';
  message: string;
}

interface SaveMoodInput {
  name: string;
  description: string;
  captureGroupId: string | null;
}

interface RefreshMoodsOptions {
  suppressStatus?: boolean;
}

interface RefreshGroupsOptions {
  suppressStatus?: boolean;
}

const DEFAULT_PIR_ASSIGNMENT = [0, 1, 2, 3] as const;

function normalizeLabel(label: string): string {
  return label.trim();
}

function parseAssignmentsByLabel(payload: PersistedMoodPayload): Record<string, LedConfig> {
  return Object.entries(payload.assignments).reduce<Record<string, LedConfig>>((accumulator, [label, config]) => {
    if (isLedConfig(config)) {
      accumulator[label] = config;
    }
    return accumulator;
  }, {});
}

function toMoodSummary(config: { name: string; description?: string; timestamp?: number }): MoodSummary {
  const summary: MoodSummary = {
    name: config.name,
    description: config.description ?? '',
  };
  if (config.timestamp !== undefined) {
    summary.timestamp = config.timestamp;
  }
  return summary;
}

function buildEndpoints(devices: Device[], labelsByEndpoint: Record<string, string>): LedEndpoint[] {
  return devices.flatMap((device) => {
    const deviceUri = toDeviceUri(device);
    return Array.from({ length: LED_COUNT }, (_, ledIndex) => {
      const id = endpointId(deviceUri, ledIndex);
      return {
        id,
        deviceName: device.name,
        deviceUri,
        ledIndex,
        label: labelsByEndpoint[id] ?? '',
      };
    });
  });
}

function buildLabels(endpoints: LedEndpoint[]): string[] {
  return Array.from(new Set(endpoints.map((endpoint) => normalizeLabel(endpoint.label)).filter((label) => label.length > 0))).sort(
    (left, right) => left.localeCompare(right)
  );
}

function normalizePirAssignment(assignment: number[] | undefined): number[] {
  const fallback = [...DEFAULT_PIR_ASSIGNMENT];
  if (!assignment) {
    return fallback;
  }
  if (assignment.length !== PHYSICAL_PIR_COUNT) {
    return fallback;
  }

  const seen = new Set<number>();
  const normalized: number[] = [];
  for (let pirIndex = 0; pirIndex < PHYSICAL_PIR_COUNT; pirIndex += 1) {
    const ledIndex = assignment[pirIndex];
    if (ledIndex === undefined) {
      return fallback;
    }
    if (!Number.isInteger(ledIndex) || ledIndex < 0 || ledIndex >= LED_COUNT || seen.has(ledIndex)) {
      return fallback;
    }
    seen.add(ledIndex);
    normalized.push(ledIndex);
  }
  return normalized;
}

function arePirAssignmentsEqual(left: number[], right: number[]): boolean {
  if (left.length !== right.length) {
    return false;
  }
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) {
      return false;
    }
  }
  return true;
}

export function useLogicalWorkspace() {
  const [devices, setDevices] = useState<Device[]>([]);
  const [labelsByEndpoint, setLabelsByEndpoint] = useState<Record<string, string>>({});
  const [persistedLabelsByEndpoint, setPersistedLabelsByEndpoint] = useState<Record<string, string>>({});
  const [pirAssignmentsByDevice, setPirAssignmentsByDevice] = useState<Record<string, number[]>>({});
  const [persistedPirAssignmentsByDevice, setPersistedPirAssignmentsByDevice] = useState<Record<string, number[]>>({});
  const [groups, setGroups] = useState<LogicalGroup[]>([]);
  const [moods, setMoods] = useState<MoodSummary[]>([]);
  const [moodDetails, setMoodDetails] = useState<Record<string, MoodDetail>>({});
  const [status, setStatus] = useState<WorkspaceStatus>({ tone: 'idle', message: 'Ready.' });
  const [isBootstrapping, setIsBootstrapping] = useState(true);
  const activeStatusTokenRef = useRef(0);
  const deviceRequestTokenRef = useRef(0);
  const moodRequestTokenRef = useRef(0);
  const groupRequestTokenRef = useRef(0);
  const deviceAbortControllerRef = useRef<AbortController | null>(null);

  const endpoints = buildEndpoints(devices, labelsByEndpoint);
  const labels = buildLabels(endpoints);
  const dirtyLabelDevices = useMemo<Record<string, boolean>>(() => {
    const dirty: Record<string, boolean> = {};
    for (const device of devices) {
      const deviceUri = toDeviceUri(device);
      let labelsDirty = false;
      for (let ledIndex = 0; ledIndex < LED_COUNT; ledIndex += 1) {
        const id = endpointId(deviceUri, ledIndex);
        const current = normalizeLabel(labelsByEndpoint[id] ?? '');
        const persisted = normalizeLabel(persistedLabelsByEndpoint[id] ?? '');
        if (current !== persisted) {
          labelsDirty = true;
          break;
        }
      }

      const currentPirAssignment = normalizePirAssignment(pirAssignmentsByDevice[device.name]);
      const persistedPirAssignment = normalizePirAssignment(persistedPirAssignmentsByDevice[device.name]);
      const pirDirty = !arePirAssignmentsEqual(currentPirAssignment, persistedPirAssignment);

      if (labelsDirty || pirDirty) {
        dirty[device.name] = true;
      }
    }
    return dirty;
  }, [devices, labelsByEndpoint, persistedLabelsByEndpoint, pirAssignmentsByDevice, persistedPirAssignmentsByDevice]);
  const dirtyLabelDeviceCount = Object.keys(dirtyLabelDevices).length;
  const hasUnsavedLabelChanges = dirtyLabelDeviceCount > 0;

  const setStatusImmediate = useCallback((next: WorkspaceStatus) => {
    activeStatusTokenRef.current += 1;
    setStatus(next);
  }, []);

  const startStatus = useCallback((message: string): number => {
    const nextToken = activeStatusTokenRef.current + 1;
    activeStatusTokenRef.current = nextToken;
    setStatus({ tone: 'working', message });
    return nextToken;
  }, []);

  const settleStatus = useCallback((statusToken: number, next: WorkspaceStatus) => {
    if (activeStatusTokenRef.current === statusToken) {
      setStatus(next);
    }
  }, []);

  const refreshDevices = useCallback(async () => {
    const requestToken = deviceRequestTokenRef.current + 1;
    deviceRequestTokenRef.current = requestToken;
    deviceAbortControllerRef.current?.abort();

    const controller = new AbortController();
    deviceAbortControllerRef.current = controller;
    const statusToken = startStatus('Discovering devices and loading labels...');

    try {
      const discovered = await getDevices(controller.signal);
      const sorted = [...discovered].sort((left, right) => left.name.localeCompare(right.name));
      const nextLabels: Record<string, string> = {};
      const nextPirAssignments: Record<string, number[]> = {};

      await Promise.all(
        sorted.map(async (device) => {
          const deviceUri = toDeviceUri(device);
          let metadata: DeviceLabelMetadata = {
            ledNames: [],
            ledByPir: [],
          };

          try {
            metadata = await getDeviceLabelMetadata(device.name);
          } catch {
            metadata = { ledNames: [], ledByPir: [] };
          }

          for (let ledIndex = 0; ledIndex < LED_COUNT; ledIndex += 1) {
            const id = endpointId(deviceUri, ledIndex);
            const storedLabel = normalizeLabel(metadata.ledNames[ledIndex] ?? '');
            nextLabels[id] = storedLabel;
          }

          const rawAssignment = Array.from(
            { length: PHYSICAL_PIR_COUNT },
            (_, pirIndex) => metadata.ledByPir[pirIndex] ?? pirIndex
          );
          nextPirAssignments[device.name] = normalizePirAssignment(rawAssignment);
        })
      );

      if (controller.signal.aborted || deviceRequestTokenRef.current !== requestToken) {
        return;
      }

      setDevices(sorted);
      setLabelsByEndpoint(nextLabels);
      setPersistedLabelsByEndpoint(nextLabels);
      setPirAssignmentsByDevice(nextPirAssignments);
      setPersistedPirAssignmentsByDevice(nextPirAssignments);
      settleStatus(statusToken, { tone: 'success', message: `Loaded ${sorted.length} devices.` });
    } catch (error) {
      if (controller.signal.aborted || deviceRequestTokenRef.current !== requestToken) {
        return;
      }

      const message = error instanceof Error ? error.message : 'Unknown discovery error';
      settleStatus(statusToken, { tone: 'error', message: `Failed to load devices: ${message}` });
    } finally {
      if (deviceAbortControllerRef.current === controller) {
        deviceAbortControllerRef.current = null;
      }
      if (deviceRequestTokenRef.current === requestToken) {
        setIsBootstrapping(false);
      }
    }
  }, [settleStatus, startStatus]);

  const refreshMoods = useCallback(async (options: RefreshMoodsOptions = {}) => {
    const requestToken = moodRequestTokenRef.current + 1;
    moodRequestTokenRef.current = requestToken;
    const statusToken = options.suppressStatus ? null : startStatus('Refreshing mood catalog...');

    try {
      const list = await getMoodConfigs();
      if (moodRequestTokenRef.current !== requestToken) {
        return;
      }

      setMoods(list.map(toMoodSummary).sort((left, right) => (right.timestamp ?? 0) - (left.timestamp ?? 0)));
      if (statusToken !== null) {
        settleStatus(statusToken, { tone: 'success', message: `Loaded ${list.length} moods.` });
      }
    } catch (error) {
      if (moodRequestTokenRef.current !== requestToken) {
        return;
      }

      const message = error instanceof Error ? error.message : 'Unknown mood error';
      if (statusToken !== null) {
        settleStatus(statusToken, { tone: 'error', message: `Failed to load moods: ${message}` });
      }
    }
  }, [settleStatus, startStatus]);

  const refreshGroups = useCallback(async (options: RefreshGroupsOptions = {}) => {
    const requestToken = groupRequestTokenRef.current + 1;
    groupRequestTokenRef.current = requestToken;
    const statusToken = options.suppressStatus ? null : startStatus('Refreshing groups...');

    try {
      const list = await getLogicalGroups();
      if (groupRequestTokenRef.current !== requestToken) {
        return;
      }

      setGroups(list.sort((left, right) => left.name.localeCompare(right.name)));
      if (statusToken !== null) {
        settleStatus(statusToken, { tone: 'success', message: `Loaded ${list.length} groups.` });
      }
    } catch (error) {
      if (groupRequestTokenRef.current !== requestToken) {
        return;
      }

      const message = error instanceof Error ? error.message : 'Unknown groups error';
      if (statusToken !== null) {
        settleStatus(statusToken, { tone: 'error', message: `Failed to load groups: ${message}` });
      }
    }
  }, [settleStatus, startStatus]);

  async function loadMoodDetail(name: string): Promise<MoodDetail> {
    const cached = moodDetails[name];
    if (cached) {
      return cached;
    }

    try {
      const payload: PersistedMoodPayload = await getMoodConfig(name);
      const detailBase: MoodDetail = {
        name: payload.name,
        description: payload.description ?? '',
        assignmentsByLabel: parseAssignmentsByLabel(payload),
      };
      const detail: MoodDetail = {
        ...detailBase,
        ...(payload.timestamp !== undefined ? { timestamp: payload.timestamp } : {}),
      };

      setMoodDetails((previous) => ({ ...previous, [name]: detail }));
      return detail;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown mood detail error';
      setStatusImmediate({ tone: 'error', message: `Failed to load mood "${name}": ${message}` });
      throw error;
    }
  }

  function updateLabel(endpointIdValue: string, label: string): void {
    setLabelsByEndpoint((previous) => ({
      ...previous,
      [endpointIdValue]: label,
    }));
  }

  async function saveLabelsForDevice(deviceName: string): Promise<void> {
    const device = devices.find((entry) => entry.name === deviceName);
    if (!device) {
      return;
    }

    const deviceUri = toDeviceUri(device);
    const ledNames = Array.from({ length: LED_COUNT }, (_, ledIndex) => {
      return normalizeLabel(labelsByEndpoint[endpointId(deviceUri, ledIndex)] ?? '');
    });
    const normalizedAssignment = normalizePirAssignment(pirAssignmentsByDevice[deviceName]);

    const statusToken = startStatus(`Saving labels for ${deviceName}...`);

    try {
      await saveDeviceLabelMetadata(deviceName, { ledNames, ledByPir: normalizedAssignment });
      setPersistedLabelsByEndpoint((previous) => {
        const next = { ...previous };
        for (let ledIndex = 0; ledIndex < LED_COUNT; ledIndex += 1) {
          const id = endpointId(deviceUri, ledIndex);
          next[id] = labelsByEndpoint[id] ?? '';
        }
        return next;
      });
      setPersistedPirAssignmentsByDevice((previous) => ({
        ...previous,
        [deviceName]: normalizedAssignment,
      }));
      settleStatus(statusToken, { tone: 'success', message: `Saved labels for ${deviceName}.` });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown save error';
      settleStatus(statusToken, {
        tone: 'error',
        message: `Failed to save labels for ${deviceName}: ${message}`,
      });
    }
  }

  function assignDefaultPir(deviceName: string, ledIndex: number, pirIndex: number): void {
    if (ledIndex < 0 || ledIndex >= LED_COUNT || pirIndex < 0 || pirIndex >= PHYSICAL_PIR_COUNT) {
      return;
    }

    setPirAssignmentsByDevice((previous) => {
      const current = normalizePirAssignment(previous[deviceName]);
      const currentlyAssignedLed = current[pirIndex];
      if (currentlyAssignedLed === undefined) {
        return previous;
      }
      if (currentlyAssignedLed === ledIndex) {
        return previous;
      }

      const sourcePirIndex = current.findIndex((assignedLed) => assignedLed === ledIndex);
      if (sourcePirIndex < 0) {
        return previous;
      }

      const nextForDevice = [...current];
      nextForDevice[pirIndex] = ledIndex;
      nextForDevice[sourcePirIndex] = currentlyAssignedLed;

      return {
        ...previous,
        [deviceName]: nextForDevice,
      };
    });
  }

  function createGroup(name: string, selectedLabels: string[]): void {
    const trimmedName = name.trim();
    if (!trimmedName) {
      return;
    }

    const normalizedLabels = Array.from(
      new Set(selectedLabels.map((label) => normalizeLabel(label)).filter((label) => label.length > 0))
    );
    const statusToken = startStatus(`Creating group "${trimmedName}"...`);

    void (async () => {
      try {
        const created = await createLogicalGroup(trimmedName, normalizedLabels);
        setGroups((previous) => [...previous, created].sort((left, right) => left.name.localeCompare(right.name)));
        settleStatus(statusToken, { tone: 'success', message: `Created group "${trimmedName}".` });
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown create group error';
        settleStatus(statusToken, { tone: 'error', message: `Failed to create group "${trimmedName}": ${message}` });
      }
    })();
  }

  function deleteGroup(groupId: string): void {
    const existing = groups.find((group) => group.id === groupId);
    const statusToken = startStatus(`Removing group "${existing?.name ?? groupId}"...`);

    void (async () => {
      try {
        await deleteLogicalGroup(groupId);
        setGroups((previous) => previous.filter((group) => group.id !== groupId));
        settleStatus(statusToken, { tone: 'success', message: 'Removed group.' });
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown delete group error';
        settleStatus(statusToken, { tone: 'error', message: `Failed to remove group: ${message}` });
      }
    })();
  }

  async function saveMood({ name, description, captureGroupId }: SaveMoodInput): Promise<void> {
    const trimmedName = name.trim();
    if (!trimmedName) {
      setStatusImmediate({ tone: 'error', message: 'Mood name is required.' });
      return;
    }

    const selectedGroup = captureGroupId ? groups.find((group) => group.id === captureGroupId) : null;
    if (captureGroupId && !selectedGroup) {
      setStatusImmediate({ tone: 'error', message: 'Selected capture group was not found.' });
      return;
    }

    const allowedLabels = selectedGroup
      ? new Set(
          selectedGroup.labels
            .map((label) => normalizeLabel(label))
            .filter((label) => label.length > 0)
        )
      : null;

    const scopedEndpoints = endpoints.filter((endpoint) => {
      const label = normalizeLabel(endpoint.label);
      if (!label) {
        return false;
      }
      if (allowedLabels && !allowedLabels.has(label)) {
        return false;
      }
      return true;
    });

    if (scopedEndpoints.length === 0) {
      setStatusImmediate({ tone: 'error', message: 'No labeled endpoints in the selected capture scope.' });
      return;
    }

    const seenLabels = new Set<string>();
    const duplicateLabels = new Set<string>();
    for (const endpoint of scopedEndpoints) {
      const label = normalizeLabel(endpoint.label);
      if (seenLabels.has(label)) {
        duplicateLabels.add(label);
      } else {
        seenLabels.add(label);
      }
    }
    if (duplicateLabels.size > 0) {
      const sorted = Array.from(duplicateLabels).sort((left, right) => left.localeCompare(right));
      setStatusImmediate({
        tone: 'error',
        message: `Duplicate labels in capture scope: ${sorted.join(', ')}. Resolve label duplicates before saving a mood.`,
      });
      return;
    }

    const statusToken = startStatus(
      `Capturing mood "${trimmedName}" from ${selectedGroup ? `group "${selectedGroup.name}"` : 'all labeled endpoints'}...`
    );

    try {
      const snapshotEntries = await Promise.all(
        Array.from(new Set(scopedEndpoints.map((endpoint) => endpoint.deviceUri))).map(async (deviceUri) => {
          const snapshot = await fetchDeviceSnapshot(deviceUri);
          return [deviceUri, snapshot] as const;
        })
      );
      const snapshotsByDeviceUri: Record<string, DeviceSnapshot> = Object.fromEntries(snapshotEntries);
      const assignmentsByLabel: Record<string, LedConfig> = {};
      const timestamp = Math.floor(Date.now() / 1000);

      for (const endpoint of scopedEndpoints) {
        const snapshot = snapshotsByDeviceUri[endpoint.deviceUri];
        if (!snapshot) {
          continue;
        }
        const label = normalizeLabel(endpoint.label);
        const capturedConfig = snapshot.ledConfigs[endpoint.ledIndex];
        if (!capturedConfig) {
          continue;
        }
        assignmentsByLabel[label] = capturedConfig;
      }

      if (Object.keys(assignmentsByLabel).length === 0) {
        setStatusImmediate({ tone: 'error', message: 'No labeled LED configs were available to capture.' });
        return;
      }

      const payload: PersistedMoodPayload = {
        name: trimmedName,
        description: description.trim(),
        timestamp,
        assignments: assignmentsByLabel,
      };

      await saveMoodConfig(trimmedName, payload);
      setMoodDetails((previous) => ({
        ...previous,
        [trimmedName]: {
          name: trimmedName,
          description: payload.description ?? '',
          timestamp,
          assignmentsByLabel,
        },
      }));
      await refreshMoods({ suppressStatus: true });
      settleStatus(statusToken, {
        tone: 'success',
        message: `Saved mood "${trimmedName}" with ${Object.keys(assignmentsByLabel).length} labeled assignments.`,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown mood save error';
      settleStatus(statusToken, { tone: 'error', message: `Failed to save mood "${trimmedName}": ${message}` });
    }
  }

  async function applyMood(moodName: string, groupId: string | null): Promise<ApplyReport> {
    const selectedGroup = groupId ? groups.find((group) => group.id === groupId) : null;

    const statusToken = startStatus(
      `Applying "${moodName}" ${selectedGroup ? `to group "${selectedGroup.name}"` : 'to all labeled endpoints'}...`
    );

    try {
      const result = await applyMoodConfig(moodName, groupId);

      if (result.failureCount > 0) {
        settleStatus(statusToken, {
          tone: 'error',
          message: `Applied with ${result.failureCount} failures (${result.successCount} successful writes).`,
        });
      } else {
        settleStatus(statusToken, { tone: 'success', message: `Applied mood to ${result.successCount} endpoints.` });
      }

      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown mood apply error';
      settleStatus(statusToken, { tone: 'error', message: `Failed to apply mood "${moodName}": ${message}` });
      return {
        successCount: 0,
        failureCount: 1,
        failures: [message],
      };
    }
  }

  async function removeMood(name: string): Promise<void> {
    const statusToken = startStatus(`Deleting mood "${name}"...`);
    try {
      await deleteMoodConfig(name);
      setMoods((previous) => previous.filter((entry) => entry.name !== name));
      setMoodDetails((previous) => {
        const copy = { ...previous };
        delete copy[name];
        return copy;
      });
      settleStatus(statusToken, { tone: 'success', message: `Deleted mood "${name}".` });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown mood delete error';
      settleStatus(statusToken, { tone: 'error', message: `Failed to delete mood "${name}": ${message}` });
    }
  }

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      await refreshDevices();
      if (cancelled) {
        return;
      }
      await refreshMoods();
      if (cancelled) {
        return;
      }
      await refreshGroups();
    })();

    return () => {
      cancelled = true;
    };
  }, [refreshDevices, refreshMoods, refreshGroups]);

  useEffect(
    () => () => {
      deviceAbortControllerRef.current?.abort();
    },
    []
  );

  useEffect(() => {
    if (!hasUnsavedLabelChanges) {
      return;
    }

    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
    };
  }, [hasUnsavedLabelChanges]);

  return {
    devices,
    endpoints,
    pirAssignmentsByDevice,
    labels,
    groups,
    moods,
    moodDetails,
    status,
    isBootstrapping,
    dirtyLabelDevices,
    dirtyLabelDeviceCount,
    hasUnsavedLabelChanges,
    refreshDevices,
    refreshMoods,
    refreshGroups,
    loadMoodDetail,
    updateLabel,
    assignDefaultPir,
    saveLabelsForDevice,
    createGroup,
    deleteGroup,
    saveMood,
    applyMood,
    removeMood,
  };
}
