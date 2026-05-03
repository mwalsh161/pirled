import { useCallback, useEffect, useMemo, useState } from 'react';
import { useLogicalWorkspace } from '../logical/useLogicalWorkspace';
import { toDeviceUri } from '../logical/types';
import { PHYSICAL_PIR_COUNT } from '../types';
import { useDeviceFirmwareVersions } from '../live/useDeviceFirmwareVersions';
import { useDeviceSnapshotPolling } from '../live/useDeviceSnapshotPolling';
import GroupsSection from './workspace/GroupsSection';
import LabelMatrixSection from './workspace/LabelMatrixSection';
import LiveLedControlSection from './workspace/LiveLedControlSection';
import MoodStudioSection from './workspace/MoodStudioSection';
import RemoteSensorSharingSection from './workspace/RemoteSensorSharingSection';
import WorkspaceHeaderSection from './workspace/WorkspaceHeaderSection';

type WorkspaceTab = 'setup' | 'live' | 'moods';

const ACTIVE_TAB_STORAGE_KEY = 'pirled:active-workspace-tab';
const LABEL_SETUP_COMPLETE_STORAGE_KEY = 'pirled:label-setup-complete';
const SETUP_POLL_INTERVAL_MS = 750;

function readStoredBoolean(key: string): boolean {
  if (typeof window === 'undefined') {
    return false;
  }
  return window.localStorage.getItem(key) === '1';
}

function readStoredTab(): WorkspaceTab {
  if (typeof window === 'undefined') {
    return 'setup';
  }
  const stored = window.localStorage.getItem(ACTIVE_TAB_STORAGE_KEY);
  if (stored === 'setup' || stored === 'live' || stored === 'moods') {
    return stored;
  }
  return 'setup';
}

