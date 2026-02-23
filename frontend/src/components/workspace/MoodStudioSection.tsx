import { useEffect, useState } from 'react';
import {
  type ApplyReport,
  type LogicalGroup,
  type MoodApplyStatus,
  type MoodDetail,
  type MoodSchedule,
  type MoodScheduleCreateInput,
  type MoodScheduleUpdateInput,
  type MoodSummary,
} from '../../logical/types';
import { type LedConfigUpdate } from '../../types';
import LedConfigEditor from '../live/LedConfigEditor';
import { DirtyBadge, dirtyActionButtonClass, dirtyCardClass } from '../ui/dirtyState';

interface SaveMoodInput {
  name: string;
  description: string;
  captureGroupId: string | null;
}

interface ScheduleDraft {
  moodName: string;
  groupId: string;
  intervalSeconds: string;
  nextRunLocal: string;
  enabled: boolean;
}

interface MoodStudioSectionProps {
  labels: string[];
  groups: LogicalGroup[];
  moods: MoodSummary[];
  moodDetails: Record<string, MoodDetail>;
  dirtyMoodDetailsByName: Record<string, boolean>;
  moodSchedules: MoodSchedule[];
  moodApplyStatus: MoodApplyStatus;
  onSaveMood: (input: SaveMoodInput) => Promise<void>;
  onLoadMoodDetail: (moodName: string) => Promise<MoodDetail>;
  onUpdateMoodAssignment: (moodName: string, label: string, patch: LedConfigUpdate) => void;
  onCloneMoodAssignment: (moodName: string, sourceLabel: string, newLabel: string) => void;
  onRemoveMoodAssignment: (moodName: string, label: string) => void;
  onSaveMoodDetail: (moodName: string) => Promise<void>;
  onApplyMood: (moodName: string, groupId: string | null) => Promise<ApplyReport>;
  onRemoveMood: (moodName: string) => Promise<void>;
  onRefreshMoodSchedules: () => Promise<void>;
  onRefreshMoodApplyStatus: () => Promise<void>;
  onCreateMoodSchedule: (input: MoodScheduleCreateInput) => Promise<void>;
  onUpdateMoodSchedule: (scheduleId: string, patch: MoodScheduleUpdateInput) => Promise<void>;
  onDeleteMoodSchedule: (scheduleId: string) => Promise<void>;
}

function timestampToText(timestamp?: number): string {
  if (!timestamp) {
    return 'Unknown';
  }
  return new Date(timestamp * 1000).toLocaleString();
}

function pad2(value: number): string {
  return value.toString().padStart(2, '0');
}

function timestampToLocalInputValue(timestamp: number): string {
  const date = new Date(timestamp * 1000);
  const year = date.getFullYear();
  const month = pad2(date.getMonth() + 1);
  const day = pad2(date.getDate());
  const hours = pad2(date.getHours());
  const minutes = pad2(date.getMinutes());
  const seconds = pad2(date.getSeconds());
  return `${year}-${month}-${day}T${hours}:${minutes}:${seconds}`;
}

function localInputValueToTimestamp(value: string): number | null {
  const parsedMs = Date.parse(value);
  if (!Number.isFinite(parsedMs)) {
    return null;
  }
  return Math.floor(parsedMs / 1000);
}

function formatScope(groups: LogicalGroup[], groupId: string | null): string {
  if (!groupId) {
    return 'All labeled endpoints';
  }
  const group = groups.find((entry) => entry.id === groupId);
  return group ? `Group: ${group.name}` : `Missing group (${groupId})`;
}

function formatInterval(seconds: number): string {
  if (seconds % 3600 === 0) {
    return `${seconds / 3600}h`;
  }
  if (seconds % 60 === 0) {
    return `${seconds / 60}m`;
  }
  return `${seconds}s`;
}

function summarizeApplyReport(report: ApplyReport): string {
  if (report.failureCount > 0) {
    return `${report.successCount} successful, ${report.failureCount} failed`;
  }
  return `${report.successCount} successful`;
}

function toScheduleDraft(schedule: MoodSchedule): ScheduleDraft {
  return {
    moodName: schedule.moodName,
    groupId: schedule.groupId ?? '',
    intervalSeconds: schedule.intervalSeconds.toString(),
    nextRunLocal: timestampToLocalInputValue(schedule.nextRunAt),
    enabled: schedule.enabled,
  };
}

