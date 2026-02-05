import { useState } from 'react';
import { type LogicalGroup } from '../../logical/types';

interface GroupsSectionProps {
  labels: string[];
  groups: LogicalGroup[];
  onCreateGroup: (name: string, selectedLabels: string[]) => void;
  onDeleteGroup: (groupId: string) => void;
}

export default function GroupsSection({ labels, groups, onCreateGroup, onDeleteGroup }: GroupsSectionProps) {
  const [groupNameInput, setGroupNameInput] = useState('');
  const [groupLabelSelections, setGroupLabelSelections] = useState<Record<string, boolean>>({});

  const handleCreateGroup = () => {
    const selectedLabels = Object.entries(groupLabelSelections)
      .filter(([, selected]) => selected)
      .map(([label]) => label);
    onCreateGroup(groupNameInput, selectedLabels);
    setGroupNameInput('');
    setGroupLabelSelections({});
  };

  return (
    <section className="rounded-lg border bg-white p-5 shadow-sm">
      <h3 className="text-lg font-semibold text-gray-900">Groups</h3>
      <p className="mb-4 text-sm text-gray-600">Create reusable logical scopes from labels.</p>

      <div className="mb-4 grid gap-4 rounded border border-gray-200 p-4 md:grid-cols-2">
        <div className="space-y-2">
          <label className="block text-sm font-medium text-gray-700" htmlFor="group-name">
            Group Name
          </label>
          <input
            id="group-name"
            type="text"
            value={groupNameInput}
            onChange={(event) => {
              setGroupNameInput(event.target.value);
            }}
            className="w-full rounded border border-gray-300 px-3 py-2"
            placeholder="Entryway, Upstairs, Ambience..."
          />
        </div>
        <div>
          <p className="mb-2 text-sm font-medium text-gray-700">Labels in Group</p>
          <div className="max-h-36 space-y-1 overflow-y-auto rounded border border-gray-200 p-2">
            {labels.length === 0 ? (
              <p className="text-sm text-gray-500">No labels yet.</p>
            ) : (
              labels.map((label) => (
                <label key={label} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={groupLabelSelections[label] ?? false}
                    onChange={(event) => {
                      setGroupLabelSelections((previous) => ({
                        ...previous,
                        [label]: event.target.checked,
                      }));
                    }}
                  />
                  <span>{label}</span>
                </label>
              ))
            )}
          </div>
        </div>
        <div className="md:col-span-2">
          <button
            type="button"
            onClick={handleCreateGroup}
            className="rounded bg-gray-900 px-3 py-2 text-sm font-medium text-white hover:bg-gray-800"
          >
            Create Group
          </button>
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        {groups.map((group) => (
          <div key={group.id} className="rounded border border-gray-200 p-3">
            <div className="mb-2 flex items-center justify-between">
              <h4 className="font-semibold text-gray-900">{group.name}</h4>
              <button
                type="button"
                onClick={() => {
                  onDeleteGroup(group.id);
                }}
                className="text-xs font-medium text-red-600 hover:text-red-700"
              >
                Delete
              </button>
            </div>
            <div className="flex flex-wrap gap-1">
              {group.labels.length === 0 ? (
                <span className="text-sm text-gray-500">No labels assigned.</span>
              ) : (
                group.labels.map((label) => (
                  <span key={label} className="rounded bg-gray-100 px-2 py-1 text-xs text-gray-700">
                    {label}
                  </span>
                ))
              )}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