export default function LogicalWorkspace() {
  const [activeTab, setActiveTab] = useState<WorkspaceTab>(readStoredTab);
  const [hasCompletedLabelSetup, setHasCompletedLabelSetup] = useState<boolean>(() =>
    readStoredBoolean(LABEL_SETUP_COMPLETE_STORAGE_KEY)
  );
  const [setupActiveDeviceUri, setSetupActiveDeviceUri] = useState<string | null>(null);
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
    hasLoadedMoodData,
    status,
    isBootstrapping,
    resolveErrorsByDevice,
    deviceCacheRefreshedAt,
    dirtyLabelDevices,
    dirtyLabelDeviceCount,
    hasUnsavedLabelChanges,
    refreshDeviceCache,
    retryDeviceAddress,
    refreshMoods,
    refreshMoodSchedules,
    refreshMoodApplyStatus,
    ensureMoodDataLoaded,
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
  } = useLogicalWorkspace({ moodPollingEnabled: activeTab === 'moods' });

  useEffect(() => {
    window.localStorage.setItem(ACTIVE_TAB_STORAGE_KEY, activeTab);
  }, [activeTab]);

  useEffect(() => {
    window.localStorage.setItem(LABEL_SETUP_COMPLETE_STORAGE_KEY, hasCompletedLabelSetup ? '1' : '0');
  }, [hasCompletedLabelSetup]);

  useEffect(() => {
    if (activeTab !== 'moods' || hasLoadedMoodData) {
      return;
    }
    void ensureMoodDataLoaded();
  }, [activeTab, ensureMoodDataLoaded, hasLoadedMoodData]);

  const handleSaveLabelsForDevice = useCallback(
    async (deviceName: string): Promise<boolean> => {
      const saved = await saveLabelsForDevice(deviceName);
      if (saved) {
        if (!hasCompletedLabelSetup) {
          setHasCompletedLabelSetup(true);
        }
      }
      return saved;
    },
    [hasCompletedLabelSetup, saveLabelsForDevice]
  );

  const tabButtonClass = (tab: WorkspaceTab) =>
    `rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors ${
      activeTab === tab
        ? 'border-blue-600 bg-blue-600 text-white'
        : 'border-gray-300 bg-white text-gray-700 hover:bg-gray-50'
    }`;

  const activeEndpoints = endpoints.filter((endpoint) => endpoint.label.trim().length > 0);
  const firmwareVersionByDeviceUri = useDeviceFirmwareVersions(resolvedDevices);
  const resolvedDevicesByName = useMemo(() => {
    const next: Record<string, (typeof resolvedDevices)[number]> = {};
    for (const device of resolvedDevices) {
      next[device.name] = device;
    }
    return next;
  }, [resolvedDevices]);
  const setupPollingDeviceUris = useMemo(
    () => (activeTab === 'setup' && setupActiveDeviceUri ? [setupActiveDeviceUri] : []),
    [activeTab, setupActiveDeviceUri]
  );
  const {
    snapshotsByDeviceUri: setupSnapshotsByDeviceUri,
    deviceHealthByUri: setupDeviceHealthByUri,
    retryDevice: retrySetupDevice,
  } = useDeviceSnapshotPolling({
    devices: resolvedDevices,
    autoRefreshEnabled: activeTab === 'setup',
    pollIntervalMs: SETUP_POLL_INTERVAL_MS,
    activePollingDeviceUris: setupPollingDeviceUris,
  });
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
        deviceCacheRefreshedAt={deviceCacheRefreshedAt}
        showRefreshMoods={activeTab === 'moods'}
        onRefreshDeviceCache={refreshDeviceCache}
        onRefreshMoods={async () => {
          await refreshMoods();
        }}
      />
      <section className="rounded-lg border bg-white p-4 shadow-sm">
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={() => setActiveTab('setup')} className={tabButtonClass('setup')}>
            Setup
          </button>
          <button type="button" onClick={() => setActiveTab('live')} className={tabButtonClass('live')}>
            Live
          </button>
          <button type="button" onClick={() => setActiveTab('moods')} className={tabButtonClass('moods')}>
            Moods
          </button>
        </div>
      </section>

      {activeTab === 'setup' ? (
        <div className="space-y-6">
          <LabelMatrixSection
            devices={devices}
            endpoints={endpoints}
            aliasesByDevice={aliasesByDevice}
            pirAssignmentsByDevice={pirAssignmentsByDevice}
            dirtyLabelDevices={dirtyLabelDevices}
            resolveErrorsByDevice={resolveErrorsByDevice}
            resolvedDevicesByName={resolvedDevicesByName}
            snapshotsByDeviceUri={setupSnapshotsByDeviceUri}
            deviceHealthByUri={setupDeviceHealthByUri}
            firmwareVersionByDeviceUri={firmwareVersionByDeviceUri}
            hasCompletedLabelSetup={hasCompletedLabelSetup}
            onSetActiveDeviceUri={setSetupActiveDeviceUri}
            onRetryDevice={(deviceName) => {
              const resolved = resolvedDevicesByName[deviceName];
              if (!resolved) {
                return;
              }
              void retrySetupDevice(resolved);
            }}
            onRetryAddress={(deviceName) => {
              void retryDeviceAddress(deviceName);
            }}
            onUpdateLabel={updateLabel}
            onUpdateAlias={updateAlias}
            onAssignDefaultPir={assignDefaultPir}
            onSaveLabelsForDevice={handleSaveLabelsForDevice}
          />
          <GroupsSection labels={labels} groups={groups} onCreateGroup={createGroup} onDeleteGroup={deleteGroup} />
          <RemoteSensorSharingSection devices={resolvedDevices} />
        </div>
      ) : null}

      {activeTab === 'live' ? (
        <LiveLedControlSection
          knownDevices={devices}
          devices={resolvedDevices}
          resolveErrorsByDevice={resolveErrorsByDevice}
          endpoints={liveEndpoints}
          groups={groups}
          pirLabelsByDeviceUri={pirLabelsByDeviceUri}
          firmwareVersionByDeviceUri={firmwareVersionByDeviceUri}
          onRetryAddress={(deviceName) => {
            void retryDeviceAddress(deviceName);
          }}
        />
      ) : null}

      {activeTab === 'moods' ? (
        <div className="space-y-3">
          {!hasLoadedMoodData ? (
            <section className="rounded-lg border bg-white p-5 shadow-sm">
              <p className="text-sm text-gray-600">Loading mood studio data...</p>
            </section>
          ) : null}
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
            onRefreshMoodSchedules={async () => {
              await refreshMoodSchedules();
            }}
            onRefreshMoodApplyStatus={async () => {
              await refreshMoodApplyStatus();
            }}
            onCreateMoodSchedule={createMoodSchedule}
            onUpdateMoodSchedule={updateMoodSchedule}
            onDeleteMoodSchedule={deleteMoodSchedule}
          />
        </div>
      ) : null}
    </div>
  );
}
