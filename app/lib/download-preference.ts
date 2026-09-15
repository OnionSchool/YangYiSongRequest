const STORAGE_KEY_PREFIX = 'yy-download-mode:';

export type DownloadPreference = 'direct' | 'proxy';

function storageKey(username: string): string {
  return `${STORAGE_KEY_PREFIX}${username}`;
}

export function readDownloadPreference(username: string): DownloadPreference | null {
  const value = localStorage.getItem(storageKey(username));
  return value === 'direct' || value === 'proxy' ? value : null;
}

export function saveDownloadPreference(username: string, mode: DownloadPreference): void {
  localStorage.setItem(storageKey(username), mode);
}
