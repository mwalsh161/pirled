// Device and configuration types
export interface KnownDevice {
  name: string;
  alias: string;
  fromConfig: boolean;
  discovered: boolean;
  resolved: boolean;
}

export interface ResolvedDevice {
  name: string;
  alias: string;
  host: string;
  port: number;
}

// Complete LED config with all fields (as returned from device)
export interface LedConfig {
  brightness: number;
  rampOnMs: number;
  holdOnMs: number;
  rampOffMs: number;
  waitOnMs: number;
  pirMaskOn: number;
  pirMaskOff: number;
}

// Complete LED state as returned from device
export interface LedState {
  brightness: number;
  state: 0 | 1 | 2 | 3;
}

// Partial LED config for updates (any subset of fields)
export type LedConfigUpdate = Partial<LedConfig>;

export interface MoodConfig {
  name: string;
  description?: string;
  timestamp?: number;
  assignments: Record<string, LedConfig>;
}

export interface DeviceLabelMetadata {
  ledNames: string[];
  ledByPir: number[];
  alias: string;
}

export interface DeviceSnapshot {
  timestamp: number;
  pirState: number;
  pirOverride: number;
  ledConfigs: LedConfig[];
  ledStates: LedState[];
}

export interface MoodConfigSummary {
  name: string;
  description?: string;
  timestamp?: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

export function isLedConfig(value: unknown): value is LedConfig {
  if (!isRecord(value)) {
    return false;
  }

  return (
    isNumber(value.brightness) &&
    isNumber(value.rampOnMs) &&
    isNumber(value.holdOnMs) &&
    isNumber(value.rampOffMs) &&
    isNumber(value.waitOnMs) &&
    isNumber(value.pirMaskOn) &&
    isNumber(value.pirMaskOff)
  );
}

const LED_COUNT = 4;
const PHYSICAL_PIR_COUNT = 4;

export { LED_COUNT, PHYSICAL_PIR_COUNT };
