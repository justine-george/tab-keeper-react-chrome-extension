import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type RefObject,
} from 'react';

import {
  placeFree,
  sameFrame,
  type Box,
  type CoachFrame,
  type AnchoredPlacement,
  type Size,
} from '../components/tour/coachMarkPlacement';
import {
  ownBox,
  type AnchorBox,
  type Spotlight,
} from '../components/tour/anchorBox';

type Place = (
  anchor: Box,
  mark: Size,
  viewport: Size,
  bright: Box
) => AnchoredPlacement;

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

// KAN-900. Each element drawn for the selectors, with a box; one not rendered is skipped.
function openingBoxes(selectors: readonly string[]): Box[] {
  return selectors.flatMap((selector) =>
    [...document.querySelectorAll(selector)].flatMap((element) => {
      const box = ownBox(element);
      return box !== null && box.width > 0 && box.height > 0 ? [box] : [];
    })
  );
}

// KAN-413. Re-read every frame: scrolling, folding, renaming and drags move the anchor.
export function useCoachPlacement(
  markRef: RefObject<HTMLElement>,
  anchors: readonly string[],
  place: Place,
  boxOf: AnchorBox = ownBox,
  spotlight?: Spotlight,
  openings: readonly string[] = []
): CoachFrame | null {
  const [frame, setFrame] = useState<CoachFrame | null>(null);
  const placeRef = useRef(place);
  const boxOfRef = useRef(boxOf);
  const spotlightRef = useRef(spotlight);
  const openingsRef = useRef(openings);
  useLayoutEffect(() => {
    placeRef.current = place;
    boxOfRef.current = boxOf;
    spotlightRef.current = spotlight;
    openingsRef.current = openings;
  });
  const key = anchors.join('\n');

  useEffect(() => {
    const selectors = key === '' ? [] : key.split('\n');
    let id = 0;
    let scrolled = false;
    const read = () => {
      const found =
        selectors.length === 0
          ? null
          : firstAnchor(selectors, boxOfRef.current);
      const mark = markRef.current;
      // a step's anchor is brought into view once, when it starts.
      if (found !== null && !scrolled) {
        found.element.scrollIntoView({ block: 'nearest', inline: 'nearest' });
        scrolled = true;
      }
      let next: CoachFrame | null = null;
      if (mark !== null && selectors.length === 0) {
        next = {
          kind: 'free',
          placement: placeFree(
            { width: mark.offsetWidth, height: mark.offsetHeight },
            { width: window.innerWidth, height: window.innerHeight }
          ),
        };
      } else if (found !== null && mark !== null) {
        const box = found.box;
        const lit = spotlightRef.current;
        const spot =
          lit === undefined ? null : firstAnchor(lit.anchors, lit.boxOf);
        const bright = spot?.box ?? box;
        next = {
          kind: 'anchored',
          anchor: box,
          bright,
          openings: openingBoxes(openingsRef.current),
          placement: placeRef.current(
            box,
            { width: mark.offsetWidth, height: mark.offsetHeight },
            { width: window.innerWidth, height: window.innerHeight },
            bright
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
