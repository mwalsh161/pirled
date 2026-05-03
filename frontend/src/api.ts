import { BufferDeviceState, buildFieldMap } from './BufferDeviceState';
import {
  type ApplyReport,
  type LogicalGroup,
  type MoodApplyStatus,
  type MoodSchedule,
  type MoodScheduleCreateInput,
  type MoodScheduleUpdateInput,
} from './logical/types';
import {
  LED_COUNT,
  type KnownDevice,
  PHYSICAL_PIR_COUNT,
  REMOTE_PIR_SLOT_COUNT,
  type PirEventDestinationConfig,
  type PirEventDestinationConfigUpdate,
  type RemotePirConfig,
  type RemotePirConfigUpdate,
  type RemoteSharingConfig,
  type DeviceCacheState,
  type DeviceLabelMetadata,
  type DeviceResolveFailure,
  type DeviceSnapshot,
  type LedConfig,
  type LedConfigUpdate,
  type MoodConfig,
  type MoodConfigSummary,
  type ResolvedDevice,
  isLedConfig,
} from './types';

const API_BASE = 'api';  // Note, reverse-proxy issue so make relative to SPA.
const fieldMapCache = new Map<string, ReturnType<typeof buildFieldMap>>();
const fieldMapInFlight = new Map<string, Promise<ReturnType<typeof buildFieldMap>>>();

