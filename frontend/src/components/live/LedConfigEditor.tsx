import { useState } from 'react';
import { TOTAL_PIR_COUNT, type LedConfig, type LedConfigUpdate } from '../../types';
import PirChipGroup from '../ui/PirChipGroup';
import { isMaskEnabled } from '../ui/pir';

const BRIGHTNESS_MIN = 0;
const BRIGHTNESS_MAX = 1023;

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

  const togglePirMask = (maskKey: 'pirMaskOn' | 'pirMaskOff', currentMask: number, pirIndex: number) => {
    const nextMask = currentMask ^ (1 << pirIndex);
    if (maskKey === 'pirMaskOn') {
      onChange({ pirMaskOn: nextMask });
      return;
    }
    onChange({ pirMaskOff: nextMask });
  };

  return (
    <div className={`space-y-3 ${className}`.trim()}>
      <div className="rounded-lg border border-slate-200 bg-slate-50 p-2.5">
        <div className="mb-1.5 flex items-center justify-between text-xs font-medium text-slate-700">
          <span>Brightness</span>
          <span className="font-semibold text-slate-900">{config.brightness}</span>
        </div>
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

      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        {TIMING_FIELDS.map(({ label, key }) => (
          <label key={key} className="rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-xs">
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
              className="w-full rounded border border-slate-300 px-2 py-1 text-sm text-slate-900 outline-none transition focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
            />
          </label>
        ))}
      </div>

      <div className="rounded-lg border border-slate-200 bg-slate-50 p-2.5">
        <p className="mb-2 text-sm font-semibold text-slate-800">PIR Masks</p>
        <div className="grid gap-2 md:grid-cols-2">
          {[
            { label: 'Turn On', key: 'pirMaskOn' as const, mask: config.pirMaskOn },
            { label: 'Turn Off', key: 'pirMaskOff' as const, mask: config.pirMaskOff },
          ].map((entry) => (
            <div key={entry.key} className="rounded border border-slate-200 bg-white p-2">
              <div className="mb-1.5 flex items-center justify-between text-xs font-medium text-slate-700">
                <span>{entry.label}</span>
                <span className="font-semibold text-slate-900">{entry.mask}</span>
              </div>
              <PirChipGroup
                count={TOTAL_PIR_COUNT}
                labels={physicalPirLabels}
                isSelected={(pirIndex) => isMaskEnabled(entry.mask, pirIndex)}
                isActive={(pirIndex) => isMaskEnabled(pirState, pirIndex)}
                onSelect={(pirIndex) => {
                  togglePirMask(entry.key, entry.mask, pirIndex);
                }}
              />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
