import { useMemo } from 'react';
import LedEndpointControl from '../../live/LedEndpointControl';
import { type LedEndpoint, type LogicalGroup } from '../../../logical/types';
import { type DeviceSnapshot, type LedConfig, type LedConfigUpdate } from '../../../types';
import { buildEndpointsByLabel, buildGroupedLabelSet, normalizeLabel } from '../shared/labelUtils';

interface LogicalEndpointSectionsProps {
  endpoints: LedEndpoint[];
  groups: LogicalGroup[];
  collapsedGroupIds: ReadonlySet<string>;
  onToggleGroupCollapse: (groupId: string) => void;
  pirLabelsByDeviceUri: Record<string, string[]>;
  snapshotsByDeviceUri: Record<string, DeviceSnapshot>;
  draftByEndpointId: Record<string, LedConfig>;
  dirtyByEndpointId: Record<string, boolean>;
  pendingByEndpointId: Record<string, boolean>;
  onDraftChange: (endpointId: string, patch: LedConfigUpdate) => void;
  onApply: (endpointId: string) => void;
  onReset: (endpointId: string) => void;
}

function EndpointGrid({
  endpoints,
  pirLabelsByDeviceUri,
  snapshotsByDeviceUri,
  draftByEndpointId,
  dirtyByEndpointId,
  pendingByEndpointId,
  onDraftChange,
  onApply,
  onReset,
}: {
  endpoints: LedEndpoint[];
  pirLabelsByDeviceUri: Record<string, string[]>;
  snapshotsByDeviceUri: Record<string, DeviceSnapshot>;
  draftByEndpointId: Record<string, LedConfig>;
  dirtyByEndpointId: Record<string, boolean>;
  pendingByEndpointId: Record<string, boolean>;
  onDraftChange: (endpointId: string, patch: LedConfigUpdate) => void;
  onApply: (endpointId: string) => void;
  onReset: (endpointId: string) => void;
}) {
  return (
    <div className="grid gap-3 xl:grid-cols-2">
      {endpoints.map((endpoint) => {
        const snapshot = snapshotsByDeviceUri[endpoint.deviceUri];
        const baselineConfig = snapshot?.ledConfigs[endpoint.ledIndex];
        const liveState = snapshot?.ledStates[endpoint.ledIndex];
        if (!snapshot || !baselineConfig || !liveState) {
          return (
            <div
              key={endpoint.id}
              className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-4 text-sm text-slate-600"
            >
              Waiting for live data: {endpoint.deviceDisplayName} LED {endpoint.ledIndex}
            </div>
          );
        }

        return (
          <LedEndpointControl
            key={endpoint.id}
            endpoint={endpoint}
            draftConfig={draftByEndpointId[endpoint.id] ?? baselineConfig}
            liveState={liveState}
            pirState={snapshot.pirState}
            physicalPirLabels={pirLabelsByDeviceUri[endpoint.deviceUri] ?? []}
            pending={pendingByEndpointId[endpoint.id] ?? false}
            dirty={dirtyByEndpointId[endpoint.id] ?? false}
            onDraftChange={onDraftChange}
            onApply={onApply}
            onReset={onReset}
          />
        );
      })}
    </div>
  );
}

