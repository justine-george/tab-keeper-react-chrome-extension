export type PreviewFrom = 'full' | 'popup';

// KAN-880. No `from` (a pre-update tab reloaded) or any other value reads as the full view.
export function previewFrom(search: string): PreviewFrom {
  return new URLSearchParams(search).get('from') === 'popup' ? 'popup' : 'full';
}

// Appends the opener to the preview's address, `?` or `&` as the path needs.
export function withPreviewFrom(path: string, from: PreviewFrom): string {
  return `${path}${path.includes('?') ? '&' : '?'}from=${from}`;
}
