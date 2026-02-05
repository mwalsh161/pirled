import { useState } from 'react';
import { type ApplyReport, type LogicalGroup, type MoodDetail, type MoodSummary } from '../../logical/types';

interface SaveMoodInput {
  name: string;
  description: string;
  captureGroupId: string | null;
}

interface MoodStudioSectionProps {
  groups: LogicalGroup[];
  moods: MoodSummary[];
  moodDetails: Record<string, MoodDetail>;
  onSaveMood: (input: SaveMoodInput) => Promise<void>;
  onLoadMoodDetail: (moodName: string) => Promise<MoodDetail>;
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
  groups,
  moods,
  moodDetails,
  onSaveMood,
  onLoadMoodDetail,
  onApplyMood,
  onRemoveMood,
}: MoodStudioSectionProps) {
  const [moodNameInput, setMoodNameInput] = useState('');
  const [moodDescriptionInput, setMoodDescriptionInput] = useState('');
  const [captureScope, setCaptureScope] = useState('');
  const [applyScope, setApplyScope] = useState('');
  const [lastApplyReport, setLastApplyReport] = useState('');

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
          const assignmentCount = detail ? Object.keys(detail.assignmentsByLabel).length : null;
          return (
            <article key={mood.name} className="rounded border border-gray-200 p-3">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h4 className="font-semibold text-gray-900">{mood.name}</h4>
                  <p className="text-sm text-gray-600">{mood.description || '(no description)'}</p>
                  <p className="text-xs text-gray-500">Updated: {timestampToText(mood.timestamp)}</p>
                  <p className="text-xs text-gray-500">Assignments: {assignmentCount === null ? 'Not loaded' : assignmentCount}</p>
                </div>
                <div className="flex flex-wrap gap-2">
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
                      handleApplyMood(mood.name);
                    }}
                    className="rounded bg-blue-600 px-2 py-1 text-xs font-medium text-white hover:bg-blue-700"
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
            </article>
          );
        })}
      </div>

      {lastApplyReport && <p className="mt-3 text-sm text-gray-700">{lastApplyReport}</p>}
    </section>
  );
}
