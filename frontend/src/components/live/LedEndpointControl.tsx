import { memo } from 'react';
import { type LedEndpoint } from '../../logical/types';
import { type LedConfig, type LedConfigUpdate, type LedState } from '../../types';
import LedConfigEditor from './LedConfigEditor';
import LedConfigStatus from './LedConfigStatus';
import { DirtyBadge } from '../ui/dirtyState';

const STATE_LABELS = ['OFF', 'WAITING_ON', 'ON', 'WAITING_OFF'] as const;

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
  const stateLabel = STATE_LABELS[liveState.state] ?? STATE_LABELS[0];

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
          <DirtyBadge dirty={dirty} reserveSpace={false} />
          {pending ? <span className="rounded-full bg-blue-100 px-2 py-0.5 text-xs font-semibold text-blue-800">Updating</span> : null}
        </div>
      </div>

      <div className="space-y-3.5">
        <LedConfigEditor
          config={draftConfig}
          liveBrightness={liveState.brightness}
          pirState={pirState}
          physicalPirLabels={physicalPirLabels}
          onChange={(patch) => {
            onDraftChange(endpoint.id, patch);
          }}
          onBrightnessCommit={() => {
            onApply(endpoint.id);
          }}
        />

        <details className="mt-1">
          <summary className="cursor-pointer text-xs text-slate-500 hover:text-slate-700">
            Baseline config snapshot
          </summary>
          <LedConfigStatus config={baselineConfig} pirState={pirState} physicalPirLabels={physicalPirLabels} className="mt-2" />
        </details>

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
