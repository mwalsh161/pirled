import { type LedConfig, type MoodConfig, type ResolvedDevice } from '../types';

export interface LedEndpoint {
  id: string;
  deviceName: string;
  deviceDisplayName: string;
  deviceUri: string;
  ledIndex: number;
  label: string;
}

export interface LogicalGroup {
  id: string;
  name: string;
  labels: string[];
}

export interface MoodSummary {
  name: string;
  description: string;
  timestamp?: number;
}

export interface MoodDetail {
  name: string;
  description: string;
  timestamp?: number;
  assignmentsByLabel: Record<string, LedConfig>;
}

export type PersistedMoodPayload = MoodConfig;

export interface ApplyReport {
  successCount: number;
  failureCount: number;
  failures: string[];
}

export interface MoodApplyStatusEntry extends ApplyReport {
  appliedAt: number;
  source: 'manual' | 'scheduled';
  moodName: string;
  groupId: string | null;
  scheduleId: string | null;
}

export interface MoodApplyStatus {
  lastApply: MoodApplyStatusEntry | null;
}

export interface MoodSchedule {
  id: string;
  moodName: string;
  groupId: string | null;
  timeOfDay: string;
  nextRunAt: number;
  enabled: boolean;
  createdAt: number;
  updatedAt: number;
  lastRunAt: number | null;
  lastResult: ApplyReport | null;
}

export interface MoodScheduleCreateInput {
  moodName: string;
  groupId: string | null;
  timeOfDay: string;
  enabled: boolean;
}

export interface MoodScheduleUpdateInput {
  moodName?: string;
  groupId?: string | null;
  timeOfDay?: string;
  enabled?: boolean;
}

export function toDeviceUri(device: ResolvedDevice): string {
  return `${device.host}:${device.port}`;
}

export function endpointId(deviceName: string, ledIndex: number): string {
  return `${deviceName}/led/${ledIndex}`;
}
