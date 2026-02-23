import { useMemo } from 'react';
import { useLogicalWorkspace } from '../logical/useLogicalWorkspace';
import { toDeviceUri } from '../logical/types';
import { PHYSICAL_PIR_COUNT } from '../types';
import GroupsSection from './workspace/GroupsSection';
import LabelMatrixSection from './workspace/LabelMatrixSection';
import LiveLedControlSection from './workspace/LiveLedControlSection';
import MoodStudioSection from './workspace/MoodStudioSection';
import WorkspaceHeaderSection from './workspace/WorkspaceHeaderSection';

export default function LogicalWorkspace() {
  const {
    devices,
    resolvedDevices,
    aliasesByDevice,
    endpoints,
    pirAssignmentsByDevice,
    labels,
    groups,
    moods,
    moodDetails,
    dirtyMoodDetailsByName,
    moodSchedules,
    moodApplyStatus,
    status,
    isBootstrapping,
    dirtyLabelDevices,
    dirtyLabelDeviceCount,
    hasUnsavedLabelChanges,
    refreshDevices,
    discoverDevices,
    refreshMoods,
    refreshMoodSchedules,
    refreshMoodApplyStatus,
    loadMoodDetail,
    updateMoodAssignment,
    cloneMoodAssignment,
    removeMoodAssignment,
    saveMoodDetail,
    updateLabel,
    updateAlias,
    assignDefaultPir,
    saveLabelsForDevice,
    createGroup,
    deleteGroup,
    createMoodSchedule,
    updateMoodSchedule,
    deleteMoodSchedule,
    saveMood,
    applyMood,
    removeMood,
  } = useLogicalWorkspace();
  const activeEndpoints = endpoints.filter((endpoint) => endpoint.label.trim().length > 0);
  const resolvedDeviceNameSet = new Set(resolvedDevices.map((device) => device.name));
  const liveEndpoints = activeEndpoints.filter((endpoint) => resolvedDeviceNameSet.has(endpoint.deviceName));
  const pirLabelsByDeviceUri = useMemo(() => {
    const labelsByDeviceLedIndex = new Map<string, Map<number, string>>();
    for (const endpoint of endpoints) {
      const perDevice = labelsByDeviceLedIndex.get(endpoint.deviceName) ?? new Map<number, string>();
      perDevice.set(endpoint.ledIndex, endpoint.label.trim());
      labelsByDeviceLedIndex.set(endpoint.deviceName, perDevice);
    }

    const byDeviceUri: Record<string, string[]> = {};
    for (const device of resolvedDevices) {
      const assignment = pirAssignmentsByDevice[device.name] ?? [0, 1, 2, 3];
      const labelByLed = labelsByDeviceLedIndex.get(device.name);
      const resolved = Array.from({ length: PHYSICAL_PIR_COUNT }, (_, pirIndex) => {
        const ledIndex = assignment[pirIndex] ?? pirIndex;
        const label = labelByLed?.get(ledIndex) ?? '';
        return label.length > 0 ? label : `LED ${ledIndex}`;
      });
      byDeviceUri[toDeviceUri(device)] = resolved;
    }
    return byDeviceUri;
  }, [endpoints, pirAssignmentsByDevice, resolvedDevices]);

  if (isBootstrapping) {
    return <div className="py-10 text-center text-gray-600">Loading logical workspace...</div>;
  }

  return (
    <div className="space-y-8">
      <WorkspaceHeaderSection
        status={status}
        hasUnsavedLabelChanges={hasUnsavedLabelChanges}
        dirtyLabelDeviceCount={dirtyLabelDeviceCount}
        onRefreshDevices={refreshDevices}
        onDiscoverDevices={discoverDevices}
        onRefreshMoods={refreshMoods}
      />
      <LabelMatrixSection
        devices={devices}
        endpoints={endpoints}
        aliasesByDevice={aliasesByDevice}
        pirAssignmentsByDevice={pirAssignmentsByDevice}
        dirtyLabelDevices={dirtyLabelDevices}
        onUpdateLabel={updateLabel}
        onUpdateAlias={updateAlias}
        onAssignDefaultPir={assignDefaultPir}
        onSaveLabelsForDevice={saveLabelsForDevice}
      />
      <LiveLedControlSection
        devices={resolvedDevices}
        endpoints={liveEndpoints}
        groups={groups}
        pirLabelsByDeviceUri={pirLabelsByDeviceUri}
      />
      <GroupsSection labels={labels} groups={groups} onCreateGroup={createGroup} onDeleteGroup={deleteGroup} />
      <MoodStudioSection
        labels={labels}
        groups={groups}
        moods={moods}
        moodDetails={moodDetails}
        dirtyMoodDetailsByName={dirtyMoodDetailsByName}
        moodSchedules={moodSchedules}
        moodApplyStatus={moodApplyStatus}
        onSaveMood={saveMood}
        onLoadMoodDetail={loadMoodDetail}
        onUpdateMoodAssignment={updateMoodAssignment}
        onCloneMoodAssignment={cloneMoodAssignment}
        onRemoveMoodAssignment={removeMoodAssignment}
        onSaveMoodDetail={saveMoodDetail}
        onApplyMood={applyMood}
        onRemoveMood={removeMood}
        onRefreshMoodSchedules={refreshMoodSchedules}
        onRefreshMoodApplyStatus={refreshMoodApplyStatus}
        onCreateMoodSchedule={createMoodSchedule}
        onUpdateMoodSchedule={updateMoodSchedule}
        onDeleteMoodSchedule={deleteMoodSchedule}
      />
    </div>
  );
}
