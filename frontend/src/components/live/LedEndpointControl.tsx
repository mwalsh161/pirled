import { memo, useState } from 'react';
import { type LedEndpoint } from '../../logical/types';
import { type LedConfig, type LedConfigUpdate, type LedState } from '../../types';

const BRIGHTNESS_MIN = 0;
const BRIGHTNESS_MAX = 1023;

const STATE_LABELS = ['OFF', 'WAITING_ON', 'ON', 'WAITING_OFF'] as const;

const TIMING_FIELDS: Array<{
  label: string;
  key: keyof Pick<LedConfig, 'rampOnMs' | 'holdOnMs' | 'rampOffMs' | 'waitOnMs'>;
}> = [
  { label: 'Ramp On (ms)', key: 'rampOnMs' },
  { label: 'Hold On (ms)', key: 'holdOnMs' },
  { label: 'Ramp Off (ms)', key: 'rampOffMs' },
  { label: 'Wait On (ms)', key: 'waitOnMs' },
];

interface LedEndpointControlProps {
  endpoint: LedEndpoint;
  baselineConfig: LedConfig;
  draftConfig: LedConfig;
  liveState: LedState;
  pirState: number;
  physicalPirLabels: string[];
  pending: boolean;
  dirty: boolean;
  onDraftChange: (endpointId: string, patch: LedConfigUpdate) => void;
  onApply: (endpointId: string) => void;
  onReset: (endpointId: string) => void;
}

type TimingKey = keyof Pick<LedConfig, 'rampOnMs' | 'holdOnMs' | 'rampOffMs' | 'waitOnMs'>;

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function toPercent(value: number): number {
  return Math.round((clamp(value, BRIGHTNESS_MIN, BRIGHTNESS_MAX) / BRIGHTNESS_MAX) * 100);
}

function parseNumber(input: string, fallback: number): number {
  const next = Number(input);
  return Number.isFinite(next) ? Math.trunc(next) : fallback;
}

function statePillClass(state: number): string {
  if (state === 2) {
    return 'bg-green-200 text-green-800';
  }
  if (state === 1) {
    return 'bg-yellow-200 text-yellow-800';
  }
  if (state === 3) {
    return 'bg-orange-200 text-orange-800';
  }
  return 'bg-gray-200 text-gray-800';
}

