import React, { useEffect, useLayoutEffect, useRef } from 'react';
import { createPortal } from 'react-dom';

import { MenuPanel, type OverflowMenuItem } from '../MenuPanel';
import { useMenuList } from '../../../hooks/useMenuList';
import { placeMenu, VIEWPORT_GUTTER_PX } from './placeMenu';
import type { RowMenuTarget } from './rowMenuStore';

export type RowMenuCloseReason = 'chosen' | 'outside' | 'escape' | 'away';

// KAN-708. Hidden until placed; the layout effect writes left/top before the first paint.
const POSITION_CSS = `
  position: fixed;
  left: 0;
  top: 0;
  visibility: hidden;
`;

// KAN-708. A row's ⋮ items at a point, portalled over every pane; a scroll, resize or blur closes it as 'away'.
export function RowContextMenu({
  target,
  ariaLabel,
  items,
  onClose,
}: {
  target: RowMenuTarget;
  ariaLabel: string;
  items: OverflowMenuItem[];
  onClose: (reason: RowMenuCloseReason) => void;
}): React.ReactElement {
  const menuRef = useRef<HTMLDivElement>(null);

  // KAN-708. The window listeners must not re-bind on every render for a fresh closure.
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });

  const { x, y } = target.at;
  // KAN-708. Items follow the live row, so one appearing or relabelled places the menu again.
  const contents = items.map((item) => `${item.key}:${item.label}`).join('\n');
  useLayoutEffect(() => {
    const el = menuRef.current;
    if (el === null) return;
    const rect = el.getBoundingClientRect();
    const { left, top } = placeMenu(
      { x, y },
      { width: rect.width, height: rect.height },
      { width: window.innerWidth, height: window.innerHeight },
      VIEWPORT_GUTTER_PX
    );
    el.style.left = `${left}px`;
    el.style.top = `${top}px`;
    el.style.visibility = 'visible';
  }, [x, y, contents]);

  useEffect(() => {
    const away = () => onCloseRef.current('away');
    window.addEventListener('resize', away);
    window.addEventListener('blur', away);
    // KAN-708. Capture: scroll does not bubble, and a scroll of any pane counts.
    document.addEventListener('scroll', away, true);
    return () => {
      window.removeEventListener('resize', away);
      window.removeEventListener('blur', away);
      document.removeEventListener('scroll', away, true);
    };
  }, []);

  const { registerItem, handleKeyDown } = useMenuList({
    count: items.length,
    axis: 'vertical',
    isOpen: true,
    wrapperRef: menuRef,
    onDismiss: onClose,
  });

  return createPortal(
    <MenuPanel
      menuRef={menuRef}
      ariaLabel={ariaLabel}
      items={items}
      registerItem={registerItem}
      handleKeyDown={handleKeyDown}
      close={() => onClose('chosen')}
      positionCss={POSITION_CSS}
      dataRowMenu
    />,
    document.body
  );
}