export default function LogicalEndpointSections({
  endpoints,
  groups,
  collapsedGroupIds,
  onToggleGroupCollapse,
  pirLabelsByDeviceUri,
  snapshotsByDeviceUri,
  draftByEndpointId,
  dirtyByEndpointId,
  pendingByEndpointId,
  onDraftChange,
  onApply,
  onReset,
}: LogicalEndpointSectionsProps) {
  const endpointsByLabel = useMemo(() => {
    return buildEndpointsByLabel(endpoints);
  }, [endpoints]);

  const groupedSections = useMemo(() => {
    return groups
      .map((group) => {
        const labels = group.labels
          .map((label) => normalizeLabel(label))
          .filter((label) => label.length > 0)
          .map((label) => ({
            label,
            endpoints: endpointsByLabel.get(label) ?? [],
          }))
          .filter((entry) => entry.endpoints.length > 0);
        return { group, labels };
      })
      .filter((section) => section.labels.length > 0);
  }, [endpointsByLabel, groups]);

  const groupedLabelSet = useMemo(() => {
    return buildGroupedLabelSet(groups);
  }, [groups]);

  const ungroupedLabels = useMemo(() => {
    return Array.from(endpointsByLabel.keys())
      .filter((label) => !groupedLabelSet.has(label))
      .sort((left, right) => left.localeCompare(right));
  }, [endpointsByLabel, groupedLabelSet]);

  return (
    <div className="space-y-6">
      {groupedSections.map((section) => {
        const isCollapsed = collapsedGroupIds.has(section.group.id);
        return (
          <article key={section.group.id} className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm shadow-slate-200/50">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h4 className="font-semibold text-slate-900">{section.group.name}</h4>
                <p className="text-xs text-slate-500">Logical group</p>
              </div>
              <div className="flex items-center gap-2">
                <span className="rounded-full border border-slate-300 bg-slate-50 px-2 py-0.5 text-xs text-slate-600">
                  {section.labels.length} label{section.labels.length === 1 ? '' : 's'}
                </span>
                <button
                  type="button"
                  onClick={() => {
                    onToggleGroupCollapse(section.group.id);
                  }}
                  className="rounded-full border border-slate-300 bg-white px-2.5 py-0.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
                >
                  {isCollapsed ? 'Expand' : 'Collapse'}
                </button>
              </div>
            </div>
            {isCollapsed ? (
              <p className="mt-3 text-xs text-slate-500">Group is collapsed. Polling is paused for hidden devices.</p>
            ) : (
              <div className="mt-3 space-y-3">
                {section.labels.map((entry) => (
                  <div
                    key={`${section.group.id}:${entry.label}`}
                    className="space-y-2 rounded-lg border border-slate-200 bg-slate-50/60 p-2.5"
                  >
                    <h5 className="text-sm font-medium text-slate-800">{entry.label}</h5>
                    <EndpointGrid
                      endpoints={entry.endpoints}
                      pirLabelsByDeviceUri={pirLabelsByDeviceUri}
                      snapshotsByDeviceUri={snapshotsByDeviceUri}
                      draftByEndpointId={draftByEndpointId}
                      dirtyByEndpointId={dirtyByEndpointId}
                      pendingByEndpointId={pendingByEndpointId}
                      onDraftChange={onDraftChange}
                      onApply={onApply}
                      onReset={onReset}
                    />
                  </div>
                ))}
              </div>
            )}
          </article>
        );
      })}

      {ungroupedLabels.length > 0 ? (
        <article className="space-y-3 rounded-xl border border-amber-200 bg-amber-50/50 p-3 shadow-sm shadow-amber-100/60">
          <div>
            <h4 className="font-semibold text-amber-900">Ungrouped Labels</h4>
            <p className="text-xs text-amber-800/80">Labels not currently assigned to a logical group.</p>
          </div>
          {ungroupedLabels.map((label) => {
            const labelEndpoints = endpointsByLabel.get(label) ?? [];
            return (
              <div key={`ungrouped:${label}`} className="space-y-2 rounded-lg border border-amber-200/80 bg-white p-2.5">
                <h5 className="text-sm font-medium text-slate-800">{label}</h5>
                <EndpointGrid
                  endpoints={labelEndpoints}
                  pirLabelsByDeviceUri={pirLabelsByDeviceUri}
                  snapshotsByDeviceUri={snapshotsByDeviceUri}
                  draftByEndpointId={draftByEndpointId}
                  dirtyByEndpointId={dirtyByEndpointId}
                  pendingByEndpointId={pendingByEndpointId}
                  onDraftChange={onDraftChange}
                  onApply={onApply}
                  onReset={onReset}
                />
              </div>
            );
          })}
        </article>
      ) : null}
    </div>
  );
}