interface SchemaField {
  name: string;
  size?: number;
  type?: string;
  arrayLen?: number;
  sub?: SchemaField[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isString(value: unknown): value is string {
  return typeof value === 'string';
}

function isNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isBoolean(value: unknown): value is boolean {
  return typeof value === 'boolean';
}

function isKnownDevice(value: unknown): value is KnownDevice {
  if (!isRecord(value) || !isString(value.name)) {
    return false;
  }
  return (
    isString(value.alias) &&
    isBoolean(value.fromConfig) &&
    isBoolean(value.discovered) &&
    isBoolean(value.resolved)
  );
}

function isResolvedDevice(value: unknown): value is ResolvedDevice {
  return (
    isRecord(value) &&
    isString(value.name) &&
    isString(value.alias) &&
    isString(value.host) &&
    Number.isInteger(value.port)
  );
}

function isDeviceResolveFailure(value: unknown): value is DeviceResolveFailure {
  return isRecord(value) && isString(value.name) && isString(value.error);
}

function isSchemaField(value: unknown): value is SchemaField {
  if (!isRecord(value) || !isString(value.name)) {
    return false;
  }

  const hasSize = value.size !== undefined;
  const hasType = value.type !== undefined;
  const hasSub = value.sub !== undefined;
  const hasSizeAndType = isNumber(value.size) && isString(value.type);
  const hasNoSizeOrType = !hasSize && !hasType;

  if (value.arrayLen !== undefined && !isNumber(value.arrayLen)) {
    return false;
  }
  if (!hasNoSizeOrType && !hasSizeAndType) {
    return false;
  }

  if (!hasSub) {
    return hasSizeAndType;
  }

  if (!Array.isArray(value.sub)) {
    return false;
  }
  for (const subField of value.sub) {
    if (!isSchemaField(subField)) {
      return false;
    }
  }
  return true;
}

function parseMoodConfigSummaries(payload: unknown): MoodConfigSummary[] {
  if (!Array.isArray(payload)) {
    return [];
  }

  const summaries: MoodConfigSummary[] = [];
  for (const item of payload) {
    if (!isRecord(item) || !isString(item.name)) {
      continue;
    }
    const summary: MoodConfigSummary = { name: item.name };
    if (isString(item.description)) {
      summary.description = item.description;
    }
    if (isNumber(item.timestamp)) {
      summary.timestamp = item.timestamp;
    }
    summaries.push(summary);
  }
  return summaries;
}

function parseLedConfigMap(value: unknown): Record<string, LedConfig> | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const parsed: Record<string, LedConfig> = {};
  for (const [label, config] of Object.entries(value)) {
    if (isLedConfig(config)) {
      parsed[label] = config;
    }
  }
  return parsed;
}

function parseMoodConfig(payload: unknown): MoodConfig {
  if (!isRecord(payload) || !isString(payload.name)) {
    throw new Error('Invalid mood config payload');
  }

  const parsed: MoodConfig = { name: payload.name, assignments: {} };
  if (isString(payload.description)) {
    parsed.description = payload.description;
  }
  if (isNumber(payload.timestamp)) {
    parsed.timestamp = payload.timestamp;
  }

  const assignments = parseLedConfigMap(payload.assignments);
  if (assignments === undefined) {
    throw new Error('Mood config is missing assignments');
  }
  parsed.assignments = assignments;

  return parsed;
}

function parseDeviceLabelMetadata(payload: unknown): DeviceLabelMetadata {
  if (!isRecord(payload) || !Array.isArray(payload.ledNames) || !Array.isArray(payload.ledByPir) || !isString(payload.alias)) {
    throw new Error('Invalid device label metadata');
  }
  if (payload.ledNames.length !== LED_COUNT || payload.ledByPir.length !== PHYSICAL_PIR_COUNT) {
    throw new Error('Invalid metadata lengths');
  }

  const ledNames: string[] = [];
  for (const value of payload.ledNames) {
    if (!isString(value)) {
      throw new Error('Invalid ledNames entry');
    }
    ledNames.push(value);
  }

  const ledByPir: number[] = [];
  const usedLedIndices = new Set<number>();
  for (const value of payload.ledByPir) {
    if (!isNumber(value) || !Number.isInteger(value)) {
      throw new Error('Invalid ledByPir entry');
    }
    if (value < 0 || value >= LED_COUNT) {
      throw new Error('ledByPir out of range');
    }
    if (usedLedIndices.has(value)) {
      throw new Error('Duplicate ledByPir mapping');
    }
    usedLedIndices.add(value);
    ledByPir.push(value);
  }

  return { ledNames, ledByPir, alias: payload.alias };
}

function parsePirEventDestinationConfig(value: unknown): PirEventDestinationConfig | null {
  if (!isRecord(value) || !isString(value.host) || !isBoolean(value.enabled)) {
    return null;
  }
  return {
    host: value.host,
    enabled: value.enabled,
  };
}

function parseRemotePirConfig(value: unknown): RemotePirConfig | null {
  if (
    !isRecord(value) ||
    !isString(value.sourceHost) ||
    !isNumber(value.sourcePirIndex) ||
    !isNumber(value.leaseMs) ||
    !isBoolean(value.enabled)
  ) {
    return null;
  }
  return {
    sourceHost: value.sourceHost,
    sourcePirIndex: Math.trunc(value.sourcePirIndex),
    leaseMs: Math.trunc(value.leaseMs),
    enabled: value.enabled,
  };
}

function parseRemoteSharingConfig(payload: unknown): RemoteSharingConfig {
  if (!isRecord(payload) || !Array.isArray(payload.eventDestinations) || !Array.isArray(payload.remotePirs)) {
    throw new Error('Invalid remote sharing payload');
  }

  const eventDestinations: PirEventDestinationConfig[] = [];
  for (const value of payload.eventDestinations) {
    const parsed = parsePirEventDestinationConfig(value);
    if (!parsed) {
      throw new Error('Invalid PIR event destination payload');
    }
    eventDestinations.push(parsed);
  }

  const remotePirs: RemotePirConfig[] = [];
  for (const value of payload.remotePirs) {
    const parsed = parseRemotePirConfig(value);
    if (!parsed) {
      throw new Error('Invalid remote PIR payload');
    }
    remotePirs.push(parsed);
  }

  if (remotePirs.length !== REMOTE_PIR_SLOT_COUNT) {
    throw new Error('Invalid remote PIR slot count');
  }

  return { eventDestinations, remotePirs };
}

function parseSchema(payload: unknown): SchemaField[] {
  if (!Array.isArray(payload) || !payload.every(isSchemaField)) {
    throw new Error('Invalid device schema payload');
  }
  return payload;
}

function parseLogicalGroup(payload: unknown): LogicalGroup | null {
  if (!isRecord(payload) || !isString(payload.id) || !isString(payload.name)) {
    return null;
  }

  const labels =
    Array.isArray(payload.labels) && payload.labels.every((label) => isString(label))
      ? payload.labels
      : [];

  return {
    id: payload.id,
    name: payload.name,
    labels,
  };
}

function parseLogicalGroups(payload: unknown): LogicalGroup[] {
  if (!Array.isArray(payload)) {
    return [];
  }

  return payload
    .map((entry) => parseLogicalGroup(entry))
    .filter((group): group is LogicalGroup => group !== null);
}

function parseApplyReport(payload: unknown): ApplyReport {
  if (!isRecord(payload)) {
    return { successCount: 0, failureCount: 1, failures: ['Invalid apply response'] };
  }

  const successCount = isNumber(payload.successCount) ? payload.successCount : 0;
  const failureCount = isNumber(payload.failureCount) ? payload.failureCount : 0;
  const failures =
    Array.isArray(payload.failures) && payload.failures.every((failure) => isString(failure))
      ? payload.failures
      : [];

  return { successCount, failureCount, failures };
}

function parseMoodSchedule(payload: unknown): MoodSchedule | null {
  if (!isRecord(payload)) {
    return null;
  }
  if (!isString(payload.id) || !isString(payload.moodName)) {
    return null;
  }
  if (!isNumber(payload.intervalSeconds) || !isNumber(payload.nextRunAt) || !isBoolean(payload.enabled)) {
    return null;
  }
  if (!isNumber(payload.createdAt) || !isNumber(payload.updatedAt)) {
    return null;
  }
  if (payload.groupId !== null && payload.groupId !== undefined && !isString(payload.groupId)) {
    return null;
  }

  const lastRunAt =
    payload.lastRunAt === null || payload.lastRunAt === undefined
      ? null
      : isNumber(payload.lastRunAt)
        ? payload.lastRunAt
        : null;
  const lastResult =
    payload.lastResult === null || payload.lastResult === undefined
      ? null
      : parseApplyReport(payload.lastResult);

  return {
    id: payload.id,
    moodName: payload.moodName,
    groupId: payload.groupId ?? null,
    intervalSeconds: payload.intervalSeconds,
    nextRunAt: payload.nextRunAt,
    enabled: payload.enabled,
    createdAt: payload.createdAt,
    updatedAt: payload.updatedAt,
    lastRunAt,
    lastResult,
  };
}

function parseMoodSchedules(payload: unknown): MoodSchedule[] {
  if (!Array.isArray(payload)) {
    throw new Error('Invalid mood schedules payload');
  }
  return payload
    .map((item) => parseMoodSchedule(item))
    .filter((item): item is MoodSchedule => item !== null)
    .sort((left, right) => left.nextRunAt - right.nextRunAt);
}

function parseMoodApplyStatus(payload: unknown): MoodApplyStatus {
  if (!isRecord(payload)) {
    return { lastApply: null };
  }
  const lastApplyRaw = payload.lastApply;
  if (lastApplyRaw === null || lastApplyRaw === undefined) {
    return { lastApply: null };
  }
  if (!isRecord(lastApplyRaw)) {
    return { lastApply: null };
  }
  if (!isNumber(lastApplyRaw.appliedAt) || !isString(lastApplyRaw.source) || !isString(lastApplyRaw.moodName)) {
    return { lastApply: null };
  }
  if (lastApplyRaw.source !== 'manual' && lastApplyRaw.source !== 'scheduled') {
    return { lastApply: null };
  }
  const groupId =
    lastApplyRaw.groupId === null || lastApplyRaw.groupId === undefined
      ? null
      : isString(lastApplyRaw.groupId)
        ? lastApplyRaw.groupId
        : null;
  const scheduleId =
    lastApplyRaw.scheduleId === null || lastApplyRaw.scheduleId === undefined
      ? null
      : isString(lastApplyRaw.scheduleId)
        ? lastApplyRaw.scheduleId
        : null;
  const report = parseApplyReport(lastApplyRaw);
  return {
    lastApply: {
      appliedAt: lastApplyRaw.appliedAt,
      source: lastApplyRaw.source,
      moodName: lastApplyRaw.moodName,
      groupId,
      scheduleId,
      successCount: report.successCount,
      failureCount: report.failureCount,
      failures: report.failures,
    },
  };
}

async function throwResponseError(response: Response, fallbackMessage: string): Promise<never> {
  let message = fallbackMessage;
  try {
    const payload: unknown = await response.json();
    if (isRecord(payload)) {
      if (isString(payload.error) && payload.error.trim().length > 0) {
        message = payload.error;
      } else if (isString(payload.detail) && payload.detail.trim().length > 0) {
        message = payload.detail;
      } else if (Array.isArray(payload.detail) && payload.detail.length > 0) {
        const first = payload.detail[0];
        if (isRecord(first) && isString(first.msg)) {
          message = first.msg;
        }
      }
    }
  } catch {
    // Ignore JSON parse errors and keep fallback.
  }
  throw new Error(message);
}

function parseKnownDevices(payload: unknown): KnownDevice[] {
  if (!Array.isArray(payload)) {
    throw new Error('Invalid devices payload');
  }
  const devices: KnownDevice[] = [];
  for (let index = 0; index < payload.length; index += 1) {
    const candidate = payload[index];
    if (!isKnownDevice(candidate)) {
      throw new Error(`Invalid known device payload at index ${index}`);
    }
    devices.push({
      name: candidate.name,
      alias: candidate.alias,
      fromConfig: candidate.fromConfig,
      discovered: candidate.discovered,
      resolved: candidate.resolved,
    });
  }
  return devices;
}

function parseResolvedDevices(payload: unknown): ResolvedDevice[] {
  if (!Array.isArray(payload)) {
    throw new Error('Invalid resolved devices payload');
  }
  const devices: ResolvedDevice[] = [];
  for (let index = 0; index < payload.length; index += 1) {
    const candidate = payload[index];
    if (!isResolvedDevice(candidate)) {
      throw new Error(`Invalid resolved device payload at index ${index}`);
    }
    devices.push(candidate);
  }
  return devices;
}

function parseDeviceResolveFailures(payload: unknown): DeviceResolveFailure[] {
  if (!Array.isArray(payload)) {
    throw new Error('Invalid resolve failures payload');
  }
  const failures: DeviceResolveFailure[] = [];
  for (let index = 0; index < payload.length; index += 1) {
    const candidate = payload[index];
    if (!isDeviceResolveFailure(candidate)) {
      throw new Error(`Invalid resolve failure payload at index ${index}`);
    }
    failures.push(candidate);
  }
  return failures;
}

function parseDeviceCacheState(payload: unknown): DeviceCacheState {
  if (!isRecord(payload)) {
    throw new Error('Invalid device cache payload');
  }
  const refreshedAt = payload.refreshedAt;
  if (refreshedAt !== null && refreshedAt !== undefined && (!isNumber(refreshedAt) || !Number.isInteger(refreshedAt))) {
    throw new Error('Invalid device cache timestamp');
  }
  return {
    known: parseKnownDevices(payload.known),
    resolved: parseResolvedDevices(payload.resolved),
    failed: parseDeviceResolveFailures(payload.failed),
    refreshedAt: refreshedAt ?? null,
  };
}

export async function getDeviceCache(controller: AbortSignal): Promise<DeviceCacheState> {
  const response = await fetch(`${API_BASE}/devices/cache`, { signal: controller });
  if (!response.ok) throw new Error('Failed to fetch device cache');
  return parseDeviceCacheState(await response.json());
}

export async function refreshDeviceCache(controller: AbortSignal): Promise<DeviceCacheState> {
  const response = await fetch(`${API_BASE}/devices/cache/refresh`, {
    method: 'POST',
    signal: controller,
  });
  if (!response.ok) throw new Error('Failed to refresh device cache');
  return parseDeviceCacheState(await response.json());
}

export async function retryDeviceAddress(deviceName: string, controller: AbortSignal): Promise<DeviceCacheState> {
  const response = await fetch(`${API_BASE}/devices/${encodeURIComponent(deviceName)}/resolve`, {
    method: 'POST',
    signal: controller,
  });
  if (!response.ok) throw new Error('Failed to retry device address');
  return parseDeviceCacheState(await response.json());
}

export async function saveDeviceConfig(deviceUri: string, timestamp: number): Promise<void> {
  const url = `http://${deviceUri}/config/save`;
  const params = new URLSearchParams();
  params.append('timestamp', timestamp.toString());
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString(),
  });
  if (!response.ok) throw new Error('Failed to persist device config');
}

