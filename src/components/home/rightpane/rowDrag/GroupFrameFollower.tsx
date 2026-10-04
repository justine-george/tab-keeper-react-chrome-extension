// A Chrome group's frame -- its title row and colour strip -- carried along
// with its tabs while a tab drags (KAN-165). Moved out of
// WindowEntryContainer unchanged (KAN-280 Part E) so the Open now pane's
// bands follow a drag exactly as a saved window's do; `scope` names the tab
// list whose drag it follows, which is `tabs` for a saved window.
import React, { useLayoutEffect, useRef } from 'react';

import { ADJACENT_GROUP_GAP_PX, BAND_MARGIN_PX } from '../bandSpacing';
import { useDragState } from './dragContext';

// KAN-165. Carries a group's frame along with its tabs.
//
// The engine translates individual tab rows. A group's title row and colour
// strip are not rows in that list, so nothing moved them, and members slid out
// through their own group -- measured, the first member of a three-tab group
// ended 2px ABOVE its own title.
//
// KAN-166 made this a LOOKUP rather than an inference. It used to ask whether
// every member had shifted alike and take that as the group having travelled,
// which cannot tell "passed over" from "gaining a first member" -- both shift
// every member alike, and they move the frame opposite ways. The area now
// counts this row in its own preview and reports its shift by name.
//
// Rendered INSIDE the drag area because that is the only place the live drag
// can be read; WindowEntryContainer itself sits outside the area's provider.
// It draws nothing.
//
// The two parts are moved through the DOM rather than by prop, because they are
// rendered in different places -- the strip by GroupColorPicker -- and
// threading a per-move offset into a component with no other reason to know
// about dragging would be worse than this. The offset changes only when the
// landing slot does, not on every pointer move.
export const GroupFrameFollower: React.FC<{
  groupId: string;
  scope: string;
}> = ({ groupId, scope }) => {
  const drag = useDragState(scope);
  // Both edges come from the drawn list, through one mechanism (KAN-175). The
  // bottom used to be DERIVED from the last member's shift, which assumes the
  // last member stays last -- false whenever the group is gaining or losing
  // one, and the strip then failed to cover a tab joining at the tail.
  const top = drag?.shifts[groupId] ?? 0;
  const bottom = drag?.shifts[`${groupId}:tail`] ?? 0;
  // KAN-169. The drop REMOVES this group: its only member is held outside it,
  // and the reducer will prune what is left. The rows below have already
  // closed up in `shifts`; what remains is to stop drawing a band the drop
  // takes away -- and not to grow it, which a title-row shift alone would.
  const removed = drag?.removedFixedRows.includes(groupId) ?? false;
  // Opened mid-drag (KAN-379): the title row appears at its shift.
  const appears = drag?.newlyMeasured.has(groupId) ?? false;
  const anchor = useRef<HTMLSpanElement | null>(null);

  useLayoutEffect(() => {
    const band = anchor.current?.closest<HTMLElement>('[data-band-id]');
    if (!band) return;
    // An attribute rather than inline styles, so the band's own stylesheet
    // says what a removed band looks like -- and the strip, drawn by
    // GroupColorPicker, can be reached from there without that component
    // learning anything about dragging.
    band.toggleAttribute('data-drag-removed', removed);
    if (removed) {
      band.style.paddingTop = '';
      band.style.paddingBottom = '';
      band.style.marginTop = '';
      band.style.marginBottom = '';
      delete band.dataset.bandGrewBy;
      band.style.setProperty('--frame-top', '0px');
      band.style.setProperty('--frame-bottom', '0px');
      const handle = band.querySelector<HTMLElement>(
        '[data-group-drag-handle]'
      );
      if (handle) {
        handle.style.transform = '';
        handle.style.transition = '';
      }
      return;
    }
    // The frame's EXTENT, published for the paint layers to read (KAN-171).
    // Custom properties rather than inline styles on each part, because the
    // strip is rendered by GroupColorPicker and these have to reach it without
    // that component learning anything about dragging.
    band.style.setProperty('--frame-top', `${top}px`);
    band.style.setProperty('--frame-bottom', `${bottom}px`);

    // The band's painted box has to cover the group the DROP will make, which
    // is a row taller than the one on screen while a tab is joining it. Its own
    // box cannot follow on its own: the title row moves by transform, and a
    // transform on a child never changes its parent's layout box. Measured, the
    // tint kept its resting 98..226 while the drop makes it 66..226, so the
    // title row sat above its own tint.
    //
    // PADDING PAIRED WITH NEGATIVE MARGIN, so the box grows while its content
    // and its contribution to the flow both stay where they were. The preview
    // deliberately holds the layout still, and a real height change would push
    // every row below the band.
    //
    // GROWTH ONLY: the tint paints for a group a tab is being dropped INTO, and
    // joining a group never makes it shorter. The strip handles both
    // directions, since it is also drawn while a tab is leaving.
    //
    // INLINE rather than in the stylesheet, because bandAt has to read the
    // padding back on every pointer move to keep the hit area still -- see the
    // note there, and `style.paddingTop` costs nothing next to a computed one.
    const growTop = Math.max(0, -top);
    const growBottom = Math.max(0, bottom);
    // The margin this band RESTS at, which is not the same for every band: one
    // that follows another group holds the wider KAN-179 gap. Borrowing against
    // the wrong number would quietly close that gap on the first preview.
    const restingTop = band.hasAttribute('data-after-group')
      ? ADJACENT_GROUP_GAP_PX
      : BAND_MARGIN_PX;
    // KAN-180. Where this band RESTS, measured rather than reconstructed, so
    // the hit test can subtract exactly what the growth moved.
    //
    // bandAt used to rebuild the resting top as `rect.top + paddingTop`, and
    // that is 2px wrong here: swapping the resting margin for a negative one
    // to absorb the padding also changes how it COLLAPSES with the row above,
    // so the box does not move by the amount the arithmetic assumes. Measured
    // on a band holding the KAN-179 gap: resting top 327, grown top 297 with
    // 32px of padding, so the rebuilt boundary came out 329.
    //
    // Two pixels is enough to LATCH. Above 327 the pointer marked the band,
    // which grew it and moved the boundary to 329; below 329 the same pointer
    // unmarked it, which shrank it back to 327. Measured at quarter-pixel
    // steps, the mark alternated on every move across that 2px.
    //
    // Cleared first and read back, which is one forced layout -- and this runs
    // when the LANDING changes, not on every pointer move.
    band.style.paddingTop = '';
    band.style.marginTop = '';
    const restingTopPx = band.getBoundingClientRect().top;

    band.style.paddingTop = growTop ? `${growTop}px` : '';
    band.style.paddingBottom = growBottom ? `${growBottom}px` : '';
    band.style.marginTop = growTop ? `${restingTop - growTop}px` : '';
    band.style.marginBottom = growBottom
      ? `${BAND_MARGIN_PX - growBottom}px`
      : '';

    // How far the growth moved the box, for bandAt to take back. Absent while
    // the band rests, so a band nothing is being dropped into costs nothing.
    const moved = restingTopPx - band.getBoundingClientRect().top;
    if (moved) band.dataset.bandGrewBy = String(moved);
    else delete band.dataset.bandGrewBy;

    // The title row is a real row and moves as one, so it keeps a transform.
    // The strip does NOT: it has to change length, not position, and a
    // transform cannot say that.
    const handle = band.querySelector<HTMLElement>('[data-group-drag-handle]');
    if (handle) {
      handle.style.transition = appears ? 'none' : '';
      handle.style.transform = top ? `translateY(${top}px)` : '';
    }
  }, [top, bottom, removed, appears]);

  return <span ref={anchor} hidden />;
};
