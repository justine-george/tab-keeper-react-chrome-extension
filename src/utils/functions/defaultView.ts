// KAN-7 §7. What a click on the toolbar icon opens. Worker-safe, like popOut.ts:
// no window, no redux, chrome types only.

export type DefaultView = 'compact' | 'full';

export function asDefaultView(value: unknown): DefaultView {
  return value === 'full' ? 'full' : 'compact';
}
