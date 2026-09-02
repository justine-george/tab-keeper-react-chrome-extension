import { useLayoutEffect } from 'react';

import { useThemeColors } from './useThemeColors';

// The two parts of theming that emotion cannot reach, both driven by the same
// change and both written to the document root (KAN-22).
//
// 1. Global pseudo-elements. `::-webkit-scrollbar` has no element to attach a
//    css`` class to, so App.css styled it with literal hex values that never
//    tracked the theme -- the scrollbar stayed light grey in all five, including
//    the two dark ones. The SCROLLBAR_* tokens already existed on every theme
//    and had no consumer; this publishes them as custom properties so the
//    stylesheet can read them.
//
// 2. Transition suppression. Seven components declare
//    `transition: background-color 0.2s` at the top level of their styles
//    rather than inside `&:hover`, so a theme change animated every icon,
//    button and row over 200ms and read as lag on the left pane.
//
//    The obvious fix -- move each transition inside `&:hover` -- is worse than
//    the bug: a transition declared only in the hover rule stops existing the
//    moment the pointer leaves, so the element fades in and snaps out. This
//    suppresses transitions globally for the duration of the swap instead,
//    which keeps hover symmetric and, being one rule, stays correct as
//    components are added. FocusConfirmModal picked up the same pattern after
//    KAN-22 was filed, which is the argument against fixing it per file.
//
// useLayoutEffect, not useEffect: the flag has to be on the element in the same
// commit that changes the colours. One frame late and the transition has
// already begun, which is the entire defect.
export function useDocumentTheme(): void {
  const COLORS = useThemeColors();

  useLayoutEffect(() => {
    const root = document.documentElement;

    root.setAttribute('data-theme-switching', '');

    root.style.setProperty('--scrollbar-track', COLORS.SCROLLBAR_TRACK);
    root.style.setProperty('--scrollbar-thumb', COLORS.SCROLLBAR_THUMB);
    root.style.setProperty(
      '--scrollbar-thumb-hover',
      COLORS.SCROLLBAR_THUMB_HOVER
    );

    // 3. body's background (KAN-49), same reason as the scrollbar: body is not
    //    reachable from an emotion class either. It had a hardcoded `grey`
    //    that never tracked the theme, and <html> has no background of its
    //    own, so that grey painted whatever viewport area the 790x550 app box
    //    did not cover.
    root.style.setProperty('--app-background', COLORS.PRIMARY_COLOR);

    // Two frames, not one: the first only guarantees the new styles are
    // computed, the second that they have been painted. Releasing after one
    // still let the tail of the change animate on slower frames.
    let inner = 0;
    const outer = requestAnimationFrame(() => {
      inner = requestAnimationFrame(() =>
        root.removeAttribute('data-theme-switching')
      );
    });

    // Without this, unmounting mid-swap (closing the popup during a theme
    // change) would leave the attribute set. It is on <html>, which outlives
    // React, so every transition in the app would stay dead on the next mount.
    return () => {
      cancelAnimationFrame(outer);
      cancelAnimationFrame(inner);
      root.removeAttribute('data-theme-switching');
    };
    // COLORS is one of the frozen module-level theme objects, so this is a
    // stable reference that changes only when the theme actually changes.
  }, [COLORS]);
}
