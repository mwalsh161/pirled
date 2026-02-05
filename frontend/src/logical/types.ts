import { type Device, type LedConfig, type MoodConfig } from '../types';

export interface LedEndpoint {
  id: string;
  deviceName: string;
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

export function toDeviceUri(device: Device): string {
  return `${device.host}:${device.port}`;
}

export function endpointId(deviceUri: string, ledIndex: number): string {
  return `${deviceUri}/led/${ledIndex}`;
}
