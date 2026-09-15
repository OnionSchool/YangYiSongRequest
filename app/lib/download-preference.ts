const STORAGE_KEY_PREFIX = 'yy-download-method:';

export type DownloadPreference = 'download' | 'saveAs';

function storageKey(username: string): string {
  return `${STORAGE_KEY_PREFIX}${username}`;
}

export function readDownloadPreference(username: string): DownloadPreference | null {
  const value = localStorage.getItem(storageKey(username));
  return value === 'download' || value === 'saveAs' ? value : null;
}

export function saveDownloadPreference(username: string, mode: DownloadPreference): void {
  localStorage.setItem(storageKey(username), mode);
}