export async function setLedConfig(
  deviceUri: string,
  index: number,
  config: LedConfigUpdate
): Promise<ArrayBuffer> {
  const url = `http://${deviceUri}/config/led`;
  const params = new URLSearchParams();
  params.append('index', index.toString());
  for (const [key, value] of Object.entries(config)) {
    if (value !== undefined) {
      params.append(key, value.toString());
    }
  }

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString(),
  });
  if (!response.ok) throw new Error('Failed to set LED config');
  return response.arrayBuffer();
}

export async function getRemoteSharingConfig(deviceUri: string): Promise<RemoteSharingConfig> {
  const response = await fetch(`http://${deviceUri}/config/remote_sharing`);
  if (!response.ok) throw new Error('Failed to fetch remote sharing config');
  const payload: unknown = await response.json();
  return parseRemoteSharingConfig(payload);
}

export async function getFirmwareVersion(deviceUri: string): Promise<string> {
  const response = await fetch(`http://${deviceUri}/firmware_version`);
  if (!response.ok) throw new Error('Failed to fetch firmware version');
  const payload: unknown = await response.json();
  if (!isRecord(payload) || !isString(payload.version) || payload.version.trim().length === 0) {
    throw new Error('Invalid firmware version payload');
  }
  return payload.version;
}

export async function setPirEventDestinationConfig(
  deviceUri: string,
  index: number,
  config: PirEventDestinationConfigUpdate
): Promise<RemoteSharingConfig> {
  const params = new URLSearchParams();
  params.append('index', index.toString());
  for (const [key, value] of Object.entries(config)) {
    if (value !== undefined) {
      params.append(key, value.toString());
    }
  }

  const response = await fetch(`http://${deviceUri}/config/pir_destination`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString(),
  });
  if (!response.ok) throw new Error('Failed to update PIR event destination');
  const payload: unknown = await response.json();
  return parseRemoteSharingConfig(payload);
}

