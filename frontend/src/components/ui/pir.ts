export function getPirLabel(labels: string[], pirIndex: number): string {
  if (pirIndex >= 8) {
    return `PIR R${pirIndex - 8}`;
  }
  if (pirIndex >= 4) {
    return `PIR V${pirIndex - 4}`;
  }
  const configuredLabel = labels[pirIndex]?.trim() ?? '';
  return configuredLabel.length > 0 ? configuredLabel : `PIR ${pirIndex}`;
}

export function isMaskEnabled(mask: number, pirIndex: number): boolean {
  return (mask & (1 << pirIndex)) !== 0;
}
