import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { useTranslation } from 'react-i18next';
import { css } from '@emotion/react';

import Icon from '../common/Icon';
import TabKeeperMark from '../common/TabKeeperMark';
import { KEYS_SLOT, ShortcutSentence } from '../common/ShortcutSentence';
import { slidingPairColors } from '../common/slidingPairColors';
import { pressedCellStyle } from '../common/pressedCellStyle';
import ThemeSwatch from '../settings/rightpane/ThemeSwatch';
import { chromeLanguageOrder } from '../settings/rightpane/languageOptions';
import { themeChoices } from '../settings/rightpane/themeChoices';
import { CompactViewArt, FullViewArt } from './defaultViewArt';
import { useFontFamily } from '../../hooks/useFontFamily';
import { useThemeColors } from '../../hooks/useThemeColors';
import {
  CHROME_SHORTCUTS_URL,
  usePopupShortcut,
} from '../../hooks/usePopupShortcut';
import type { AppDispatch, RootState } from '../../redux/store';
import { closeSetup } from '../../redux/slices/globalStateSlice';
import {
  finishSetup,
  setTheme,
  type Language,
} from '../../redux/slices/settingsDataStateSlice';
import { chooseDefaultView } from '../../redux/defaultViewChoice';
import { chooseLanguage } from '../../redux/languageChoice';
import type { DefaultView } from '../../utils/functions/defaultView';
import { shortcutKeys } from '../../utils/functions/shortcutKeys';
import { ICON, TYPE } from '../../styles/scale';
import { focusRingCss } from '../common/focusRing';
import { dialogButtonStyles } from './dialogButtons';

const TITLE_ID = 'setup-title';
const STEPS = ['theme', 'language', 'defaultView', 'shortcut'] as const;
type Step = (typeof STEPS)[number];

