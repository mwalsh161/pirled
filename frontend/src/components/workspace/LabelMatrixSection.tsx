import { PHYSICAL_PIR_COUNT, type KnownDevice } from '../../types';
import { type LedEndpoint } from '../../logical/types';

interface LabelMatrixSectionProps {
  devices: KnownDevice[];
  endpoints: LedEndpoint[];
  aliasesByDevice: Record<string, string>;
  pirAssignmentsByDevice: Record<string, number[]>;
  dirtyLabelDevices: Record<string, boolean>;
  onUpdateLabel: (endpointId: string, label: string) => void;
  onUpdateAlias: (deviceName: string, alias: string) => void;
  onAssignDefaultPir: (deviceName: string, ledIndex: number, pirIndex: number) => void;
  onSaveLabelsForDevice: (deviceName: string) => Promise<void>;
}

function groupEndpointsByDevice(endpoints: LedEndpoint[]): Map<string, LedEndpoint[]> {
  const grouped = new Map<string, LedEndpoint[]>();
  for (const endpoint of endpoints) {
    const current = grouped.get(endpoint.deviceName) ?? [];
    current.push(endpoint);
    grouped.set(endpoint.deviceName, current);
  }
  return grouped;
}

export default function LabelMatrixSection({
  devices,
  endpoints,
  aliasesByDevice,
  pirAssignmentsByDevice,
  dirtyLabelDevices,
  onUpdateLabel,
  onUpdateAlias,
  onAssignDefaultPir,
  onSaveLabelsForDevice,
}: LabelMatrixSectionProps) {
  const endpointsByDevice = groupEndpointsByDevice(endpoints);

  return (
    <section className="rounded-lg border bg-white p-5 shadow-sm">
      <h3 className="text-lg font-semibold text-gray-900">Label Matrix</h3>
      <p className="mb-4 text-sm text-gray-600">Rename LEDs to logical labels and persist by device.</p>
      <div className="grid gap-4 md:grid-cols-2">
        {devices.map((device) => {
          const aliasDraft = aliasesByDevice[device.name] ?? device.alias;
          const trimmedAlias = aliasDraft.trim();
          const deviceDisplayName = trimmedAlias.length > 0 ? trimmedAlias : device.name;
          const rows = [...(endpointsByDevice.get(device.name) ?? [])].sort((left, right) => left.ledIndex - right.ledIndex);
          const assignment = pirAssignmentsByDevice[device.name] ?? [0, 1, 2, 3];
          const hasUnsavedLabels = dirtyLabelDevices[device.name] ?? false;
          return (
            <article
              key={device.name}
              className={`rounded border p-4 transition-colors ${
                hasUnsavedLabels ? 'border-amber-300 bg-amber-50/40' : 'border-gray-200 bg-white'
              }`}
            >
              <div className="mb-3 flex items-center justify-between gap-3">
                <div>
                  <h4 className="flex items-center gap-2 font-semibold text-gray-900">
                    <span
                      className={`h-2 w-2 rounded-full transition-colors ${
                        device.resolved ? 'bg-emerald-500' : 'bg-gray-300'
                      }`}
                    />
                    {deviceDisplayName}
                  </h4>
                  <p className="text-xs text-gray-500">
                    {device.resolved ? 'Address resolved' : 'Address unresolved'}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    void onSaveLabelsForDevice(device.name);
                  }}
                  className={`rounded border px-2 py-1 text-xs font-medium ${
                    hasUnsavedLabels
                      ? 'border-amber-300 bg-amber-50 text-amber-800 hover:bg-amber-100'
                      : 'border-gray-300 text-gray-700 hover:bg-gray-50'
                  }`}
                >
                  Save Labels
                </button>
              </div>
              <label className="mb-3 block text-xs font-medium text-gray-600">
                Alias
                <input
                  type="text"
                  value={aliasDraft}
                  placeholder={device.name}
                  onChange={(event) => {
                    onUpdateAlias(device.name, event.target.value);
                  }}
                  className="mt-1 w-full rounded border border-gray-300 px-2 py-1 text-sm text-gray-900"
                />
              </label>
              <div className="space-y-2">
                {rows.map((endpoint) => {
                  return (
                    <div key={endpoint.id} className="rounded border border-gray-200 p-2">
                      <div className="flex items-center gap-2 text-sm">
                        <span className="w-16 text-gray-600">LED {endpoint.ledIndex}</span>
                        <input
                          type="text"
                          value={endpoint.label}
                          placeholder="Unused"
                          onChange={(event) => {
                            onUpdateLabel(endpoint.id, event.target.value);
                          }}
                          className="w-full rounded border border-gray-300 px-2 py-1"
                        />
                      </div>
                      <p className="pl-16 pt-1 text-xs text-gray-500">Leave blank to mark unused.</p>
                      <div className="mt-2 flex items-center gap-3 pl-16 text-xs text-gray-600">
                        <span className="font-medium text-gray-500">Default PIR:</span>
                        {Array.from({ length: PHYSICAL_PIR_COUNT }, (_, pirIndex) => {
                          const isChecked = assignment[pirIndex] === endpoint.ledIndex;
                          return (
                            <label key={`${endpoint.id}:pir:${pirIndex}`} className="flex items-center gap-1">
                              <input
                                type="checkbox"
                                checked={isChecked}
                                onChange={(event) => {
                                  if (!event.target.checked) {
                                    return;
                                  }
                                  onAssignDefaultPir(device.name, endpoint.ledIndex, pirIndex);
                                }}
                              />
                              PIR {pirIndex}
                            </label>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}
