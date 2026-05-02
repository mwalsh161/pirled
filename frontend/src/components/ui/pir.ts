export function getPirLabel(labels: string[], pirIndex: number): string {
  const configuredLabel = labels[pirIndex]?.trim() ?? '';
  if (configuredLabel.length > 0) {
    return configuredLabel;
  }
  if (pirIndex >= 8) {
    return `PIR R${pirIndex - 8}`;
  }
  if (pirIndex >= 4) {
    return `PIR V${pirIndex - 4}`;
  }
  return `PIR ${pirIndex}`;
}

export function isMaskEnabled(mask: number, pirIndex: number): boolean {
  return (mask & (1 << pirIndex)) !== 0;
}
