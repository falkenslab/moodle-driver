// Reading at a person's pace (ADR-012): about 240 words a minute, bounded per page.
const WORDS_PER_SECOND = 4;
const MIN_SECONDS = 3;
const MAX_SECONDS = 90;
const PROGRESS_EVERY_MS = 5000;

/** How long a person would take to read `text`, in seconds. */
export function readingSeconds(text: string): number {
  const words = text.split(/\s+/).filter(Boolean).length;
  return Math.min(MAX_SECONDS, Math.max(MIN_SECONDS, Math.round(words / WORDS_PER_SECOND)));
}

/** Waits `seconds`, calling `onProgress` every few seconds so clients keep waiting. */
export async function pause(seconds: number, onProgress?: (elapsedSeconds: number) => void): Promise<void> {
  const end = Date.now() + seconds * 1000;
  while (Date.now() < end) {
    await new Promise((resolve) => setTimeout(resolve, Math.min(PROGRESS_EVERY_MS, end - Date.now())));
    onProgress?.(Math.round(seconds - (end - Date.now()) / 1000));
  }
}
