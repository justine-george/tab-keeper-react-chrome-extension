import type { OverflowMenuItem } from '../MenuPanel';

// KAN-805. A window or group ⋮'s items for its right-click, whose top row already holds Rename.
export function withoutRename(items: OverflowMenuItem[]): OverflowMenuItem[] {
  return items.filter((item) => item.key !== 'rename');
}
