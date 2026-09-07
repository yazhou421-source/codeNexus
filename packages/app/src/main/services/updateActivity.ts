// Count local filesystem mutations so updater cannot quit between async writes.
let pending = 0;
export function hasPendingUpdateWork(): boolean {
  return pending > 0;
}
export async function protectUpdateWork<T>(operation: () => Promise<T>): Promise<T> {
  pending++;
  try {
    return await operation();
  } finally {
    pending--;
  }
}
