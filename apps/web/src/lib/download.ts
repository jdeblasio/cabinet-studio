/** Save a file in the browser (an object URL on a temporary link). */
export function downloadFile(name: string, data: BlobPart, type: string): void {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** A file-name-safe slug, e.g. "Living Room" → "living-room". */
export function fileSlug(name: string, fallback = 'built-in'): string {
  return name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || fallback;
}
