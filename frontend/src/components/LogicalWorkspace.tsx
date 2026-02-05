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
    endpoints,
    pirAssignmentsByDevice,
    labels,
    groups,
    moods,
    moodDetails,
    status,
    isBootstrapping,
    dirtyLabelDevices,
    dirtyLabelDeviceCount,
    hasUnsavedLabelChanges,
    refreshDevices,
    refreshMoods,
    loadMoodDetail,
    updateLabel,
    assignDefaultPir,
    saveLabelsForDevice,
    createGroup,
    deleteGroup,
    saveMood,
    applyMood,
    removeMood,
  } = useLogicalWorkspace();
  const activeEndpoints = endpoints.filter((endpoint) => endpoint.label.trim().length > 0);
  const pirLabelsByDeviceUri = useMemo(() => {
    const labelsByDeviceLedIndex = new Map<string, Map<number, string>>();
    for (const endpoint of endpoints) {
      const perDevice = labelsByDeviceLedIndex.get(endpoint.deviceName) ?? new Map<number, string>();
      perDevice.set(endpoint.ledIndex, endpoint.label.trim());
      labelsByDeviceLedIndex.set(endpoint.deviceName, perDevice);
    }

    const byDeviceUri: Record<string, string[]> = {};
    for (const device of devices) {
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
  }, [devices, endpoints, pirAssignmentsByDevice]);

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
        onRefreshMoods={refreshMoods}
      />
      <LabelMatrixSection
        devices={devices}
        endpoints={endpoints}
        pirAssignmentsByDevice={pirAssignmentsByDevice}
        dirtyLabelDevices={dirtyLabelDevices}
        onUpdateLabel={updateLabel}
        onAssignDefaultPir={assignDefaultPir}
        onSaveLabelsForDevice={saveLabelsForDevice}
      />
      <LiveLedControlSection
        devices={devices}
        endpoints={activeEndpoints}
        groups={groups}
        pirLabelsByDeviceUri={pirLabelsByDeviceUri}
      />
      <GroupsSection labels={labels} groups={groups} onCreateGroup={createGroup} onDeleteGroup={deleteGroup} />
      <MoodStudioSection
        groups={groups}
        moods={moods}
        moodDetails={moodDetails}
        onSaveMood={saveMood}
        onLoadMoodDetail={loadMoodDetail}
        onApplyMood={applyMood}
        onRemoveMood={removeMood}
      />
    </div>
  );
}