export async function setRemotePirConfig(
  deviceUri: string,
  index: number,
  config: RemotePirConfigUpdate
): Promise<RemoteSharingConfig> {
  const params = new URLSearchParams();
  params.append('index', index.toString());
  for (const [key, value] of Object.entries(config)) {
    if (value !== undefined) {
      params.append(key, value.toString());
    }
  }

  const response = await fetch(`http://${deviceUri}/config/remote_pir`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString(),
  });
  if (!response.ok) throw new Error('Failed to update remote PIR slot');
  const payload: unknown = await response.json();
  return parseRemoteSharingConfig(payload);
}

export async function getMoodConfigs(): Promise<MoodConfigSummary[]> {
  const response = await fetch(`${API_BASE}/mood-configs`);
  if (!response.ok) throw new Error('Failed to fetch configs');
  const payload: unknown = await response.json();
  return parseMoodConfigSummaries(payload);
}

export async function getMoodConfig(name: string): Promise<MoodConfig> {
  const response = await fetch(`${API_BASE}/mood-configs/${encodeURIComponent(name)}`);
  if (!response.ok) throw new Error('Failed to fetch config');
  const payload: unknown = await response.json();
  return parseMoodConfig(payload);
}

export async function saveMoodConfig(name: string, config: MoodConfig): Promise<void> {
  const payload: Record<string, unknown> = {
    description: config.description ?? '',
    assignments: config.assignments,
  };
  if (config.timestamp !== undefined) {
    payload.timestamp = config.timestamp;
  }
  const response = await fetch(`${API_BASE}/mood-configs/${encodeURIComponent(name)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!response.ok) await throwResponseError(response, 'Failed to save config');
}

export async function deleteMoodConfig(name: string): Promise<void> {
  const response = await fetch(`${API_BASE}/mood-configs/${encodeURIComponent(name)}`, {
    method: 'DELETE',
  });
  if (!response.ok) await throwResponseError(response, 'Failed to delete config');
}

export async function getDeviceLabelMetadata(deviceName: string): Promise<DeviceLabelMetadata> {
  const response = await fetch(`${API_BASE}/devices/${encodeURIComponent(deviceName)}/led-names`);
  if (!response.ok) throw new Error('Failed to fetch LED labels');
  const payload: unknown = await response.json();
  return parseDeviceLabelMetadata(payload);
}

export async function saveDeviceLabelMetadata(deviceName: string, metadata: DeviceLabelMetadata): Promise<void> {
  const response = await fetch(`${API_BASE}/devices/${encodeURIComponent(deviceName)}/led-names`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(metadata),
  });
  if (!response.ok) await throwResponseError(response, 'Failed to save LED labels');
}

export async function getLogicalGroups(): Promise<LogicalGroup[]> {
  const response = await fetch(`${API_BASE}/groups`);
  if (!response.ok) throw new Error('Failed to fetch groups');
  const payload: unknown = await response.json();
  return parseLogicalGroups(payload);
}

export async function createLogicalGroup(name: string, labels: string[]): Promise<LogicalGroup> {
  const response = await fetch(`${API_BASE}/groups`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, labels }),
  });
  if (!response.ok) await throwResponseError(response, 'Failed to create group');
  const payload: unknown = await response.json();
  const parsed = parseLogicalGroup(payload);
  if (!parsed) {
    throw new Error('Invalid group create response');
  }
  return parsed;
}

export async function deleteLogicalGroup(groupId: string): Promise<void> {
  const response = await fetch(`${API_BASE}/groups/${encodeURIComponent(groupId)}`, {
    method: 'DELETE',
  });
  if (!response.ok) await throwResponseError(response, 'Failed to delete group');
}

export async function applyMoodConfig(name: string, groupId: string | null): Promise<ApplyReport> {
  const response = await fetch(`${API_BASE}/mood-configs/${encodeURIComponent(name)}/apply`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(groupId ? { groupId } : {}),
  });
  if (!response.ok) await throwResponseError(response, 'Failed to apply mood');
  const payload: unknown = await response.json();
  return parseApplyReport(payload);
}

export async function getMoodApplyStatus(): Promise<MoodApplyStatus> {
  const response = await fetch(`${API_BASE}/mood-apply-status`);
  if (!response.ok) await throwResponseError(response, 'Failed to fetch mood apply status');
  const payload: unknown = await response.json();
  return parseMoodApplyStatus(payload);
}

export async function getMoodSchedules(): Promise<MoodSchedule[]> {
  const response = await fetch(`${API_BASE}/mood-schedules`);
  if (!response.ok) await throwResponseError(response, 'Failed to fetch mood schedules');
  const payload: unknown = await response.json();
  return parseMoodSchedules(payload);
}

export async function createMoodSchedule(input: MoodScheduleCreateInput): Promise<MoodSchedule> {
  const response = await fetch(`${API_BASE}/mood-schedules`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      moodName: input.moodName,
      groupId: input.groupId,
      intervalSeconds: input.intervalSeconds,
      firstRunAt: input.firstRunAt,
      enabled: input.enabled,
    }),
  });
  if (!response.ok) await throwResponseError(response, 'Failed to create mood schedule');
  const payload: unknown = await response.json();
  const parsed = parseMoodSchedule(payload);
  if (!parsed) {
    throw new Error('Invalid mood schedule response');
  }
  return parsed;
}

export async function updateMoodSchedule(scheduleId: string, patch: MoodScheduleUpdateInput): Promise<MoodSchedule> {
  const response = await fetch(`${API_BASE}/mood-schedules/${encodeURIComponent(scheduleId)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  });
  if (!response.ok) await throwResponseError(response, 'Failed to update mood schedule');
  const payload: unknown = await response.json();
  const parsed = parseMoodSchedule(payload);
  if (!parsed) {
    throw new Error('Invalid mood schedule response');
  }
  return parsed;
}

