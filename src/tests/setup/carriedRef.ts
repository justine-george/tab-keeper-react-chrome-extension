import { currentCarry } from '../../redux/carry';
import type { CarriedRef } from '../../redux/slices/tabContainerDataStateSlice';

// The current carry's saved ref; undefined with no carry, or a live one (KAN-280 Part F).
export function carriedRef(): CarriedRef | undefined {
  const item = currentCarry()?.item;
  return item?.source === 'saved' ? item.ref : undefined;
}
