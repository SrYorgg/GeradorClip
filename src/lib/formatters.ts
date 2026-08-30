export function formatDuration(seconds: number) {
  if (!Number.isFinite(seconds) || seconds <= 0) {
    return '0:00';
  }

  const totalSeconds = Math.round(seconds);
  const minutes = Math.floor(totalSeconds / 60);
  const remainingSeconds = (totalSeconds % 60).toString().padStart(2, '0');

  return `${minutes}:${remainingSeconds}`;
}

export function formatMinutes(seconds: number) {
  if (!Number.isFinite(seconds) || seconds <= 0) {
    return '0 min';
  }

  return `${Math.max(1, Math.round(seconds / 60))} min`;
}

export function formatFileSize(bytes: number) {
  if (!Number.isFinite(bytes) || bytes < 0) {
    return '0.0 MB';
  }

  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
