import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  applyMoodConfig,
  createMoodSchedule as createMoodScheduleRequest,
  createLogicalGroup,
  deleteMoodSchedule as deleteMoodScheduleRequest,
  deleteLogicalGroup,
  deleteMoodConfig,
  discoverDevices as discoverMdnsDevices,
  fetchDeviceSnapshot,
  getDeviceLabelMetadata,
  getDevices,
  getLogicalGroups,
  getMoodApplyStatus,
  getMoodConfig,
  getMoodConfigs,
  getMoodSchedules,
  resolveDevices,
  saveDeviceLabelMetadata,
  saveMoodConfig,
  updateMoodSchedule as updateMoodScheduleRequest,
} from '../api';
import {
  LED_COUNT,
  PHYSICAL_PIR_COUNT,
  type DeviceLabelMetadata,
  type DeviceSnapshot,
  type KnownDevice,
  type LedConfig,
  type LedConfigUpdate,
  type ResolvedDevice,
  isLedConfig,
} from '../types';
import {
  endpointId,
  type ApplyReport,
  type LedEndpoint,
  type LogicalGroup,
  type MoodApplyStatus,
  type MoodDetail,
  type MoodSchedule,
  type MoodScheduleCreateInput,
  type MoodScheduleUpdateInput,
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

interface RefreshDevicesOptions {
  discover?: boolean;
}

interface RefreshMoodSchedulesOptions {
  suppressStatus?: boolean;
}

interface RefreshMoodApplyStatusOptions {
  suppressStatus?: boolean;
}

interface UseLogicalWorkspaceOptions {
  moodPollingEnabled?: boolean;
}

const DEFAULT_PIR_ASSIGNMENT = [0, 1, 2, 3] as const;

function normalizeLabel(label: string): string {
  return label.trim();
}

function normalizeAlias(alias: string): string {
  return alias.trim();
}

function parseAssignmentsByLabel(payload: PersistedMoodPayload): Record<string, LedConfig> {
  return Object.entries(payload.assignments).reduce<Record<string, LedConfig>>((accumulator, [label, config]) => {
    if (isLedConfig(config)) {
      accumulator[label] = config;
    }
    return accumulator;
  }, {});
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

function buildEndpoints(
  devices: KnownDevice[],
  resolvedDevicesByName: Record<string, ResolvedDevice>,
  labelsByEndpoint: Record<string, string>
): LedEndpoint[] {
  return devices.flatMap((device) => {
    const resolvedDevice = resolvedDevicesByName[device.name];
    const deviceUri = resolvedDevice ? toDeviceUri(resolvedDevice) : '';
    const trimmedAlias = device.alias.trim();
    const deviceDisplayName = trimmedAlias.length > 0 ? trimmedAlias : device.name;
    return Array.from({ length: LED_COUNT }, (_, ledIndex) => {
      const id = endpointId(device.name, ledIndex);
      return {
        id,
        deviceName: device.name,
        deviceDisplayName,
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

function sortMoodSchedules(schedules: MoodSchedule[]): MoodSchedule[] {
  return [...schedules].sort((left, right) => {
    if (left.nextRunAt !== right.nextRunAt) {
      return left.nextRunAt - right.nextRunAt;
    }
    return left.id.localeCompare(right.id);
  });
}

export function useLogicalWorkspace({ moodPollingEnabled = false }: UseLogicalWorkspaceOptions = {}) {
  const [devices, setDevices] = useState<KnownDevice[]>([]);
  const [resolvedDevicesByName, setResolvedDevicesByName] = useState<Record<string, ResolvedDevice>>({});
  const [aliasesByDevice, setAliasesByDevice] = useState<Record<string, string>>({});
  const [persistedAliasesByDevice, setPersistedAliasesByDevice] = useState<Record<string, string>>({});
  const [labelsByEndpoint, setLabelsByEndpoint] = useState<Record<string, string>>({});
  const [persistedLabelsByEndpoint, setPersistedLabelsByEndpoint] = useState<Record<string, string>>({});
  const [pirAssignmentsByDevice, setPirAssignmentsByDevice] = useState<Record<string, number[]>>({});
  const [persistedPirAssignmentsByDevice, setPersistedPirAssignmentsByDevice] = useState<Record<string, number[]>>({});
  const [groups, setGroups] = useState<LogicalGroup[]>([]);
  const [moods, setMoods] = useState<MoodSummary[]>([]);
  const [moodDetails, setMoodDetails] = useState<Record<string, MoodDetail>>({});
  const [dirtyMoodDetailsByName, setDirtyMoodDetailsByName] = useState<Record<string, boolean>>({});
  const [moodSchedules, setMoodSchedules] = useState<MoodSchedule[]>([]);
  const [moodApplyStatus, setMoodApplyStatus] = useState<MoodApplyStatus>({ lastApply: null });
  const [hasLoadedMoods, setHasLoadedMoods] = useState(false);
  const [hasLoadedMoodSchedules, setHasLoadedMoodSchedules] = useState(false);
  const [hasLoadedMoodApplyStatus, setHasLoadedMoodApplyStatus] = useState(false);
  const [status, setStatus] = useState<WorkspaceStatus>({ tone: 'idle', message: 'Ready.' });
  const [isBootstrapping, setIsBootstrapping] = useState(true);
  const activeStatusTokenRef = useRef(0);
  const deviceRequestTokenRef = useRef(0);
  const moodRequestTokenRef = useRef(0);
  const groupRequestTokenRef = useRef(0);
  const scheduleRequestTokenRef = useRef(0);
  const applyStatusRequestTokenRef = useRef(0);
  const deviceAbortControllerRef = useRef<AbortController | null>(null);
  const moodDataLoadInFlightRef = useRef<Promise<boolean> | null>(null);

  const endpoints = buildEndpoints(devices, resolvedDevicesByName, labelsByEndpoint);
  const resolvedDevices = useMemo<ResolvedDevice[]>(() => {
    const next: ResolvedDevice[] = [];
    for (const device of devices) {
      const resolved = resolvedDevicesByName[device.name];
      if (resolved) {
        next.push(resolved);
      }
    }
    return next;
  }, [devices, resolvedDevicesByName]);
  const labels = buildLabels(endpoints);
  const dirtyLabelDevices = useMemo<Record<string, boolean>>(() => {
    const dirty: Record<string, boolean> = {};
    for (const device of devices) {
      let labelsDirty = false;
      for (let ledIndex = 0; ledIndex < LED_COUNT; ledIndex += 1) {
        const id = endpointId(device.name, ledIndex);
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
      const currentAlias = normalizeAlias(aliasesByDevice[device.name] ?? '');
      const persistedAlias = normalizeAlias(persistedAliasesByDevice[device.name] ?? '');
      const aliasDirty = currentAlias !== persistedAlias;

      if (labelsDirty || pirDirty || aliasDirty) {
        dirty[device.name] = true;
      }
    }
    return dirty;
  }, [aliasesByDevice, devices, labelsByEndpoint, persistedAliasesByDevice, persistedLabelsByEndpoint, pirAssignmentsByDevice, persistedPirAssignmentsByDevice]);
  const dirtyLabelDeviceCount = Object.keys(dirtyLabelDevices).length;
  const hasUnsavedLabelChanges = dirtyLabelDeviceCount > 0;
  const hasLoadedMoodData = hasLoadedMoods && hasLoadedMoodSchedules && hasLoadedMoodApplyStatus;

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

  const refreshDevices = useCallback(async (options: RefreshDevicesOptions = {}) => {
    const requestToken = deviceRequestTokenRef.current + 1;
    deviceRequestTokenRef.current = requestToken;
    deviceAbortControllerRef.current?.abort();

    const controller = new AbortController();
    deviceAbortControllerRef.current = controller;
    const statusToken = startStatus(
      options.discover ? 'Discovering new devices and loading labels...' : 'Loading known devices and labels...'
    );

    try {
      if (options.discover) {
        await discoverMdnsDevices(controller.signal);
      }

      const knownDevices = await getDevices(controller.signal);
      const sorted = [...knownDevices].sort((left, right) => left.name.localeCompare(right.name));
      const nextLabels: Record<string, string> = {};
      const nextPirAssignments: Record<string, number[]> = {};
      const nextAliases: Record<string, string> = {};

      await Promise.all(
        sorted.map(async (device) => {
          let metadata: DeviceLabelMetadata = {
            ledNames: [],
            ledByPir: [],
            alias: device.alias,
          };

          try {
            metadata = await getDeviceLabelMetadata(device.name);
          } catch {
            metadata = { ledNames: [], ledByPir: [], alias: device.alias };
          }

          nextAliases[device.name] = metadata.alias;

          for (let ledIndex = 0; ledIndex < LED_COUNT; ledIndex += 1) {
            const id = endpointId(device.name, ledIndex);
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
      setResolvedDevicesByName({});
      setAliasesByDevice(nextAliases);
      setPersistedAliasesByDevice(nextAliases);
      setLabelsByEndpoint(nextLabels);
      setPersistedLabelsByEndpoint(nextLabels);
      setPirAssignmentsByDevice(nextPirAssignments);
      setPersistedPirAssignmentsByDevice(nextPirAssignments);
      settleStatus(statusToken, { tone: 'success', message: `Loaded ${sorted.length} known devices.` });

      void (async () => {
        try {
          const resolvedDevices = await resolveDevices(controller.signal);
          if (controller.signal.aborted || deviceRequestTokenRef.current !== requestToken) {
            return;
          }
          const resolvedByName = new Map(
            resolvedDevices.map((device) => [device.name, device] as const)
          );
          setResolvedDevicesByName(() => {
            const next: Record<string, ResolvedDevice> = {};
            for (const device of sorted) {
              const resolved = resolvedByName.get(device.name);
              if (resolved) {
                next[device.name] = resolved;
              }
            }
            return next;
          });
          setDevices((previous) =>
            previous.map((device) => ({
              ...device,
              resolved: resolvedByName.has(device.name),
            }))
          );
        } catch {
          // Keep working with known devices even if address resolution fails.
        }
      })();
    } catch (error) {
      if (controller.signal.aborted || deviceRequestTokenRef.current !== requestToken) {
        return;
      }

      const message = error instanceof Error ? error.message : 'Unknown device load error';
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
        return false;
      }

      setMoods(list.map(toMoodSummary).sort((left, right) => (right.timestamp ?? 0) - (left.timestamp ?? 0)));
      setHasLoadedMoods(true);
      if (statusToken !== null) {
        settleStatus(statusToken, { tone: 'success', message: `Loaded ${list.length} moods.` });
      }
      return true;
    } catch (error) {
      if (moodRequestTokenRef.current !== requestToken) {
        return false;
      }

      const message = error instanceof Error ? error.message : 'Unknown mood error';
      if (statusToken !== null) {
        settleStatus(statusToken, { tone: 'error', message: `Failed to load moods: ${message}` });
      }
      return false;
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

  const refreshMoodSchedules = useCallback(async (options: RefreshMoodSchedulesOptions = {}) => {
    const requestToken = scheduleRequestTokenRef.current + 1;
    scheduleRequestTokenRef.current = requestToken;
    const statusToken = options.suppressStatus ? null : startStatus('Refreshing mood schedules...');

    try {
      const schedules = await getMoodSchedules();
      if (scheduleRequestTokenRef.current !== requestToken) {
        return false;
      }

      setMoodSchedules(sortMoodSchedules(schedules));
      setHasLoadedMoodSchedules(true);
      if (statusToken !== null) {
        settleStatus(statusToken, { tone: 'success', message: `Loaded ${schedules.length} schedules.` });
      }
      return true;
    } catch (error) {
      if (scheduleRequestTokenRef.current !== requestToken) {
        return false;
      }

      const message = error instanceof Error ? error.message : 'Unknown schedules error';
      if (statusToken !== null) {
        settleStatus(statusToken, { tone: 'error', message: `Failed to load schedules: ${message}` });
      }
      return false;
    }
  }, [settleStatus, startStatus]);

  const refreshMoodApplyStatus = useCallback(async (options: RefreshMoodApplyStatusOptions = {}) => {
    const requestToken = applyStatusRequestTokenRef.current + 1;
    applyStatusRequestTokenRef.current = requestToken;
    const statusToken = options.suppressStatus ? null : startStatus('Refreshing mood apply status...');

    try {
      const nextStatus = await getMoodApplyStatus();
      if (applyStatusRequestTokenRef.current !== requestToken) {
        return false;
      }

      setMoodApplyStatus(nextStatus);
      setHasLoadedMoodApplyStatus(true);
      if (statusToken !== null) {
        settleStatus(statusToken, { tone: 'success', message: 'Loaded mood apply status.' });
      }
      return true;
    } catch (error) {
      if (applyStatusRequestTokenRef.current !== requestToken) {
        return false;
      }

      const message = error instanceof Error ? error.message : 'Unknown mood apply status error';
      if (statusToken !== null) {
        settleStatus(statusToken, { tone: 'error', message: `Failed to load mood apply status: ${message}` });
      }
      return false;
    }
  }, [settleStatus, startStatus]);

  const discoverDevices = useCallback(async () => {
    await refreshDevices({ discover: true });
  }, [refreshDevices]);

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
      setDirtyMoodDetailsByName((previous) => {
        if (!previous[name]) {
          return previous;
        }
        const next = { ...previous };
        delete next[name];
        return next;
      });
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

  function updateAlias(deviceName: string, alias: string): void {
    setAliasesByDevice((previous) => ({
      ...previous,
      [deviceName]: alias,
    }));
    setDevices((previous) =>
      previous.map((device) =>
        device.name === deviceName
          ? {
              ...device,
              alias,
            }
          : device
      )
    );
    setResolvedDevicesByName((previous) => {
      const current = previous[deviceName];
      if (!current) {
        return previous;
      }
      return {
        ...previous,
        [deviceName]: {
          ...current,
          alias,
        },
      };
    });
  }

  async function saveLabelsForDevice(deviceName: string): Promise<boolean> {
    const device = devices.find((entry) => entry.name === deviceName);
    if (!device) {
      return false;
    }

    const ledNames = Array.from({ length: LED_COUNT }, (_, ledIndex) => {
      return normalizeLabel(labelsByEndpoint[endpointId(device.name, ledIndex)] ?? '');
    });
    const normalizedAssignment = normalizePirAssignment(pirAssignmentsByDevice[deviceName]);
    const normalizedAlias = normalizeAlias(aliasesByDevice[deviceName] ?? '');

    const statusToken = startStatus(`Saving labels for ${deviceName}...`);

    try {
      await saveDeviceLabelMetadata(deviceName, {
        ledNames,
        ledByPir: normalizedAssignment,
        alias: normalizedAlias,
      });
      setPersistedLabelsByEndpoint((previous) => {
        const next = { ...previous };
        for (let ledIndex = 0; ledIndex < LED_COUNT; ledIndex += 1) {
          const id = endpointId(device.name, ledIndex);
          next[id] = labelsByEndpoint[id] ?? '';
        }
        return next;
      });
      setPersistedPirAssignmentsByDevice((previous) => ({
        ...previous,
        [deviceName]: normalizedAssignment,
      }));
      setPersistedAliasesByDevice((previous) => ({
        ...previous,
        [deviceName]: normalizedAlias,
      }));
      settleStatus(statusToken, { tone: 'success', message: `Saved labels for ${deviceName}.` });
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown save error';
      settleStatus(statusToken, {
        tone: 'error',
        message: `Failed to save labels for ${deviceName}: ${message}`,
      });
      return false;
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

  async function createMoodSchedule(input: MoodScheduleCreateInput): Promise<void> {
    const statusToken = startStatus(`Creating schedule for "${input.moodName}"...`);
    try {
      const created = await createMoodScheduleRequest(input);
      setMoodSchedules((previous) => sortMoodSchedules([...previous, created]));
      settleStatus(statusToken, { tone: 'success', message: `Created schedule for "${created.moodName}".` });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown schedule create error';
      settleStatus(statusToken, { tone: 'error', message: `Failed to create schedule: ${message}` });
      throw error;
    }
  }

  async function updateMoodSchedule(scheduleId: string, patch: MoodScheduleUpdateInput): Promise<void> {
    const statusToken = startStatus(`Updating schedule "${scheduleId}"...`);
    try {
      const updated = await updateMoodScheduleRequest(scheduleId, patch);
      setMoodSchedules((previous) =>
        sortMoodSchedules(previous.map((schedule) => (schedule.id === updated.id ? updated : schedule)))
      );
      settleStatus(statusToken, { tone: 'success', message: `Updated schedule "${scheduleId}".` });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown schedule update error';
      settleStatus(statusToken, { tone: 'error', message: `Failed to update schedule: ${message}` });
      throw error;
    }
  }

  async function deleteMoodSchedule(scheduleId: string): Promise<void> {
    const statusToken = startStatus(`Deleting schedule "${scheduleId}"...`);
    try {
      await deleteMoodScheduleRequest(scheduleId);
      setMoodSchedules((previous) => previous.filter((schedule) => schedule.id !== scheduleId));
      settleStatus(statusToken, { tone: 'success', message: `Deleted schedule "${scheduleId}".` });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown schedule delete error';
      settleStatus(statusToken, { tone: 'error', message: `Failed to delete schedule: ${message}` });
      throw error;
    }
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
    const resolvedDeviceNameSet = new Set(Object.keys(resolvedDevicesByName));
    const resolvedScopedEndpoints = scopedEndpoints.filter((endpoint) => resolvedDeviceNameSet.has(endpoint.deviceName));

    if (scopedEndpoints.length === 0) {
      setStatusImmediate({ tone: 'error', message: 'No labeled endpoints in the selected capture scope.' });
      return;
    }
    if (resolvedScopedEndpoints.length === 0) {
      setStatusImmediate({ tone: 'error', message: 'No resolved devices available in the selected capture scope.' });
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
        Array.from(new Set(resolvedScopedEndpoints.map((endpoint) => endpoint.deviceUri))).map(async (deviceUri) => {
          const snapshot = await fetchDeviceSnapshot(deviceUri);
          return [deviceUri, snapshot] as const;
        })
      );
      const snapshotsByDeviceUri: Record<string, DeviceSnapshot> = Object.fromEntries(snapshotEntries);
      const assignmentsByLabel: Record<string, LedConfig> = {};
      const timestamp = Math.floor(Date.now() / 1000);

      for (const endpoint of resolvedScopedEndpoints) {
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
      setDirtyMoodDetailsByName((previous) => {
        if (!previous[trimmedName]) {
          return previous;
        }
        const next = { ...previous };
        delete next[trimmedName];
        return next;
      });
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

  function updateMoodAssignment(moodName: string, label: string, patch: LedConfigUpdate): void {
    const normalizedLabel = normalizeLabel(label);
    if (!normalizedLabel) {
      return;
    }

    const detail = moodDetails[moodName];
    if (!detail) {
      return;
    }
    const existingConfig = detail.assignmentsByLabel[normalizedLabel];
    if (!existingConfig) {
      return;
    }

    const nextConfig = mergeLedConfig(existingConfig, patch);
    if (isLedConfigEqual(existingConfig, nextConfig)) {
      return;
    }

    setMoodDetails((previous) => ({
      ...previous,
      [moodName]: {
        ...(previous[moodName] ?? detail),
        assignmentsByLabel: {
          ...((previous[moodName] ?? detail).assignmentsByLabel ?? {}),
          [normalizedLabel]: nextConfig,
        },
      },
    }));
    setDirtyMoodDetailsByName((previous) => ({
      ...previous,
      [moodName]: true,
    }));
  }

  function cloneMoodAssignment(moodName: string, sourceLabel: string, nextLabelRaw: string): void {
    const normalizedSourceLabel = normalizeLabel(sourceLabel);
    const normalizedNextLabel = normalizeLabel(nextLabelRaw);
    if (!normalizedSourceLabel) {
      const message = 'Select a source label to clone.';
      setStatusImmediate({ tone: 'error', message });
      throw new Error(message);
    }
    if (!normalizedNextLabel) {
      const message = 'New label is required.';
      setStatusImmediate({ tone: 'error', message });
      throw new Error(message);
    }

    const detail = moodDetails[moodName];
    if (!detail) {
      const message = `Load mood "${moodName}" detail before adding assignments.`;
      setStatusImmediate({ tone: 'error', message });
      throw new Error(message);
    }

    const sourceConfig = detail.assignmentsByLabel[normalizedSourceLabel];
    if (!sourceConfig) {
      const message = `Source label "${normalizedSourceLabel}" not found in mood "${moodName}".`;
      setStatusImmediate({ tone: 'error', message });
      throw new Error(message);
    }

    if (detail.assignmentsByLabel[normalizedNextLabel]) {
      const message = `Label "${normalizedNextLabel}" already exists in mood "${moodName}".`;
      setStatusImmediate({ tone: 'error', message });
      throw new Error(message);
    }

    setMoodDetails((previous) => ({
      ...previous,
      [moodName]: {
        ...(previous[moodName] ?? detail),
        assignmentsByLabel: {
          ...((previous[moodName] ?? detail).assignmentsByLabel ?? {}),
          [normalizedNextLabel]: { ...sourceConfig },
        },
      },
    }));
    setDirtyMoodDetailsByName((previous) => ({
      ...previous,
      [moodName]: true,
    }));
  }

  function removeMoodAssignment(moodName: string, label: string): void {
    const normalizedLabel = normalizeLabel(label);
    if (!normalizedLabel) {
      return;
    }

    const detail = moodDetails[moodName];
    if (!detail) {
      const message = `Load mood "${moodName}" detail before removing assignments.`;
      setStatusImmediate({ tone: 'error', message });
      throw new Error(message);
    }

    if (!detail.assignmentsByLabel[normalizedLabel]) {
      const message = `Label "${normalizedLabel}" not found in mood "${moodName}".`;
      setStatusImmediate({ tone: 'error', message });
      throw new Error(message);
    }

    if (Object.keys(detail.assignmentsByLabel).length <= 1) {
      const message = `Mood "${moodName}" must keep at least one assignment.`;
      setStatusImmediate({ tone: 'error', message });
      throw new Error(message);
    }

    setMoodDetails((previous) => {
      const existing = previous[moodName] ?? detail;
      const nextAssignments = { ...existing.assignmentsByLabel };
      delete nextAssignments[normalizedLabel];
      return {
        ...previous,
        [moodName]: {
          ...existing,
          assignmentsByLabel: nextAssignments,
        },
      };
    });
    setDirtyMoodDetailsByName((previous) => ({
      ...previous,
      [moodName]: true,
    }));
  }

  async function saveMoodDetail(moodName: string): Promise<void> {
    const detail = moodDetails[moodName];
    if (!detail) {
      const message = `Load mood "${moodName}" detail before saving edits.`;
      setStatusImmediate({ tone: 'error', message });
      throw new Error(message);
    }

    const statusToken = startStatus(`Saving edits for mood "${moodName}"...`);
    const timestamp = Math.floor(Date.now() / 1000);
    const payload: PersistedMoodPayload = {
      name: detail.name,
      description: detail.description,
      timestamp,
      assignments: detail.assignmentsByLabel,
    };

    try {
      await saveMoodConfig(moodName, payload);
      setMoodDetails((previous) => ({
        ...previous,
        [moodName]: {
          ...(previous[moodName] ?? detail),
          timestamp,
        },
      }));
      setDirtyMoodDetailsByName((previous) => {
        if (!previous[moodName]) {
          return previous;
        }
        const next = { ...previous };
        delete next[moodName];
        return next;
      });
      await refreshMoods({ suppressStatus: true });
      settleStatus(statusToken, { tone: 'success', message: `Saved edits for mood "${moodName}".` });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown mood save error';
      settleStatus(statusToken, { tone: 'error', message: `Failed to save mood "${moodName}": ${message}` });
      throw error;
    }
  }

  async function applyMood(moodName: string, groupId: string | null): Promise<ApplyReport> {
    const selectedGroup = groupId ? groups.find((group) => group.id === groupId) : null;

    const statusToken = startStatus(
      `Applying "${moodName}" ${selectedGroup ? `to group "${selectedGroup.name}"` : 'to all labeled endpoints'}...`
    );

    try {
      const result = await applyMoodConfig(moodName, groupId);
      void refreshMoodApplyStatus({ suppressStatus: true });

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
      setDirtyMoodDetailsByName((previous) => {
        if (!previous[name]) {
          return previous;
        }
        const next = { ...previous };
        delete next[name];
        return next;
      });
      settleStatus(statusToken, { tone: 'success', message: `Deleted mood "${name}".` });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown mood delete error';
      settleStatus(statusToken, { tone: 'error', message: `Failed to delete mood "${name}": ${message}` });
    }
  }

  const ensureMoodDataLoaded = useCallback(async (): Promise<boolean> => {
    if (hasLoadedMoodData) {
      return true;
    }
    if (moodDataLoadInFlightRef.current) {
      return moodDataLoadInFlightRef.current;
    }

    const loadPromise = (async () => {
      const statusToken = startStatus('Loading mood studio data...');
      try {
        const [moodsLoaded, schedulesLoaded, applyStatusLoaded] = await Promise.all([
          refreshMoods({ suppressStatus: true }),
          refreshMoodSchedules({ suppressStatus: true }),
          refreshMoodApplyStatus({ suppressStatus: true }),
        ]);
        const loaded = moodsLoaded && schedulesLoaded && applyStatusLoaded;
        settleStatus(
          statusToken,
          loaded
            ? { tone: 'success', message: 'Mood studio data loaded.' }
            : { tone: 'error', message: 'Failed to load some mood studio data. Retry refresh.' }
        );
        return loaded;
      } finally {
        moodDataLoadInFlightRef.current = null;
      }
    })();

    moodDataLoadInFlightRef.current = loadPromise;
    return loadPromise;
  }, [hasLoadedMoodData, refreshMoodApplyStatus, refreshMoodSchedules, refreshMoods, settleStatus, startStatus]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      await refreshDevices();
      if (cancelled) {
        return;
      }
      await refreshGroups();
    })();

    return () => {
      cancelled = true;
    };
  }, [refreshDevices, refreshGroups]);

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

  useEffect(() => {
    if (!moodPollingEnabled || !hasLoadedMoodData) {
      return;
    }
    const intervalId = window.setInterval(() => {
      void refreshMoodSchedules({ suppressStatus: true });
      void refreshMoodApplyStatus({ suppressStatus: true });
    }, 15000);
    return () => {
      window.clearInterval(intervalId);
    };
  }, [hasLoadedMoodData, moodPollingEnabled, refreshMoodApplyStatus, refreshMoodSchedules]);

  return {
    devices,
    resolvedDevices,
    aliasesByDevice,
    endpoints,
    pirAssignmentsByDevice,
    labels,
    groups,
    moods,
    moodDetails,
    dirtyMoodDetailsByName,
    moodSchedules,
    moodApplyStatus,
    hasLoadedMoodData,
    status,
    isBootstrapping,
    dirtyLabelDevices,
    dirtyLabelDeviceCount,
    hasUnsavedLabelChanges,
    refreshDevices,
    discoverDevices,
    refreshMoods,
    refreshGroups,
    refreshMoodSchedules,
    refreshMoodApplyStatus,
    ensureMoodDataLoaded,
    loadMoodDetail,
    updateMoodAssignment,
    cloneMoodAssignment,
    removeMoodAssignment,
    saveMoodDetail,
    updateLabel,
    updateAlias,
    assignDefaultPir,
    saveLabelsForDevice,
    createGroup,
    deleteGroup,
    createMoodSchedule,
    updateMoodSchedule,
    deleteMoodSchedule,
    saveMood,
    applyMood,
    removeMood,
  };
}
