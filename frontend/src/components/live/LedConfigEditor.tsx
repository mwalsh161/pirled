import { useState } from 'react';
import { type LedConfig, type LedConfigUpdate } from '../../types';

const BRIGHTNESS_MIN = 0;
const BRIGHTNESS_MAX = 1023;
const TOTAL_PIR_COUNT = 8;

const TIMING_FIELDS: Array<{
  label: string;
  key: keyof Pick<LedConfig, 'rampOnMs' | 'holdOnMs' | 'rampOffMs' | 'waitOnMs'>;
}> = [
  { label: 'Ramp On (ms)', key: 'rampOnMs' },
  { label: 'Hold On (ms)', key: 'holdOnMs' },
  { label: 'Ramp Off (ms)', key: 'rampOffMs' },
  { label: 'Wait On (ms)', key: 'waitOnMs' },
];

type TimingKey = keyof Pick<LedConfig, 'rampOnMs' | 'holdOnMs' | 'rampOffMs' | 'waitOnMs'>;

interface LedConfigEditorProps {
  config: LedConfig;
  onChange: (patch: LedConfigUpdate) => void;
  onBrightnessCommit?: () => void;
  liveBrightness?: number;
  pirState?: number;
  physicalPirLabels?: string[];
  className?: string;
}

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

function getPirLabel(physicalPirLabels: string[], pirIndex: number): string {
  if (pirIndex >= 4) {
    return `PIR V${pirIndex - 4}`;
  }
  const configuredLabel = physicalPirLabels[pirIndex]?.trim() ?? '';
  return configuredLabel.length > 0 ? configuredLabel : `PIR ${pirIndex}`;
}

export default function LedConfigEditor({
  config,
  onChange,
  onBrightnessCommit,
  liveBrightness,
  pirState = 0,
  physicalPirLabels = [],
  className = '',
}: LedConfigEditorProps) {
  const [editingTimingValues, setEditingTimingValues] = useState<Partial<Record<TimingKey, string>>>({});
  const hasLiveBrightness = liveBrightness !== undefined;
  const livePercent = hasLiveBrightness ? toPercent(liveBrightness) : 0;
  const setpointPercent = toPercent(config.brightness);

  const handleTimingChange = (key: TimingKey, rawValue: string) => {
    setEditingTimingValues((previous) => ({ ...previous, [key]: rawValue }));
    const parsed = Number(rawValue);
    if (rawValue.length > 0 && Number.isFinite(parsed)) {
      onChange({ [key]: Math.trunc(parsed) });
    }
  };

  const handleTimingBlur = (key: TimingKey) => {
    const rawValue = editingTimingValues[key];
    if (rawValue !== undefined) {
      const parsed = Number(rawValue);
      if (rawValue.length > 0 && Number.isFinite(parsed)) {
        onChange({ [key]: Math.trunc(parsed) });
      }
    }
    setEditingTimingValues((previous) => {
      const next = { ...previous };
      delete next[key];
      return next;
    });
  };

  return (
    <div className={`space-y-3.5 ${className}`.trim()}>
      <div>
        <label className="mb-1 block text-sm font-medium text-slate-700">Brightness: {config.brightness}</label>
        <div className="relative h-8 overflow-hidden rounded-md border border-slate-300 bg-slate-100">
          {hasLiveBrightness ? (
            <div
              className="pointer-events-none absolute left-0 top-0 h-full bg-blue-200/70 transition-all"
              style={{ width: `${livePercent}%` }}
            />
          ) : null}
          <input
            type="range"
            min={BRIGHTNESS_MIN}
            max={BRIGHTNESS_MAX}
            value={clamp(config.brightness, BRIGHTNESS_MIN, BRIGHTNESS_MAX)}
            onChange={(event) => {
              onChange({
                brightness: parseNumber(event.target.value, config.brightness),
              });
            }}
            onMouseUp={() => {
              onBrightnessCommit?.();
            }}
            onTouchEnd={() => {
              onBrightnessCommit?.();
            }}
            className="absolute inset-0 h-full w-full cursor-pointer appearance-none bg-transparent [&::-moz-range-thumb]:h-8 [&::-moz-range-thumb]:w-4 [&::-moz-range-thumb]:rounded [&::-moz-range-thumb]:border-2 [&::-moz-range-thumb]:border-slate-500 [&::-moz-range-thumb]:bg-white [&::-webkit-slider-thumb]:h-8 [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-slate-500 [&::-webkit-slider-thumb]:bg-white [&::-webkit-slider-thumb]:shadow-sm"
          />
          <div className="pointer-events-none absolute inset-0 flex items-center justify-between px-2 text-xs font-semibold">
            <span className="text-slate-700">Set {setpointPercent}%</span>
            {hasLiveBrightness ? <span className="text-slate-500">Live {livePercent}%</span> : null}
          </div>
        </div>
      </div>

      {TIMING_FIELDS.map(({ label, key }) => (
        <label key={key} className="block text-sm">
          <span className="mb-1 block font-medium text-slate-700">{label}</span>
          <input
            type="number"
            value={editingTimingValues[key] ?? config[key]}
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
              {Array.from({ length: TOTAL_PIR_COUNT }).map((__, pirIndex) => {
                const isTriggered = (pirState & (1 << pirIndex)) !== 0;
                const isChecked = (config.pirMaskOn & (1 << pirIndex)) !== 0;
                return (
                  <label
                    key={`on:${pirIndex}`}
                    className={`flex items-center gap-2 rounded px-1 py-0.5 text-xs ${isTriggered ? 'bg-rose-100' : ''}`}
                  >
                    <input
                      type="checkbox"
                      checked={isChecked}
                      onChange={() => {
                        onChange({ pirMaskOn: config.pirMaskOn ^ (1 << pirIndex) });
                      }}
                    />
                    {getPirLabel(physicalPirLabels, pirIndex)}
                  </label>
                );
              })}
            </div>
          </div>

          <div>
            <p className="mb-1 text-xs font-medium text-slate-700">Turn Off</p>
            <div className="space-y-1">
              {Array.from({ length: TOTAL_PIR_COUNT }).map((__, pirIndex) => {
                const isTriggered = (pirState & (1 << pirIndex)) !== 0;
                const isChecked = (config.pirMaskOff & (1 << pirIndex)) !== 0;
                return (
                  <label
                    key={`off:${pirIndex}`}
                    className={`flex items-center gap-2 rounded px-1 py-0.5 text-xs ${isTriggered ? 'bg-rose-100' : ''}`}
                  >
                    <input
                      type="checkbox"
                      checked={isChecked}
                      onChange={() => {
                        onChange({ pirMaskOff: config.pirMaskOff ^ (1 << pirIndex) });
                      }}
                    />
                    {getPirLabel(physicalPirLabels, pirIndex)}
                  </label>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
