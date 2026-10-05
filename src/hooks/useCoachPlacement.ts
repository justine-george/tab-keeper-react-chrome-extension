import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type RefObject,
} from 'react';

import {
  sameFrame,
  type Box,
  type CoachFrame,
  type CoachPlacement,
  type Size,
} from '../components/tour/coachMarkPlacement';
import { ownBox, type AnchorBox } from '../components/tour/anchorBox';

type Place = (anchor: Box, mark: Size, viewport: Size) => CoachPlacement;

// The first anchor drawn with a box; one folded away or not rendered is skipped.
function firstAnchor(
  selectors: readonly string[],
  boxOf: AnchorBox
): { element: Element; box: Box } | null {
  for (const selector of selectors) {
    const element = document.querySelector(selector);
    const box = element === null ? null : boxOf(element);
    if (element !== null && box !== null && box.width > 0 && box.height > 0) {
      return { element, box };
    }
  }
  return null;
}

// KAN-413. Re-read every frame: scrolling, folding, renaming and drags move the anchor.
export function useCoachPlacement(
  markRef: RefObject<HTMLElement>,
  anchors: readonly string[],
  place: Place,
  boxOf: AnchorBox = ownBox
): CoachFrame | null {
  const [frame, setFrame] = useState<CoachFrame | null>(null);
  const placeRef = useRef(place);
  const boxOfRef = useRef(boxOf);
  useLayoutEffect(() => {
    placeRef.current = place;
    boxOfRef.current = boxOf;
  });
  const key = anchors.join('\n');

  useEffect(() => {
    const selectors = key.split('\n');
    let id = 0;
    let scrolled = false;
    const read = () => {
      const found = firstAnchor(selectors, boxOfRef.current);
      const mark = markRef.current;
      // a step's anchor is brought into view once, when it starts.
      if (found !== null && !scrolled) {
        found.element.scrollIntoView({ block: 'nearest', inline: 'nearest' });
        scrolled = true;
      }
      let next: CoachFrame | null = null;
      if (found !== null && mark !== null) {
        const box = found.box;
        next = {
          anchor: box,
          placement: placeRef.current(
            box,
            { width: mark.offsetWidth, height: mark.offsetHeight },
            { width: window.innerWidth, height: window.innerHeight }
          ),
        };
      }
      setFrame((previous) => (sameFrame(previous, next) ? previous : next));
      id = requestAnimationFrame(read);
    };
    id = requestAnimationFrame(read);
    return () => cancelAnimationFrame(id);
  }, [key, markRef]);

  return frame;
}
