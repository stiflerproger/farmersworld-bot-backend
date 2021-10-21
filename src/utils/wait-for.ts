export function randomInterval(min: number, max?: number): number {
  if (max == null) {
    max = min;
  } else if (max < min) {
    throw new Error('max cannot be less than min value');
  }

  return Math.max(0, Math.floor(Math.random() * (max - min + 1)) + min) || 0;
}

export function waitFor(min: number, max?: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, randomInterval(min, max));
  });
}
