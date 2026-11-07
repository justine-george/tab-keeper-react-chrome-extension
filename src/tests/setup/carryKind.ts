import { listKindOf, pickOf, savedItem } from '../../redux/carriedItem';
import type { CarriedRef } from '../../redux/slices/tabContainerDataStateSlice';

// The kind the engine publishes for a carried ref: the list that drags it.
export const dragKindOf = (ref: CarriedRef) =>
  listKindOf(pickOf(savedItem(ref)));
