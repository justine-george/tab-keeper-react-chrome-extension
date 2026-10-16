import { useEffect, useRef, useState } from 'react';
import { useDispatch } from 'react-redux';
import { useTranslation } from 'react-i18next';
import { css } from '@emotion/react';

import Icon from '../common/Icon';
import TabKeeperMark from '../common/TabKeeperMark';
import WelcomeHero from './WelcomeHero';
import { useHeroLoop } from './useHeroLoop';
import { useFontFamily } from '../../hooks/useFontFamily';
import { useThemeColors } from '../../hooks/useThemeColors';
import type { AppDispatch } from '../../redux/store';
import { markWhatsNew2Seen } from '../../redux/slices/settingsDataStateSlice';
import type { RunHello } from '../../utils/functions/firstRun';
import { DIALOG, ICON, TYPE } from '../../styles/scale';
import { dialogButtonStyles } from './dialogButtons';
import {
  canAnimate,
  playGetStarted,
  playHelloEntrance,
  prefersReducedMotion,
  type Motion,
} from './getStartedMotion';
import {
  playShutterClick,
  prepareShutterClick,
} from '../../utils/functions/uiSound';

const TITLE_ID = 'run-hello-title';
const BODY_ID = 'run-hello-body';

// The full-view run's step 0, and an upgrader's popup step 0 (KAN-623): modal, its backdrop dims the page, and its cancel is Skip tutorial.
export const RunHelloDialog: React.FC<{
  hello: RunHello;
  // KAN-623. Start opens the full view in its own tab: the popup's What's new.
  startOpensFullView: boolean;
  onStart: () => void;
  onSkip: () => void;
}> = ({ hello, startOpensFullView, onStart, onSkip }) => {
  const COLORS = useThemeColors();
  const FONT_FAMILY = useFontFamily();
  const { t } = useTranslation();
  const dispatch: AppDispatch = useDispatch();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const startRef = useRef<HTMLButtonElement>(null);
  const motion = useRef<Motion | null>(null);
  const loop = useHeroLoop();
  const { play, cancel } = loop;
  // Decided once, as the popup welcome's: a still hero shows its end frame.
  const [heroFrame] = useState<'start' | 'end'>(() =>
    prefersReducedMotion() || typeof Element.prototype.animate !== 'function'
      ? 'end'
      : 'start'
  );

  // Opens unlit (KAN-243): the dialog holds the focus, not its first control.
  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) {
      dialog.showModal();
      dialog.focus();
      // Hello enters from 0.97 and transparent; reduced motion shows it at once.
      if (!prefersReducedMotion() && canAnimate(dialog)) {
        playHelloEntrance(dialog);
      }
    }
    // Outside the open guard: StrictMode re-runs this with the dialog already open.
    const hero = dialog?.querySelector<HTMLElement>(
      '[data-hero-frame="start"]'
    );
    if (hero) play(hero);
    return cancel;
  }, [play, cancel]);

  // KAN-623. What's new counts as seen once answered: a popup closed on it shows it again (Q7).
  const answered = (then: () => void) => () => {
    if (hello === 'whatsNew') dispatch(markWhatsNew2Seen());
    then();
  };
  // KAN-626. A Start that opens the full view plays Get started's moment, then goes on; with no beat drawn, the click sounds at the press.
  const startWithMoment = () => {
    loop.finish();
    const dialog = dialogRef.current;
    const button = startRef.current;
    if (
      dialog === null ||
      button === null ||
      prefersReducedMotion() ||
      !canAnimate(dialog)
    ) {
      playShutterClick();
      onStart();
      return;
    }
    motion.current = playGetStarted({
      button,
      shutter: dialog.querySelector('[data-hero-part="shutter"]'),
      dialog,
      onShutterStart: prepareShutterClick,
      onShutterShut: playShutterClick,
    });
    // As Get started (R12): cut short or not, Start was chosen and goes on.
    void motion.current.finished.then(() => {
      motion.current = null;
      onStart();
    });
  };
  // The moment plays once; a press while it plays does nothing.
  const start = () => {
    if (motion.current !== null) return;
    answered(startOpensFullView ? startWithMoment : onStart)();
  };
  // Skip tutorial or Esc during the moment cuts it short, and Start goes on.
  const skip = () => {
    if (motion.current !== null) {
      motion.current.cancel();
      return;
    }
    answered(onSkip)();
  };

  const replay = () => {
    const hero = dialogRef.current?.querySelector<HTMLElement>(
      '[data-hero-frame="start"]'
    );
    if (hero) play(hero);
  };

  const buttons = dialogButtonStyles(COLORS);
  const dialogStyle = css`
    position: fixed;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    margin: 0;
    padding: 20px;
    width: ${DIALOG.WIDTH};
    max-width: none;
    max-height: none;
    background-color: ${COLORS.PRIMARY_COLOR};
    color: ${COLORS.LABEL_L1_COLOR};
    border: 1px solid ${COLORS.BORDER_COLOR};
    font-family: ${FONT_FAMILY};
    font-size: ${TYPE.BODY};
    &[open] {
      display: block;
    }
    &:focus {
      outline: none;
    }
    &::backdrop {
      background: ${COLORS.MODAL_BACKDROP};
    }
  `;
  const titleStyle = css`
    display: flex;
    align-items: center;
    gap: 10px;
    margin: 0 0 12px 0;
    font-size: ${TYPE.SECTION};
    font-weight: 500;
    color: ${COLORS.TEXT_COLOR};
  `;
  const bodyStyle = css`
    margin: 0 0 20px 0;
    line-height: 1.5;
    color: ${COLORS.LABEL_L1_COLOR};
  `;
  const footStyle = css`
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
  `;
  const endStyle = css`
    margin-left: auto;
  `;
  // As ★ Rate this app: the glyph first, in the filled button's text colour.
  const iconLabelStyle = css`
    display: inline-flex;
    align-items: center;
    gap: 8px;
  `;

  return (
    <dialog
      ref={dialogRef}
      tabIndex={-1}
      data-run-hello
      css={dialogStyle}
      aria-labelledby={TITLE_ID}
      aria-describedby={BODY_ID}
      onCancel={(e) => {
        e.preventDefault();
        skip();
      }}
    >
      <h2 id={TITLE_ID} css={titleStyle}>
        <TabKeeperMark size={ICON.DEFAULT} />
        {hello === 'whatsNew'
          ? t("What's new in Tab Keeper 2.0")
          : t('Welcome to Tab Keeper')}
      </h2>
      <WelcomeHero
        frame={heroFrame}
        isResting={loop.isResting}
        onReplay={replay}
      />
      <p id={BODY_ID} css={bodyStyle}>
        {hello === 'whatsNew'
          ? t(
              "A full view for everything you have open, plus themes, languages and a keyboard shortcut. Here's a one-minute look."
            )
          : t(
              "Save your open windows, close them, and bring them all back later. Here's how, in about a minute."
            )}
      </p>
      <div css={footStyle}>
        <button type="button" css={buttons.link} onClick={skip}>
          {t('Skip tutorial')}
        </button>
        <button
          ref={startRef}
          type="button"
          css={[buttons.filled, endStyle, iconLabelStyle]}
          onClick={start}
        >
          {startOpensFullView && (
            <Icon
              type="open_in_full"
              size={ICON.SMALL}
              color={COLORS.PRIMARY_COLOR}
              disable={true}
              style="padding: 0;"
            />
          )}
          <span>{t('Start')}</span>
        </button>
      </div>
    </dialog>
  );
};