function LedEndpointControl({
  endpoint,
  baselineConfig,
  draftConfig,
  liveState,
  pirState,
  physicalPirLabels,
  pending,
  dirty,
  onDraftChange,
  onApply,
  onReset,
}: LedEndpointControlProps) {
  const [editingTimingValues, setEditingTimingValues] = useState<Partial<Record<TimingKey, string>>>({});
  const livePercent = toPercent(liveState.brightness);
  const setpointPercent = toPercent(draftConfig.brightness);
  const stateLabel = STATE_LABELS[liveState.state] ?? STATE_LABELS[0];
  const baselineBrightness = baselineConfig.brightness;
  const getPirLabel = (pirIndex: number): string => {
    if (pirIndex >= 4) {
      return `PIR V${pirIndex - 4}`;
    }
    const configuredLabel = physicalPirLabels[pirIndex]?.trim() ?? '';
    return configuredLabel.length > 0 ? configuredLabel : `PIR ${pirIndex}`;
  };

  const handleTimingChange = (key: TimingKey, rawValue: string) => {
    setEditingTimingValues((previous) => ({ ...previous, [key]: rawValue }));
    const parsed = Number(rawValue);
    if (rawValue.length > 0 && Number.isFinite(parsed)) {
      onDraftChange(endpoint.id, { [key]: Math.trunc(parsed) });
    }
  };

  const handleTimingBlur = (key: TimingKey) => {
    const rawValue = editingTimingValues[key];
    if (rawValue !== undefined) {
      const parsed = Number(rawValue);
      if (rawValue.length > 0 && Number.isFinite(parsed)) {
        onDraftChange(endpoint.id, { [key]: Math.trunc(parsed) });
      }
    }
    setEditingTimingValues((previous) => {
      const next = { ...previous };
      delete next[key];
      return next;
    });
  };

  return (
    <article className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm shadow-slate-200/60">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-2 border-b border-slate-200 pb-3">
        <div>
          <h5 className="font-semibold text-slate-900">{endpoint.label}</h5>
          <p className="text-xs text-slate-500">
            {endpoint.deviceDisplayName} LED {endpoint.ledIndex}
          </p>
        </div>
        <div className="flex items-center gap-1">
          <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${statePillClass(liveState.state)}`}>{stateLabel}</span>
          {dirty ? <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-800">Unsaved</span> : null}
          {pending ? <span className="rounded-full bg-blue-100 px-2 py-0.5 text-xs font-semibold text-blue-800">Updating</span> : null}
        </div>
      </div>

      <div className="space-y-3.5">
        <div>
          <label className="mb-1 block text-sm font-medium text-slate-700">Brightness: {draftConfig.brightness}</label>
          <div className="relative h-8 overflow-hidden rounded-md border border-slate-300 bg-slate-100">
            <div
              className="pointer-events-none absolute left-0 top-0 h-full bg-blue-200/70 transition-all"
              style={{ width: `${livePercent}%` }}
            />
            <input
              type="range"
              min={BRIGHTNESS_MIN}
              max={BRIGHTNESS_MAX}
              value={clamp(draftConfig.brightness, BRIGHTNESS_MIN, BRIGHTNESS_MAX)}
              onChange={(event) => {
                onDraftChange(endpoint.id, {
                  brightness: parseNumber(event.target.value, draftConfig.brightness),
                });
              }}
              onMouseUp={() => {
                onApply(endpoint.id);
              }}
              onTouchEnd={() => {
                onApply(endpoint.id);
              }}
              className="absolute inset-0 h-full w-full cursor-pointer appearance-none bg-transparent [&::-moz-range-thumb]:h-8 [&::-moz-range-thumb]:w-4 [&::-moz-range-thumb]:rounded [&::-moz-range-thumb]:border-2 [&::-moz-range-thumb]:border-slate-500 [&::-moz-range-thumb]:bg-white [&::-webkit-slider-thumb]:h-8 [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-slate-500 [&::-webkit-slider-thumb]:bg-white [&::-webkit-slider-thumb]:shadow-sm"
            />
            <div className="pointer-events-none absolute inset-0 flex items-center justify-between px-2 text-xs font-semibold">
              <span className="text-slate-700">Set {setpointPercent}%</span>
              <span className="text-slate-500">Live {livePercent}%</span>
            </div>
          </div>
          <p className="mt-1 text-xs text-slate-500">Baseline: {baselineBrightness}</p>
        </div>

        {TIMING_FIELDS.map(({ label, key }) => (
          <label key={key} className="block text-sm">
            <span className="mb-1 block font-medium text-slate-700">{label}</span>
            <input
              type="number"
              value={editingTimingValues[key] ?? draftConfig[key]}
              onChange={(event) => {
                handleTimingChange(key, event.target.value);
              }}
              onBlur={() => {
                handleTimingBlur(key);
              }}
              className="w-full rounded-md border border-slate-300 px-2 py-1 text-slate-900 outline-none transition focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
            />
          </label>
        ))}

        <div className="border-t border-slate-200 pt-3">
          <p className="mb-2 text-sm font-semibold text-slate-800">PIR Masks</p>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <p className="mb-1 text-xs font-medium text-slate-700">Turn On</p>
              <div className="space-y-1">
                {Array.from({ length: 8 }).map((__, pirIndex) => {
                  const isTriggered = (pirState & (1 << pirIndex)) !== 0;
                  const isChecked = (draftConfig.pirMaskOn & (1 << pirIndex)) !== 0;
                  return (
                    <label
                      key={`on-${endpoint.id}-${pirIndex}`}
                      className={`flex items-center gap-2 rounded px-1 py-0.5 text-xs ${isTriggered ? 'bg-rose-100' : ''}`}
                    >
                      <input
                        type="checkbox"
                        checked={isChecked}
                        onChange={() => {
                          onDraftChange(endpoint.id, {
                            pirMaskOn: draftConfig.pirMaskOn ^ (1 << pirIndex),
                          });
                        }}
                      />
                      {getPirLabel(pirIndex)}
                    </label>
                  );
                })}
              </div>
            </div>

            <div>
              <p className="mb-1 text-xs font-medium text-slate-700">Turn Off</p>
              <div className="space-y-1">
                {Array.from({ length: 8 }).map((__, pirIndex) => {
                  const isTriggered = (pirState & (1 << pirIndex)) !== 0;
                  const isChecked = (draftConfig.pirMaskOff & (1 << pirIndex)) !== 0;
                  return (
                    <label
                      key={`off-${endpoint.id}-${pirIndex}`}
                      className={`flex items-center gap-2 rounded px-1 py-0.5 text-xs ${isTriggered ? 'bg-rose-100' : ''}`}
                    >
                      <input
                        type="checkbox"
                        checked={isChecked}
                        onChange={() => {
                          onDraftChange(endpoint.id, {
                            pirMaskOff: draftConfig.pirMaskOff ^ (1 << pirIndex),
                          });
                        }}
                      />
                      {getPirLabel(pirIndex)}
                    </label>
                  );
                })}
              </div>
            </div>
          </div>
        </div>

        <div className="flex gap-2 pt-1">
          <button
            type="button"
            onClick={() => {
              onApply(endpoint.id);
            }}
            disabled={pending || !dirty}
            className="rounded-full bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-blue-300"
          >
            Apply
          </button>
          <button
            type="button"
            onClick={() => {
              onReset(endpoint.id);
            }}
            disabled={pending || !dirty}
            className="rounded-full border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:text-slate-400"
          >
            Reset
          </button>
        </div>
      </div>
    </article>
  );
}

function areEqual(left: LedEndpointControlProps, right: LedEndpointControlProps): boolean {
  return (
    left.endpoint.id === right.endpoint.id &&
    left.endpoint.label === right.endpoint.label &&
    left.endpoint.deviceName === right.endpoint.deviceName &&
    left.endpoint.ledIndex === right.endpoint.ledIndex &&
    left.baselineConfig === right.baselineConfig &&
    left.draftConfig === right.draftConfig &&
    left.liveState === right.liveState &&
    left.pirState === right.pirState &&
    left.physicalPirLabels.length === right.physicalPirLabels.length &&
    left.physicalPirLabels.every((label, index) => label === right.physicalPirLabels[index]) &&
    left.pending === right.pending &&
    left.dirty === right.dirty &&
    left.onDraftChange === right.onDraftChange &&
    left.onApply === right.onApply &&
    left.onReset === right.onReset
  );
}

export default memo(LedEndpointControl, areEqual);
