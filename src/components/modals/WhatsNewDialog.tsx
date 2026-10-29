import { useEffect, useRef } from 'react';
import { useDispatch } from 'react-redux';
import { useTranslation } from 'react-i18next';
import { css } from '@emotion/react';

import TabKeeperMark from '../common/TabKeeperMark';
import { useFontFamily } from '../../hooks/useFontFamily';
import { useThemeColors } from '../../hooks/useThemeColors';
import type { AppDispatch } from '../../redux/store';
import { closeWhatsNew } from '../../redux/slices/globalStateSlice';
import { answerWhatsNew } from '../../redux/whatsNew';
import type { WhatsNewEntry } from '../../utils/constants/whatsNew';
import {
  settingsPageOf,
  type ShownRelease,
} from '../../utils/functions/whatsNew';
import { WHATS_NEW_SINCE_KEY } from '../../utils/functions/whatsNewSince';
import { DIALOG, ICON, TYPE } from '../../styles/scale';
import { dialogButtonStyles, tallButtonCss } from './dialogButtons';

const TITLE_ID = 'whats-new-title';

// KAN-861. The main changes since the version this person last ran, on the first open after an update.
export const WhatsNewDialog: React.FC<{ shown: readonly ShownRelease[] }> = ({
  shown,
}) => {
  const COLORS = useThemeColors();
  const FONT_FAMILY = useFontFamily();
  const { t } = useTranslation();
  const dispatch: AppDispatch = useDispatch();
  const dialogRef = useRef<HTMLDialogElement>(null);

  // Opens unlit (KAN-243), with no entrance motion.
  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) {
      dialog.showModal();
      dialog.focus();
    }
  }, []);

  // Answered on another page: the key is gone, so it closes here too.
  useEffect(() => {
    const onChanged = (
      changes: Record<string, chrome.storage.StorageChange>
    ) => {
      const change = changes[WHATS_NEW_SINCE_KEY];
      if (change && change.newValue === undefined) dispatch(closeWhatsNew());
    };
    chrome.storage.local.onChanged.addListener(onChanged);
    return () => chrome.storage.local.onChanged.removeListener(onChanged);
  }, [dispatch]);

  const answer = (a: 'gotIt' | 'openSettings' | 'dismissed') => () =>
    dispatch(answerWhatsNew(a, shown));
  const isSingle = shown.length === 1;
  const hasSettings = settingsPageOf(shown) !== null;

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
    max-height: calc(100vh - 48px);
    box-sizing: border-box;
    background-color: ${COLORS.PRIMARY_COLOR};
    color: ${COLORS.LABEL_L1_COLOR};
    border: 1px solid ${COLORS.PANEL_BORDER_COLOR};
    font-family: ${FONT_FAMILY};
    font-size: ${TYPE.BODY};
    &[open] {
      display: flex;
      flex-direction: column;
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
    margin: 0 0 16px 0;
    font-size: ${TYPE.SECTION};
    font-weight: 500;
    color: ${COLORS.TEXT_COLOR};
  `;
  const scrollStyle = css`
    overflow-y: auto;
    min-height: 0;
    display: grid;
    gap: 18px;
    margin: 0 0 16px 0;
  `;
  const versionStyle = css`
    margin: 0 0 8px 0;
    padding-bottom: 4px;
    font-size: ${TYPE.SECONDARY};
    font-weight: normal;
    color: ${COLORS.LABEL_L2_COLOR};
    border-bottom: 1px solid ${COLORS.PANEL_BORDER_COLOR};
  `;
  const listStyle = css`
    margin: 0;
    padding: 0;
    list-style: none;
    display: grid;
    gap: 14px;
  `;
  const entryTitleStyle = css`
    margin: 0 0 4px 0;
    font-weight: 500;
    color: ${COLORS.TEXT_COLOR};
  `;
  const entryBodyStyle = css`
    margin: 0;
    line-height: 1.5;
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

  const list = (entries: readonly WhatsNewEntry[]) => (
    <ul css={listStyle}>
      {entries.map((entry) => (
        <li key={entry.titleKey}>
          <p css={entryTitleStyle}>{t(entry.titleKey)}</p>
          <p css={entryBodyStyle}>{t(entry.bodyKey)}</p>
        </li>
      ))}
    </ul>
  );

  return (
    <dialog
      ref={dialogRef}
      tabIndex={-1}
      data-whats-new
      css={dialogStyle}
      aria-labelledby={TITLE_ID}
      onCancel={(e) => {
        e.preventDefault();
        answer('dismissed')();
      }}
    >
      <h2 id={TITLE_ID} css={titleStyle}>
        <TabKeeperMark size={ICON.DEFAULT} />
        {isSingle
          ? t("What's new in Tab Keeper {{version}}", {
              version: shown[0].version,
            })
          : t("What's new in Tab Keeper")}
      </h2>
      <div css={scrollStyle} data-whats-new-scroll>
        {isSingle
          ? list(shown[0].entries)
          : shown.map((release) => (
              <section key={release.version}>
                <h3 css={versionStyle}>{release.version}</h3>
                {list(release.entries)}
              </section>
            ))}
      </div>
      <div css={footStyle}>
        {hasSettings && (
          <button
            type="button"
            css={buttons.link}
            onClick={answer('openSettings')}
          >
            {t('Open Settings')}
          </button>
        )}
        <button
          type="button"
          css={[buttons.filled, endStyle, tallButtonCss(24)]}
          onClick={answer('gotIt')}
        >
          {t('Got it')}
        </button>
      </div>
    </dialog>
  );
};