export async function deleteMoodSchedule(scheduleId: string): Promise<void> {
  const response = await fetch(`${API_BASE}/mood-schedules/${encodeURIComponent(scheduleId)}`, {
    method: 'DELETE',
  });
  if (!response.ok) await throwResponseError(response, 'Failed to delete mood schedule');
}

async function getFieldMap(deviceUri: string): Promise<ReturnType<typeof buildFieldMap>> {
  const cached = fieldMapCache.get(deviceUri);
  if (cached) {
    return cached;
  }

  const inFlight = fieldMapInFlight.get(deviceUri);
  if (inFlight) {
    return inFlight;
  }

  const loadPromise = (async () => {
    const schemaUrl = `http://${deviceUri}/combined.schema`;
    const response = await fetch(schemaUrl);
    if (!response.ok) {
      throw new Error(`Failed to fetch device schema (${response.status})`);
    }

    const rawSchema = await response.text();
    let payload: unknown;
    try {
      payload = JSON.parse(rawSchema);
    } catch {
      throw new Error(`Device schema is not valid JSON: ${rawSchema.slice(0, 200)}`);
    }

    const schema = parseSchema(payload);
    const fieldMap = buildFieldMap(schema);
    fieldMapCache.set(deviceUri, fieldMap);
    return fieldMap;
  })();

  fieldMapInFlight.set(deviceUri, loadPromise);
  try {
    return await loadPromise;
  } finally {
    fieldMapInFlight.delete(deviceUri);
  }
}

export async function fetchDeviceSnapshot(deviceUri: string): Promise<DeviceSnapshot> {
  const fieldMap = await getFieldMap(deviceUri);
  const response = await fetch(`http://${deviceUri}/combined.bin`);
  if (!response.ok) throw new Error('Failed to fetch device state');
  const rawBuffer = await response.arrayBuffer();
  const parsed = new BufferDeviceState(rawBuffer, fieldMap);

  const ledConfigs = Array.from({ length: LED_COUNT }, (_, ledIndex) => parsed.getLedConfig(ledIndex));
  const ledStates = Array.from({ length: LED_COUNT }, (_, ledIndex) => parsed.getLedState(ledIndex));

  return {
    timestamp: parsed.getTimestamp(),
    pirState: parsed.getPirState(),
    pirOverride: parsed.getPirOverride(),
    ledConfigs,
    ledStates,
  };
}
