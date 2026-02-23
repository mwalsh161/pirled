import { useState } from 'react';
import { type ApplyReport, type LogicalGroup, type MoodDetail, type MoodSummary } from '../../logical/types';
import { type LedConfigUpdate } from '../../types';
import LedConfigEditor from '../live/LedConfigEditor';
import { DirtyBadge, dirtyActionButtonClass, dirtyCardClass } from '../ui/dirtyState';

interface SaveMoodInput {
  name: string;
  description: string;
  captureGroupId: string | null;
}

interface MoodStudioSectionProps {
  labels: string[];
  groups: LogicalGroup[];
  moods: MoodSummary[];
  moodDetails: Record<string, MoodDetail>;
  dirtyMoodDetailsByName: Record<string, boolean>;
  onSaveMood: (input: SaveMoodInput) => Promise<void>;
  onLoadMoodDetail: (moodName: string) => Promise<MoodDetail>;
  onUpdateMoodAssignment: (moodName: string, label: string, patch: LedConfigUpdate) => void;
  onCloneMoodAssignment: (moodName: string, sourceLabel: string, newLabel: string) => void;
  onRemoveMoodAssignment: (moodName: string, label: string) => void;
  onSaveMoodDetail: (moodName: string) => Promise<void>;
  onApplyMood: (moodName: string, groupId: string | null) => Promise<ApplyReport>;
  onRemoveMood: (moodName: string) => Promise<void>;
}

function timestampToText(timestamp?: number): string {
  if (!timestamp) {
    return 'Unknown';
  }
  return new Date(timestamp * 1000).toLocaleString();
}

export default function MoodStudioSection({
  labels,
  groups,
  moods,
  moodDetails,
  dirtyMoodDetailsByName,
  onSaveMood,
  onLoadMoodDetail,
  onUpdateMoodAssignment,
  onCloneMoodAssignment,
  onRemoveMoodAssignment,
  onSaveMoodDetail,
  onApplyMood,
  onRemoveMood,
}: MoodStudioSectionProps) {
  const [moodNameInput, setMoodNameInput] = useState('');
  const [moodDescriptionInput, setMoodDescriptionInput] = useState('');
  const [captureScope, setCaptureScope] = useState('');
  const [applyScope, setApplyScope] = useState('');
  const [lastApplyReport, setLastApplyReport] = useState('');
  const [cloneSourceByMood, setCloneSourceByMood] = useState<Record<string, string>>({});
  const [cloneTargetByMood, setCloneTargetByMood] = useState<Record<string, string>>({});

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
        setLastApplyReport(`Save failed: ${message}`);
      }
    })();
  };

  const handleLoadMoodDetail = (moodName: string) => {
    void (async () => {
      try {
        await onLoadMoodDetail(moodName);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown mood detail error';
        setLastApplyReport(`Load detail failed: ${message}`);
      }
    })();
  };

  const handleApplyMood = (moodName: string) => {
    if (dirtyMoodDetailsByName[moodName]) {
      setLastApplyReport(`Save edits for "${moodName}" before apply.`);
      return;
    }

    void (async () => {
      try {
        const report = await onApplyMood(moodName, applyScope || null);
        setLastApplyReport(
          report.failureCount > 0
            ? `Applied with failures: ${report.failureCount} failed, ${report.successCount} successful.`
            : `Applied successfully to ${report.successCount} endpoints.`
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown mood apply error';
        setLastApplyReport(`Apply failed: ${message}`);
      }
    })();
  };

  const handleSaveMoodDetail = (moodName: string) => {
    void (async () => {
      try {
        await onSaveMoodDetail(moodName);
        setLastApplyReport(`Saved edits for "${moodName}".`);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown mood detail save error';
        setLastApplyReport(`Save edits failed: ${message}`);
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
        setLastApplyReport(`Delete failed: ${message}`);
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
      setLastApplyReport(`Add assignment failed: ${message}`);
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
      setLastApplyReport(`Remove assignment failed: ${message}`);
    }
  };

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

      {lastApplyReport && <p className="mt-3 text-sm text-gray-700">{lastApplyReport}</p>}
    </section>
  );
}