export default function MoodStudioSection({
  labels,
  groups,
  moods,
  moodDetails,
  dirtyMoodDetailsByName,
  moodSchedules,
  moodApplyStatus,
  onSaveMood,
  onLoadMoodDetail,
  onUpdateMoodAssignment,
  onCloneMoodAssignment,
  onRemoveMoodAssignment,
  onSaveMoodDetail,
  onApplyMood,
  onRemoveMood,
  onRefreshMoodSchedules,
  onRefreshMoodApplyStatus,
  onCreateMoodSchedule,
  onUpdateMoodSchedule,
  onDeleteMoodSchedule,
}: MoodStudioSectionProps) {
  const [moodNameInput, setMoodNameInput] = useState('');
  const [moodDescriptionInput, setMoodDescriptionInput] = useState('');
  const [captureScope, setCaptureScope] = useState('');
  const [applyScope, setApplyScope] = useState('');
  const [statusMessage, setStatusMessage] = useState('');
  const [cloneSourceByMood, setCloneSourceByMood] = useState<Record<string, string>>({});
  const [cloneTargetByMood, setCloneTargetByMood] = useState<Record<string, string>>({});
  const [scheduleMoodNameInput, setScheduleMoodNameInput] = useState('');
  const [scheduleGroupIdInput, setScheduleGroupIdInput] = useState('');
  const [scheduleIntervalInput, setScheduleIntervalInput] = useState('300');
  const [scheduleFirstRunInput, setScheduleFirstRunInput] = useState('');
  const [scheduleEnabledInput, setScheduleEnabledInput] = useState(true);
  const [scheduleDraftsById, setScheduleDraftsById] = useState<Record<string, ScheduleDraft>>({});

  useEffect(() => {
    if (moods.length === 0) {
      if (scheduleMoodNameInput) {
        setScheduleMoodNameInput('');
      }
      return;
    }
    if (moods.some((mood) => mood.name === scheduleMoodNameInput)) {
      return;
    }
    setScheduleMoodNameInput(moods[0]?.name ?? '');
  }, [moods, scheduleMoodNameInput]);

  useEffect(() => {
    const next: Record<string, ScheduleDraft> = {};
    for (const schedule of moodSchedules) {
      next[schedule.id] = toScheduleDraft(schedule);
    }
    setScheduleDraftsById(next);
  }, [moodSchedules]);

  const handleSaveMood = () => {
    void (async () => {
      try {
        await onSaveMood({
          name: moodNameInput,
          description: moodDescriptionInput,
          captureGroupId: captureScope || null,
        });
        setMoodNameInput('');
        setMoodDescriptionInput('');
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown mood save error';
        setStatusMessage(`Save failed: ${message}`);
      }
    })();
  };

  const handleLoadMoodDetail = (moodName: string) => {
    void (async () => {
      try {
        await onLoadMoodDetail(moodName);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown mood detail error';
        setStatusMessage(`Load detail failed: ${message}`);
      }
    })();
  };

  const handleApplyMood = (moodName: string) => {
    if (dirtyMoodDetailsByName[moodName]) {
      setStatusMessage(`Save edits for "${moodName}" before apply.`);
      return;
    }

    void (async () => {
      try {
        const report = await onApplyMood(moodName, applyScope || null);
        setStatusMessage(
          report.failureCount > 0
            ? `Applied with failures: ${report.failureCount} failed, ${report.successCount} successful.`
            : `Applied successfully to ${report.successCount} endpoints.`
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown mood apply error';
        setStatusMessage(`Apply failed: ${message}`);
      }
    })();
  };

  const handleSaveMoodDetail = (moodName: string) => {
    void (async () => {
      try {
        await onSaveMoodDetail(moodName);
        setStatusMessage(`Saved edits for "${moodName}".`);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown mood detail save error';
        setStatusMessage(`Save edits failed: ${message}`);
      }
    })();
  };

  const handleDeleteMood = (moodName: string) => {
    if (!window.confirm(`Delete mood "${moodName}"?`)) {
      return;
    }

    void (async () => {
      try {
        await onRemoveMood(moodName);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown mood delete error';
        setStatusMessage(`Delete failed: ${message}`);
      }
    })();
  };

  const handleCloneMoodAssignment = (moodName: string, fallbackSourceLabel: string, fallbackTargetLabel: string) => {
    const sourceLabel = cloneSourceByMood[moodName] ?? fallbackSourceLabel;
    const nextLabel = cloneTargetByMood[moodName] ?? fallbackTargetLabel;
    try {
      onCloneMoodAssignment(moodName, sourceLabel, nextLabel);
      setCloneTargetByMood((previous) => ({
        ...previous,
        [moodName]: '',
      }));
      setCloneSourceByMood((previous) => ({
        ...previous,
        [moodName]: sourceLabel,
      }));
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown mood clone error';
      setStatusMessage(`Add assignment failed: ${message}`);
    }
  };

  const handleRemoveMoodAssignment = (moodName: string, label: string) => {
    try {
      onRemoveMoodAssignment(moodName, label);
      setCloneSourceByMood((previous) => {
        if (previous[moodName] !== label) {
          return previous;
        }
        const next = { ...previous };
        delete next[moodName];
        return next;
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown mood remove error';
      setStatusMessage(`Remove assignment failed: ${message}`);
    }
  };

  const handleRefreshSchedulerData = () => {
    void (async () => {
      try {
        await Promise.all([onRefreshMoodSchedules(), onRefreshMoodApplyStatus()]);
        setStatusMessage('Refreshed scheduler data.');
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown refresh error';
        setStatusMessage(`Refresh failed: ${message}`);
      }
    })();
  };

  const handleCreateSchedule = () => {
    const intervalSeconds = Number.parseInt(scheduleIntervalInput, 10);
    if (!Number.isInteger(intervalSeconds) || intervalSeconds < 60) {
      setStatusMessage('Interval must be an integer >= 60 seconds.');
      return;
    }
    if (!scheduleMoodNameInput) {
      setStatusMessage('Pick a mood before creating a schedule.');
      return;
    }

    let firstRunAt: number | null = null;
    if (scheduleFirstRunInput.trim().length > 0) {
      firstRunAt = localInputValueToTimestamp(scheduleFirstRunInput);
      if (firstRunAt === null) {
        setStatusMessage('First run time is invalid.');
        return;
      }
    }

    void (async () => {
      try {
        await onCreateMoodSchedule({
          moodName: scheduleMoodNameInput,
          groupId: scheduleGroupIdInput || null,
          intervalSeconds,
          firstRunAt,
          enabled: scheduleEnabledInput,
        });
        setScheduleFirstRunInput('');
        setStatusMessage(`Created schedule for "${scheduleMoodNameInput}".`);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown schedule create error';
        setStatusMessage(`Create schedule failed: ${message}`);
      }
    })();
  };

  const updateScheduleDraft = (scheduleId: string, patch: Partial<ScheduleDraft>) => {
    setScheduleDraftsById((previous) => {
      const current = previous[scheduleId];
      if (!current) {
        return previous;
      }
      return {
        ...previous,
        [scheduleId]: {
          ...current,
          ...patch,
        },
      };
    });
  };

  const handleResetScheduleDraft = (schedule: MoodSchedule) => {
    setScheduleDraftsById((previous) => ({
      ...previous,
      [schedule.id]: toScheduleDraft(schedule),
    }));
  };

  const handleSaveSchedule = (schedule: MoodSchedule) => {
    const draft = scheduleDraftsById[schedule.id] ?? toScheduleDraft(schedule);
    const intervalSeconds = Number.parseInt(draft.intervalSeconds, 10);
    if (!Number.isInteger(intervalSeconds) || intervalSeconds < 60) {
      setStatusMessage(`Schedule "${schedule.id}" interval must be >= 60 seconds.`);
      return;
    }
    const nextRunAt = localInputValueToTimestamp(draft.nextRunLocal);
    if (nextRunAt === null) {
      setStatusMessage(`Schedule "${schedule.id}" next run time is invalid.`);
      return;
    }

    const patch: MoodScheduleUpdateInput = {};
    if (draft.moodName !== schedule.moodName) {
      patch.moodName = draft.moodName;
    }
    const normalizedGroupId = draft.groupId || null;
    if (normalizedGroupId !== schedule.groupId) {
      patch.groupId = normalizedGroupId;
    }
    if (intervalSeconds !== schedule.intervalSeconds) {
      patch.intervalSeconds = intervalSeconds;
    }
    if (nextRunAt !== schedule.nextRunAt) {
      patch.nextRunAt = nextRunAt;
    }
    if (draft.enabled !== schedule.enabled) {
      patch.enabled = draft.enabled;
    }

    if (Object.keys(patch).length === 0) {
      setStatusMessage(`No changes to save for schedule "${schedule.id}".`);
      return;
    }

    void (async () => {
      try {
        await onUpdateMoodSchedule(schedule.id, patch);
        setStatusMessage(`Updated schedule "${schedule.id}".`);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown schedule update error';
        setStatusMessage(`Update schedule failed: ${message}`);
      }
    })();
  };

  const handleDeleteSchedule = (schedule: MoodSchedule) => {
    if (!window.confirm(`Delete schedule "${schedule.id}"?`)) {
      return;
    }
    void (async () => {
      try {
        await onDeleteMoodSchedule(schedule.id);
        setStatusMessage(`Deleted schedule "${schedule.id}".`);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown schedule delete error';
        setStatusMessage(`Delete schedule failed: ${message}`);
      }
    })();
  };

  const lastApply = moodApplyStatus.lastApply;

  return (
    <section className="rounded-lg border bg-white p-5 shadow-sm">
      <h3 className="text-lg font-semibold text-gray-900">Mood Studio</h3>
      <p className="mb-4 text-sm text-gray-600">
        Capture by labels from all endpoints or a selected group, then apply by label across endpoints.
      </p>

      <div className="mb-5 grid gap-3 rounded border border-gray-200 p-4 md:grid-cols-2">
        <label className="text-sm">
          <span className="mb-1 block font-medium text-gray-700">Mood Name</span>
          <input
            type="text"
            value={moodNameInput}
            onChange={(event) => {
              setMoodNameInput(event.target.value);
            }}
            className="w-full rounded border border-gray-300 px-3 py-2"
          />
        </label>
        <label className="text-sm">
          <span className="mb-1 block font-medium text-gray-700">Capture Scope</span>
          <select
            value={captureScope}
            onChange={(event) => {
              setCaptureScope(event.target.value);
            }}
            className="w-full rounded border border-gray-300 px-3 py-2"
          >
            <option value="">All Labeled Endpoints</option>
            {groups.map((group) => (
              <option key={`capture:${group.id}`} value={group.id}>
                {group.name}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm md:col-span-2">
          <span className="mb-1 block font-medium text-gray-700">Description</span>
          <input
            type="text"
            value={moodDescriptionInput}
            onChange={(event) => {
              setMoodDescriptionInput(event.target.value);
            }}
            className="w-full rounded border border-gray-300 px-3 py-2"
          />
        </label>
        <div className="md:col-span-2">
          <button
            type="button"
            onClick={handleSaveMood}
            className="rounded bg-emerald-600 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-700"
          >
            Capture Labels And Save Mood
          </button>
        </div>
      </div>

      <label className="mb-3 block text-sm">
        <span className="mb-1 block font-medium text-gray-700">Apply Scope</span>
        <select
          value={applyScope}
          onChange={(event) => {
            setApplyScope(event.target.value);
          }}
          className="w-full rounded border border-gray-300 px-3 py-2 md:w-80"
        >
          <option value="">All Labeled Endpoints</option>
          {groups.map((group) => (
            <option key={group.id} value={group.id}>
              {group.name}
            </option>
          ))}
        </select>
      </label>

      <div className="mb-5 rounded border border-indigo-200 bg-indigo-50 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h4 className="text-sm font-semibold text-indigo-900">Mood Scheduler</h4>
          <button
            type="button"
            onClick={handleRefreshSchedulerData}
            className="rounded border border-indigo-300 bg-white px-2 py-1 text-xs font-medium text-indigo-700 hover:bg-indigo-100"
          >
            Refresh
          </button>
        </div>
        <p className="mt-1 text-xs text-indigo-800">
          Auto-apply saved moods on an interval. Schedules run on the server and persist across reloads.
        </p>

        <div className="mt-3 rounded border border-indigo-200 bg-white p-3">
          <h5 className="text-xs font-semibold uppercase tracking-wide text-indigo-900">Last Apply</h5>
          {lastApply ? (
            <div className="mt-1 space-y-1 text-xs text-gray-700">
              <p>
                {lastApply.source === 'scheduled' ? 'Scheduled' : 'Manual'} at {timestampToText(lastApply.appliedAt)}
              </p>
              <p>
                Mood: <span className="font-medium">{lastApply.moodName}</span>
              </p>
              <p>Scope: {formatScope(groups, lastApply.groupId)}</p>
              <p>Result: {summarizeApplyReport(lastApply)}</p>
              {lastApply.scheduleId ? <p>Schedule: {lastApply.scheduleId}</p> : null}
            </div>
          ) : (
            <p className="mt-1 text-xs text-gray-600">No applies recorded yet.</p>
          )}
        </div>

        <div className="mt-3 grid gap-2 rounded border border-indigo-200 bg-white p-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_120px_220px_auto_auto]">
          <label className="text-xs font-medium text-gray-700">
            Mood
            <select
              value={scheduleMoodNameInput}
              onChange={(event) => {
                setScheduleMoodNameInput(event.target.value);
              }}
              className="mt-1 w-full rounded border border-gray-300 px-2 py-1 text-sm text-gray-900"
            >
              {moods.length === 0 ? <option value="">No moods available</option> : null}
              {moods.map((mood) => (
                <option key={`schedule-create-mood:${mood.name}`} value={mood.name}>
                  {mood.name}
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs font-medium text-gray-700">
            Scope
            <select
              value={scheduleGroupIdInput}
              onChange={(event) => {
                setScheduleGroupIdInput(event.target.value);
              }}
              className="mt-1 w-full rounded border border-gray-300 px-2 py-1 text-sm text-gray-900"
            >
              <option value="">All Labeled Endpoints</option>
              {groups.map((group) => (
                <option key={`schedule-create-group:${group.id}`} value={group.id}>
                  {group.name}
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs font-medium text-gray-700">
            Interval (sec)
            <input
              type="number"
              min={60}
              step={1}
              value={scheduleIntervalInput}
              onChange={(event) => {
                setScheduleIntervalInput(event.target.value);
              }}
              className="mt-1 w-full rounded border border-gray-300 px-2 py-1 text-sm text-gray-900"
            />
          </label>
          <label className="text-xs font-medium text-gray-700">
            First Run (optional)
            <input
              type="datetime-local"
              step={1}
              value={scheduleFirstRunInput}
              onChange={(event) => {
                setScheduleFirstRunInput(event.target.value);
              }}
              className="mt-1 w-full rounded border border-gray-300 px-2 py-1 text-sm text-gray-900"
            />
          </label>
          <label className="flex items-end gap-2 text-xs font-medium text-gray-700">
            <input
              type="checkbox"
              checked={scheduleEnabledInput}
              onChange={(event) => {
                setScheduleEnabledInput(event.target.checked);
              }}
              className="h-4 w-4 rounded border-gray-300"
            />
            Enabled
          </label>
          <button
            type="button"
            onClick={handleCreateSchedule}
            disabled={moods.length === 0}
            className="self-end rounded bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:bg-indigo-300"
          >
            Add Schedule
          </button>
        </div>

        <div className="mt-3 space-y-2">
          {moodSchedules.length === 0 ? (
            <p className="text-xs text-gray-700">No schedules configured.</p>
          ) : (
            moodSchedules.map((schedule) => {
              const draft = scheduleDraftsById[schedule.id] ?? toScheduleDraft(schedule);
              const hasMoodOption = moods.some((mood) => mood.name === draft.moodName);
              const hasGroupOption = draft.groupId === '' || groups.some((group) => group.id === draft.groupId);
              return (
                <article key={schedule.id} className="rounded border border-indigo-200 bg-white p-3">
                  <div className="mb-2 flex flex-wrap items-start justify-between gap-2">
                    <div className="text-xs text-gray-700">
                      <p className="font-semibold text-gray-900">{schedule.id}</p>
                      <p>
                        Next: {timestampToText(schedule.nextRunAt)} ({formatInterval(schedule.intervalSeconds)})
                      </p>
                      <p>Last run: {schedule.lastRunAt ? timestampToText(schedule.lastRunAt) : 'Never'}</p>
                      <p>Last result: {schedule.lastResult ? summarizeApplyReport(schedule.lastResult) : 'No runs yet'}</p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          handleSaveSchedule(schedule);
                        }}
                        className="rounded border border-indigo-300 px-2 py-1 text-xs font-medium text-indigo-700 hover:bg-indigo-50"
                      >
                        Save
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          handleResetScheduleDraft(schedule);
                        }}
                        className="rounded border border-gray-300 px-2 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50"
                      >
                        Reset
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          handleDeleteSchedule(schedule);
                        }}
                        className="rounded border border-red-300 px-2 py-1 text-xs font-medium text-red-700 hover:bg-red-50"
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                  <div className="grid gap-2 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_120px_220px_auto]">
                    <label className="text-xs font-medium text-gray-700">
                      Mood
                      <select
                        value={draft.moodName}
                        onChange={(event) => {
                          updateScheduleDraft(schedule.id, { moodName: event.target.value });
                        }}
                        className="mt-1 w-full rounded border border-gray-300 px-2 py-1 text-sm text-gray-900"
                      >
                        {!hasMoodOption && draft.moodName ? <option value={draft.moodName}>{draft.moodName}</option> : null}
                        {moods.map((mood) => (
                          <option key={`schedule-edit-mood:${schedule.id}:${mood.name}`} value={mood.name}>
                            {mood.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="text-xs font-medium text-gray-700">
                      Scope
                      <select
                        value={draft.groupId}
                        onChange={(event) => {
                          updateScheduleDraft(schedule.id, { groupId: event.target.value });
                        }}
                        className="mt-1 w-full rounded border border-gray-300 px-2 py-1 text-sm text-gray-900"
                      >
                        <option value="">All Labeled Endpoints</option>
                        {!hasGroupOption && draft.groupId ? (
                          <option value={draft.groupId}>Missing group ({draft.groupId})</option>
                        ) : null}
                        {groups.map((group) => (
                          <option key={`schedule-edit-group:${schedule.id}:${group.id}`} value={group.id}>
                            {group.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="text-xs font-medium text-gray-700">
                      Interval (sec)
                      <input
                        type="number"
                        min={60}
                        step={1}
                        value={draft.intervalSeconds}
                        onChange={(event) => {
                          updateScheduleDraft(schedule.id, { intervalSeconds: event.target.value });
                        }}
                        className="mt-1 w-full rounded border border-gray-300 px-2 py-1 text-sm text-gray-900"
                      />
                    </label>
                    <label className="text-xs font-medium text-gray-700">
                      Next Run
                      <input
                        type="datetime-local"
                        step={1}
                        value={draft.nextRunLocal}
                        onChange={(event) => {
                          updateScheduleDraft(schedule.id, { nextRunLocal: event.target.value });
                        }}
                        className="mt-1 w-full rounded border border-gray-300 px-2 py-1 text-sm text-gray-900"
                      />
                    </label>
                    <label className="flex items-end gap-2 text-xs font-medium text-gray-700">
                      <input
                        type="checkbox"
                        checked={draft.enabled}
                        onChange={(event) => {
                          updateScheduleDraft(schedule.id, { enabled: event.target.checked });
                        }}
                        className="h-4 w-4 rounded border-gray-300"
                      />
                      Enabled
                    </label>
                  </div>
                </article>
              );
            })
          )}
        </div>
      </div>

      <div className="space-y-3">
        {moods.map((mood) => {
          const detail = moodDetails[mood.name];
          const isDirty = dirtyMoodDetailsByName[mood.name] ?? false;
          const assignmentCount = detail ? Object.keys(detail.assignmentsByLabel).length : null;
          const sortedAssignments = detail
            ? Object.entries(detail.assignmentsByLabel).sort(([left], [right]) => left.localeCompare(right))
            : [];
          const firstLabel = sortedAssignments[0]?.[0] ?? '';
          const selectedCloneSource = cloneSourceByMood[mood.name] ?? firstLabel;
          const cloneTargetOptions = detail ? labels.filter((label) => !detail.assignmentsByLabel[label]) : [];
          const requestedCloneTarget = cloneTargetByMood[mood.name] ?? '';
          const selectedCloneTarget = cloneTargetOptions.includes(requestedCloneTarget)
            ? requestedCloneTarget
            : cloneTargetOptions[0] ?? '';
          return (
            <article
              key={mood.name}
              className={`rounded border p-3 transition-colors ${dirtyCardClass(isDirty, 'gray')}`}
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h4 className="font-semibold text-gray-900">{mood.name}</h4>
                  <p className="text-sm text-gray-600">{mood.description || '(no description)'}</p>
                  <p className="text-xs text-gray-500">Updated: {timestampToText(mood.timestamp)}</p>
                  <p className="text-xs text-gray-500">Assignments: {assignmentCount === null ? 'Not loaded' : assignmentCount}</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <DirtyBadge dirty={isDirty} className="py-1" />
                  <button
                    type="button"
                    onClick={() => {
                      handleLoadMoodDetail(mood.name);
                    }}
                    className="rounded border border-gray-300 px-2 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50"
                  >
                    Load Detail
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      handleSaveMoodDetail(mood.name);
                    }}
                    disabled={!detail || !isDirty}
                    className={`rounded border px-2 py-1 text-xs font-medium ${dirtyActionButtonClass(isDirty, 'gray')} disabled:cursor-not-allowed disabled:border-gray-200 disabled:text-gray-400`}
                  >
                    Save Edits
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      handleApplyMood(mood.name);
                    }}
                    disabled={isDirty}
                    className="rounded bg-blue-600 px-2 py-1 text-xs font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-blue-300"
                  >
                    Apply
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      handleDeleteMood(mood.name);
                    }}
                    className="rounded border border-red-300 px-2 py-1 text-xs font-medium text-red-700 hover:bg-red-50"
                  >
                    Delete
                  </button>
                </div>
              </div>
              {detail ? (
                <details className="mt-3">
                  <summary className="cursor-pointer text-sm font-medium text-gray-700 hover:text-gray-900">
                    Preview And Edit Assignments
                  </summary>
                  <div className="mt-3 space-y-3">
                    {sortedAssignments.map(([label, config]) => (
                      <div key={`${mood.name}:${label}`} className="rounded border border-slate-200 bg-slate-50 p-3">
                        <div className="mb-2 flex items-center justify-between gap-2">
                          <h5 className="text-sm font-semibold text-slate-900">{label}</h5>
                          <button
                            type="button"
                            onClick={() => {
                              handleRemoveMoodAssignment(mood.name, label);
                            }}
                            disabled={sortedAssignments.length <= 1}
                            className="rounded border border-red-300 px-2 py-0.5 text-xs font-medium text-red-700 hover:bg-red-50 disabled:cursor-not-allowed disabled:border-gray-200 disabled:text-gray-400"
                          >
                            Remove
                          </button>
                        </div>
                        <LedConfigEditor
                          config={config}
                          onChange={(patch) => {
                            onUpdateMoodAssignment(mood.name, label, patch);
                          }}
                        />
                      </div>
                    ))}
                    <div className="rounded border border-dashed border-slate-300 bg-white p-3">
                      <h5 className="mb-2 text-sm font-semibold text-slate-900">Add Assignment By Clone</h5>
                      <div className="grid gap-2 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
                        <label className="text-xs font-medium text-slate-700">
                          Clone Source
                          <select
                            value={selectedCloneSource}
                            onChange={(event) => {
                              setCloneSourceByMood((previous) => ({
                                ...previous,
                                [mood.name]: event.target.value,
                              }));
                            }}
                            className="mt-1 w-full rounded border border-slate-300 px-2 py-1 text-sm text-slate-900"
                          >
                            {sortedAssignments.map(([label]) => (
                              <option key={`clone-source:${mood.name}:${label}`} value={label}>
                                {label}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label className="text-xs font-medium text-slate-700">
                          Target Label
                          <select
                            value={selectedCloneTarget}
                            onChange={(event) => {
                              setCloneTargetByMood((previous) => ({
                                ...previous,
                                [mood.name]: event.target.value,
                              }));
                            }}
                            className="mt-1 w-full rounded border border-slate-300 px-2 py-1 text-sm text-slate-900"
                          >
                            {cloneTargetOptions.length === 0 ? <option value="">No labels available</option> : null}
                            {cloneTargetOptions.map((label) => (
                              <option key={`clone-target:${mood.name}:${label}`} value={label}>
                                {label}
                              </option>
                            ))}
                          </select>
                        </label>
                        <button
                          type="button"
                          onClick={() => {
                            handleCloneMoodAssignment(mood.name, firstLabel, selectedCloneTarget);
                          }}
                          disabled={firstLabel.length === 0 || selectedCloneTarget.length === 0}
                          className="self-end rounded border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:border-gray-200 disabled:text-gray-400"
                        >
                          Clone Add
                        </button>
                      </div>
                      <p className="mt-2 text-xs text-slate-500">Clone copies LED config from an existing label. Mood must keep at least one assignment.</p>
                    </div>
                  </div>
                </details>
              ) : null}
            </article>
          );
        })}
      </div>

      {statusMessage && <p className="mt-3 text-sm text-gray-700">{statusMessage}</p>}
    </section>
  );
}
