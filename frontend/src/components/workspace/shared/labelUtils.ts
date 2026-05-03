import { type LedEndpoint, type LogicalGroup } from '../../../logical/types';

export function normalizeLabel(label: string): string {
  return label.trim();
}

export function buildEndpointsByLabel(endpoints: LedEndpoint[]): Map<string, LedEndpoint[]> {
  const endpointsByLabel = new Map<string, LedEndpoint[]>();
  for (const endpoint of endpoints) {
    const label = normalizeLabel(endpoint.label);
    if (!label) {
      continue;
    }
    const current = endpointsByLabel.get(label) ?? [];
    current.push(endpoint);
    endpointsByLabel.set(label, current);
  }
  return endpointsByLabel;
}

export function buildGroupedLabelSet(groups: LogicalGroup[]): Set<string> {
  const groupedLabelSet = new Set<string>();
  for (const group of groups) {
    for (const label of group.labels) {
      const normalized = normalizeLabel(label);
      if (normalized) {
        groupedLabelSet.add(normalized);
      }
    }
  }
  return groupedLabelSet;
}