// KAN-7 §5. A new install, in the full view. Each pick applies at once; Done,
// Skip setup, ✕ and Esc end it for good. Only a closed tab leaves it pending.
export const SetupModal: React.FC = () => {
  const COLORS = useThemeColors();
  const FONT_FAMILY = useFontFamily();
  const { t, i18n } = useTranslation();
  const dispatch: AppDispatch = useDispatch();
  const theme = useSelector((s: RootState) => s.settingsDataState.theme);
  const language = useSelector((s: RootState) => s.settingsDataState.language);
  const defaultView = useSelector(
    (s: RootState) => s.settingsDataState.defaultView
  );
  const popupShortcut = usePopupShortcut();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const hasMoved = useRef(false);
  const [stepIndex, setStepIndex] = useState(0);
  // Chrome's language first, fixed for the dialog's life: a pick presses its cell where it is.
  const [languages] = useState(chromeLanguageOrder);
  const step: Step = STEPS[stepIndex];
  const isLast = stepIndex === STEPS.length - 1;

  // Opens unlit (KAN-243): the dialog holds the focus, not its first control.
  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) {
      dialog.showModal();
      dialog.focus();
    }
  }, []);

  // D5. A new step takes the focus to its heading, so it is announced.
  useEffect(() => {
    if (hasMoved.current) headingRef.current?.focus();
  }, [stepIndex]);

  const goTo = (index: number) => {
    hasMoved.current = true;
    setStepIndex(index);
  };
  const finish = () => {
    dispatch(finishSetup());
    dispatch(closeSetup());
  };
  const pickLanguage = (next: Language) => dispatch(chooseLanguage(next, i18n));
  const openShortcuts = () => {
    void chrome.tabs.create({ url: CHROME_SHORTCUTS_URL });
  };

  const buttons = dialogButtonStyles(COLORS);
  const pressed = slidingPairColors(COLORS);

  const dialogStyle = css`
    position: fixed;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    margin: 0;
    padding: 20px;
    width: min(calc(100% - 32px), 600px);
    max-width: none;
    max-height: calc(100% - 32px);
    overflow: auto;
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
      background: rgba(0, 0, 0, 0.8);
    }
  `;
  const titleRowStyle = css`
    display: flex;
    align-items: center;
    gap: 8px;
    margin: 0 0 16px 0;
  `;
  const titleStyle = css`
    flex: 1;
    display: flex;
    align-items: center;
    gap: 10px;
    margin: 0;
    font-size: ${TYPE.SECTION};
    font-weight: 500;
    color: ${COLORS.TEXT_COLOR};
  `;
  const stepHeadingStyle = css`
    margin: 0 0 12px 0;
    font-size: ${TYPE.BODY};
    font-weight: 500;
    color: ${COLORS.TEXT_COLOR};
    &:focus {
      outline: none;
    }
  `;
  const swatchRowStyle = css`
    display: flex;
    flex-wrap: wrap;
    gap: 14px;
  `;
  const languageGridStyle = css`
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 10px;
  `;
  const cellStyle = css`
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    width: 100%;
    min-width: 0;
    /* Fixed, so the check's padded box never resizes the pressed row. */
    height: 3rem;
    padding-block: 0;
  `;
  const pressedCell = css`
    ${pressedCellStyle(COLORS)}
  `;
  const cardsStyle = css`
    display: flex;
    gap: 14px;
  `;
  const viewCardStyle = css`
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    padding: 0;
    text-align: left;
    cursor: pointer;
    font: inherit;
    color: ${COLORS.TEXT_COLOR};
    background-color: ${COLORS.PRIMARY_COLOR};
    border: 1px solid ${COLORS.BORDER_COLOR};
    ${focusRingCss(COLORS)}
  `;
  // D2: the pressed card's outline is 1px TEXT; its label strip is filled below.
  const viewCardPressedStyle = css`
    border-color: ${COLORS.TEXT_COLOR};
  `;
  const viewArtStyle = css`
    display: block;
    padding: 12px;
  `;
  const viewLabelStyle = css`
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 0 12px;
    /* Fixed, so the check's padded box never resizes the pressed strip. */
    height: 2.1875rem;
  `;
  // D2: the language cell's pressed look, on the label strip.
  const viewLabelPressedStyle = css`
    background-color: ${pressed.knob};
    color: ${pressed.labelOnKnob};
  `;
  const dotsStyle = css`
    display: flex;
    justify-content: center;
    gap: 9px;
    margin-top: 20px;
  `;
  const dotStyle = (isCurrent: boolean) => css`
    width: 10px;
    height: 10px;
    border-radius: 50%;
    border: 1px solid ${COLORS.TEXT_COLOR};
    background-color: ${isCurrent ? COLORS.TEXT_COLOR : 'transparent'};
  `;
  const fineStyle = css`
    margin: 12px 0 0 0;
    font-size: ${TYPE.SECONDARY};
    line-height: 1.5;
    color: ${COLORS.LABEL_L1_COLOR};
  `;
  const sentenceStyle = css`
    margin: 0;
    line-height: 1.6;
    color: ${COLORS.LABEL_L1_COLOR};
  `;
  const shortcutButtonStyle = css`
    margin-top: 14px;
  `;
  const footerStyle = css`
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    margin-top: 12px;
  `;
  const footerEndStyle = css`
    display: inline-flex;
    gap: 8px;
  `;

  const viewCard = (view: DefaultView, label: string, art: ReactNode) => {
    const isActive = defaultView === view;
    return (
      <button
        key={view}
        type="button"
        aria-pressed={isActive}
        css={[viewCardStyle, isActive && viewCardPressedStyle]}
        onClick={() => void dispatch(chooseDefaultView(view))}
      >
        <span aria-hidden="true" css={viewArtStyle}>
          {art}
        </span>
        <span
          data-view-label
          css={[viewLabelStyle, isActive && viewLabelPressedStyle]}
        >
          {isActive && (
            <Icon type="check" size={ICON.SMALL} color={pressed.labelOnKnob} />
          )}
          {label}
        </span>
      </button>
    );
  };

  const shortcutBody: ReactNode =
    popupShortcut === undefined ? null : popupShortcut === '' ? (
      <>
        <p css={sentenceStyle}>{t('No shortcut is set.')}</p>
        <button
          type="button"
          css={[buttons.quiet, shortcutButtonStyle]}
          onClick={openShortcuts}
        >
          {t('Set a shortcut')}
        </button>
      </>
    ) : (
      <>
        <p data-testid="setup-shortcut" css={sentenceStyle}>
          <ShortcutSentence
            sentence={t('Press {{keys}} to open Tab Keeper.', {
              keys: KEYS_SLOT,
            })}
            keys={shortcutKeys(popupShortcut)}
          />
        </p>
        <p css={fineStyle}>{t('Works in any window.')}</p>
        <button
          type="button"
          css={[buttons.quiet, shortcutButtonStyle]}
          onClick={openShortcuts}
        >
          {t('Change shortcut')}
        </button>
      </>
    );

  const content: Record<Step, { heading: string; body: ReactNode }> = {
    theme: {
      heading: t('Pick a theme'),
      body: (
        <>
          <div css={swatchRowStyle}>
            {themeChoices(t).map(([id, palette, name]) => (
              <ThemeSwatch
                key={id}
                palette={palette}
                name={name}
                isActive={theme === id}
                onSelect={() => dispatch(setTheme(id))}
              />
            ))}
          </div>
          <p css={fineStyle}>
            {t('You can change this any time in Settings.')}
          </p>
        </>
      ),
    },
    language: {
      heading: t('Which language do you prefer?'),
      body: (
        <div css={languageGridStyle}>
          {languages.map(([id, endonym]) => {
            const isActive = language === id;
            return (
              <button
                key={id}
                type="button"
                lang={id}
                aria-pressed={isActive}
                css={[buttons.quiet, cellStyle, isActive && pressedCell]}
                onClick={() => pickLanguage(id)}
              >
                {isActive && (
                  <Icon
                    type="check"
                    size={ICON.SMALL}
                    color={pressed.labelOnKnob}
                  />
                )}
                {endonym}
              </button>
            );
          })}
        </div>
      ),
    },
    defaultView: {
      heading: t('When you click Tab Keeper, open…'),
      body: (
        <>
          <div css={cardsStyle}>
            {viewCard('compact', t('Compact view'), <CompactViewArt />)}
            {viewCard('full', t('Full view'), <FullViewArt />)}
          </div>
          <p css={fineStyle}>
            {t('You can change this any time in Settings.')}
          </p>
        </>
      ),
    },
    shortcut: {
      heading: t('Open Tab Keeper from the keyboard'),
      body: shortcutBody,
    },
  };

  return (
    <dialog
      ref={dialogRef}
      // Focusable only by script, never by Tab; see the effect above.
      tabIndex={-1}
      css={dialogStyle}
      aria-labelledby={TITLE_ID}
      // Justine 2026-10-04: a prompt the user dismissed must not come back.
      onCancel={(e) => {
        e.preventDefault();
        finish();
      }}
    >
      <div css={titleRowStyle}>
        <h2 id={TITLE_ID} css={titleStyle}>
          <TabKeeperMark size={ICON.DEFAULT} />
          {t('Make Tab Keeper yours')}
        </h2>
        {/* Named for what it does: it ends setup for good, as the link does. */}
        <Icon
          type="close"
          ariaLabel={t('Skip setup')}
          tooltipText={t('Skip setup')}
          onClick={finish}
        />
      </div>
      <h3 ref={headingRef} tabIndex={-1} css={stepHeadingStyle}>
        {content[step].heading}
      </h3>
      {content[step].body}
      <div aria-hidden="true" css={dotsStyle}>
        {STEPS.map((id, index) => (
          <span
            key={id}
            data-step-dot
            data-current={index === stepIndex}
            css={dotStyle(index === stepIndex)}
          />
        ))}
      </div>
      <div css={footerStyle}>
        <button type="button" css={buttons.link} onClick={finish}>
          {t('Skip setup')}
        </button>
        <span css={footerEndStyle}>
          {stepIndex > 0 && (
            <button
              type="button"
              css={buttons.quiet}
              onClick={() => goTo(stepIndex - 1)}
            >
              {t('Go back')}
            </button>
          )}
          {isLast ? (
            <button type="button" css={buttons.primary} onClick={finish}>
              {t('Done')}
            </button>
          ) : (
            <button
              type="button"
              css={buttons.primary}
              onClick={() => goTo(stepIndex + 1)}
            >
              {t('Next')}
            </button>
          )}
        </span>
      </div>
    </dialog>
  );
};
