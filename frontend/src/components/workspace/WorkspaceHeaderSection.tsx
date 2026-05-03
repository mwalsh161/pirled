interface WorkspaceStatus {
  tone: 'idle' | 'success' | 'error' | 'working';
  message: string;
}

interface WorkspaceHeaderSectionProps {
  status: WorkspaceStatus;
  hasUnsavedLabelChanges: boolean;
  dirtyLabelDeviceCount: number;
  deviceCacheRefreshedAt: number | null;
  showRefreshMoods: boolean;
  onRefreshDeviceCache: () => Promise<void>;
  onRefreshMoods: () => Promise<void>;
}

function statusClassName(tone: WorkspaceStatus['tone']): string {
  if (tone === 'success') {
    return 'border-green-200 bg-green-50 text-green-800';
  }
  if (tone === 'error') {
    return 'border-red-200 bg-red-50 text-red-800';
  }
  if (tone === 'working') {
    return 'border-blue-200 bg-blue-50 text-blue-800';
  }
  return 'border-gray-200 bg-gray-50 text-gray-700';
}

function formatCacheTimestamp(timestamp: number | null): string {
  if (timestamp === null) {
    return 'Never';
  }
  return new Date(timestamp).toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export default function WorkspaceHeaderSection({
  status,
  hasUnsavedLabelChanges,
  dirtyLabelDeviceCount,
  deviceCacheRefreshedAt,
  showRefreshMoods,
  onRefreshDeviceCache,
  onRefreshMoods,
}: WorkspaceHeaderSectionProps) {
  return (
    <section className="rounded-lg border bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold text-gray-900">Logical Workspace</h2>
          <p className="text-sm text-gray-600">
            Labels and groups are your source of intent. Moods target labels, not device indices.
          </p>
        </div>
        <div className="flex gap-2">
          {showRefreshMoods ? (
            <button
              type="button"
              onClick={() => {
                void onRefreshMoods();
              }}
              className="rounded border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
            >
              Refresh Moods
            </button>
          ) : null}
        </div>
      </div>
      <div className="mt-3 flex min-h-5 items-center gap-2 text-xs text-amber-700">
        <span
          className={`h-2 w-2 rounded-full transition-colors ${
            hasUnsavedLabelChanges ? 'bg-amber-500' : 'bg-transparent'
          }`}
        />
        <span className={hasUnsavedLabelChanges ? 'opacity-100' : 'opacity-0'}>
          Unsaved label changes on {dirtyLabelDeviceCount} device{dirtyLabelDeviceCount === 1 ? '' : 's'}.
        </span>
      </div>
      <div className={`mt-4 rounded border px-3 py-2 text-sm ${statusClassName(status.tone)}`}>{status.message}</div>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-gray-100 pt-3 text-xs text-gray-600">
        <span>Device cache last refreshed: {formatCacheTimestamp(deviceCacheRefreshedAt)}</span>
        <button
          type="button"
          onClick={() => {
            void onRefreshDeviceCache();
          }}
          className="rounded border border-gray-300 bg-white px-2.5 py-1 font-medium text-gray-700 hover:bg-gray-50"
        >
          Refresh Device Cache
        </button>
      </div>
    </section>
  );
}
