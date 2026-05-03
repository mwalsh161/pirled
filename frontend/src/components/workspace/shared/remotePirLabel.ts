import { toDeviceUri } from '../../../logical/types';
import { type ResolvedDevice } from '../../../types';

export function deviceDisplayName(device: ResolvedDevice): string {
  return device.alias.trim().length > 0 ? device.alias : device.name;
}

export function formatRemotePirLabel(
  sourceHost: string,
  sourcePirIndex: number,
  devicesByName: Record<string, ResolvedDevice>,
  pirLabelsByDeviceUri: Record<string, string[]>,
  fallbackLabel = `PIR ${sourcePirIndex}`
): string {
  if (sourceHost.trim().length === 0) {
    return 'Unassigned';
  }

  const sourceDevice = devicesByName[sourceHost];
  const sourceName = sourceDevice ? deviceDisplayName(sourceDevice) : sourceHost;
  const sourceDeviceUri = sourceDevice ? toDeviceUri(sourceDevice) : null;
  const sourcePirLabel =
    (sourceDeviceUri ? pirLabelsByDeviceUri[sourceDeviceUri]?.[sourcePirIndex] : undefined) ?? fallbackLabel;
  return `${sourceName} / ${sourcePirLabel}`;
}
