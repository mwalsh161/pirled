import { type LedConfig } from '../../types';

const TIMING_FIELDS: Array<{
  label: string;
  key: keyof Pick<LedConfig, 'rampOnMs' | 'holdOnMs' | 'rampOffMs' | 'waitOnMs'>;
}> = [
  { label: 'Ramp On', key: 'rampOnMs' },
  { label: 'Hold On', key: 'holdOnMs' },
  { label: 'Ramp Off', key: 'rampOffMs' },
  { label: 'Wait On', key: 'waitOnMs' },
];

const TOTAL_PIR_COUNT = 8;

interface LedConfigStatusProps {
  config: LedConfig;
  physicalPirLabels?: string[];
  pirState?: number;
  className?: string;
}

function getPirLabel(physicalPirLabels: string[], pirIndex: number): string {
  if (pirIndex >= 4) {
    return `PIR V${pirIndex - 4}`;
  }
  const configuredLabel = physicalPirLabels[pirIndex]?.trim() ?? '';
  return configuredLabel.length > 0 ? configuredLabel : `PIR ${pirIndex}`;
}

function isMaskEnabled(mask: number, pirIndex: number): boolean {
  return (mask & (1 << pirIndex)) !== 0;
}

export default function LedConfigStatus({
  config,
  physicalPirLabels = [],
  pirState = 0,
  className = '',
}: LedConfigStatusProps) {
  return (
    <div className={`space-y-3 rounded-lg border border-slate-200 bg-slate-50 p-3 ${className}`.trim()}>
      <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs text-slate-700 md:grid-cols-3">
        <div className="rounded bg-white px-2 py-1">
          <dt className="font-medium text-slate-600">Brightness</dt>
          <dd className="font-semibold text-slate-900">{config.brightness}</dd>
        </div>
        {TIMING_FIELDS.map(({ label, key }) => (
          <div key={key} className="rounded bg-white px-2 py-1">
            <dt className="font-medium text-slate-600">{label}</dt>
            <dd className="font-semibold text-slate-900">{config[key]} ms</dd>
          </div>
        ))}
      </dl>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        {[
          { title: 'Turn On Mask', mask: config.pirMaskOn },
          { title: 'Turn Off Mask', mask: config.pirMaskOff },
        ].map((entry) => (
          <div key={entry.title}>
            <p className="mb-1 text-xs font-medium text-slate-700">
              {entry.title} ({entry.mask})
            </p>
            <div className="flex flex-wrap gap-1">
              {Array.from({ length: TOTAL_PIR_COUNT }).map((__, pirIndex) => {
                const enabled = isMaskEnabled(entry.mask, pirIndex);
                const triggered = isMaskEnabled(pirState, pirIndex);
                return (
                  <span
                    key={`${entry.title}:${pirIndex}`}
                    className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs ${
                      triggered ? 'bg-rose-100 text-rose-900' : 'bg-white text-slate-700'
                    }`}
                  >
                    <span className={`h-1.5 w-1.5 rounded-full ${enabled ? 'bg-emerald-500' : 'bg-slate-300'}`} />
                    {getPirLabel(physicalPirLabels, pirIndex)}
                  </span>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
