import { useEffect, useRef } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { useTranslation } from 'react-i18next';

import { css } from '@emotion/react';

import Icon from '../common/Icon';
import { useFontFamily } from '../../hooks/useFontFamily';
import { useThemeColors } from '../../hooks/useThemeColors';
import { AppDispatch, RootState } from '../../redux/store';
import { closeCloudConsentModal } from '../../redux/slices/globalStateSlice';
import {
  declineCloudConsent,
  grantCloudConsent,
} from '../../redux/slices/settingsDataStateSlice';
import { PRIVACY_POLICY_LINK } from '../../utils/constants/common';
import { DURATION, ICON, TYPE } from '../../styles/scale';

const TITLE_ID = 'cloud-consent-title';
const BODY_ID = 'cloud-consent-body';

/**
 * The cloud question (KAN-259), asked once before anything is uploaded.
 *
 * Two wordings for one choice. 'welcome' is a fresh install: what Tab Keeper
 * does, that sessions stay on the device unless synced, what sync stores.
 * 'existing' is a user whose sessions are already synced: the current state
 * first, then what is stored, then the question, then what turning it off
 * does and does not do -- a preference, not a confession.
 *
 * Both give two complete answers and no "OK" hiding a default. Escape is the
 * answer that changes nothing: keep on this device for a new user, keep sync
 * on for an existing one -- "do nothing" must not change a setting they had.
 * Same <dialog> contract as FocusConfirmModal.
 */
export const CloudConsentModal: React.FC = () => {
  const COLORS = useThemeColors();
  const FONT_FAMILY = useFontFamily();
  const { t } = useTranslation();
  const dispatch: AppDispatch = useDispatch();
  const dialogRef = useRef<HTMLDialogElement>(null);
  // showModal() focuses the first focusable element, and here that is the
  // privacy-policy link in the body, not a button. The initial focus belongs
  // on the answer that changes nothing (the KAN-243 rule for these dialogs).
  const safeRef = useRef<HTMLButtonElement>(null);

  const isOpen = useSelector(
    (s: RootState) => s.globalState.isCloudConsentModalOpen
  );
  const variant = useSelector(
    (s: RootState) => s.globalState.cloudConsentVariant
  );

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) {
      dialog.showModal();
      safeRef.current?.focus();
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const decline = () => {
    dispatch(declineCloudConsent());
    dispatch(closeCloudConsentModal());
  };
  const grant = () => {
    dispatch(grantCloudConsent());
    dispatch(closeCloudConsentModal());
  };
  // 'enable' is a re-ask from someone who declined or never answered: Not now
  // leaves that as it is, rather than recording a fresh decline.
  const dismiss = () => {
    dispatch(closeCloudConsentModal());
  };
  // Escape: the answer that changes nothing for this user.
  const handleCancel =
    variant === 'welcome' ? decline : variant === 'existing' ? grant : dismiss;

  const dialogStyle = css`
    position: fixed;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    margin: 0;
    padding: 20px;
    width: 78%;
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
    &::backdrop {
      background: rgba(0, 0, 0, 0.8);
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
    margin: 0 0 12px 0;
    line-height: 1.5;
    color: ${COLORS.LABEL_L1_COLOR};
  `;
  const listStyle = css`
    margin: 0 0 12px 0;
    padding-left: 20px;
    line-height: 1.6;
    color: ${COLORS.LABEL_L1_COLOR};
  `;
  const questionStyle = css`
    margin: 0 0 12px 0;
    font-weight: 500;
    color: ${COLORS.TEXT_COLOR};
  `;
  const fineStyle = css`
    margin: 0 0 20px 0;
    font-size: ${TYPE.SECONDARY};
    line-height: 1.5;
    color: ${COLORS.LABEL_L1_COLOR};
    a {
      color: ${COLORS.TEXT_COLOR};
    }
  `;
  const actionsStyle = css`
    display: flex;
    justify-content: flex-end;
    gap: 8px;
  `;
  const buttonStyle = css`
    padding: 8px 16px;
    border: 1px solid ${COLORS.BORDER_COLOR};
    background: none;
    color: ${COLORS.TEXT_COLOR};
    font-family: inherit;
    font-size: inherit;
    cursor: pointer;
    transition: background-color ${DURATION.MOVE};
    &:hover {
      background-color: ${COLORS.HOVER_COLOR};
    }
    &:focus-visible {
      outline: 2px solid ${COLORS.TEXT_COLOR};
      outline-offset: -4px;
    }
  `;
  const primaryButtonStyle = css`
    ${buttonStyle}
    background-color: ${COLORS.SELECTION_COLOR};
  `;

  const policyLink = (
    <a
      href={PRIVACY_POLICY_LINK}
      target="_blank"
      rel="noreferrer"
      onClick={(e) => {
        e.preventDefault();
        chrome.tabs.create({ url: PRIVACY_POLICY_LINK });
      }}
    >
      {t('Read the privacy policy')}
    </a>
  );

  return (
    <dialog
      ref={dialogRef}
      css={dialogStyle}
      aria-labelledby={TITLE_ID}
      aria-describedby={BODY_ID}
      onCancel={(e) => {
        e.preventDefault();
        handleCancel();
      }}
    >
      {variant === 'welcome' ? (
        <>
          <h2 id={TITLE_ID} css={titleStyle}>
            <Icon type="tab_keeper" size={ICON.DEFAULT} disable={true} />
            {t('Welcome to Tab Keeper')}
          </h2>
          <ul id={BODY_ID} css={listStyle}>
            <li>{t('WelcomeSave')}</li>
            <li>{t('WelcomeStays')}</li>
            <li>{t('WelcomeSync')}</li>
          </ul>
          <p css={fineStyle}>
            {t('Change either later in Settings → Sync & Backup.')} {policyLink}
          </p>
          <div css={actionsStyle}>
            <button
              ref={safeRef}
              type="button"
              css={buttonStyle}
              onClick={decline}
            >
              {t('Keep on this device')}
            </button>
            <button type="button" css={primaryButtonStyle} onClick={grant}>
              {t('Sync across devices')}
            </button>
          </div>
        </>
      ) : variant === 'enable' ? (
        <>
          <h2 id={TITLE_ID} css={titleStyle}>
            <Icon type="cloud" size={ICON.DEFAULT} disable={true} />
            {t('Sync your sessions across devices?')}
          </h2>
          <p id={BODY_ID} css={bodyStyle}>
            {t('EnableSyncBody')}
          </p>
          <p css={fineStyle}>
            {t('EnableSyncFine')} {policyLink}
          </p>
          <div css={actionsStyle}>
            <button
              ref={safeRef}
              type="button"
              css={buttonStyle}
              onClick={dismiss}
            >
              {t('Not now')}
            </button>
            <button type="button" css={primaryButtonStyle} onClick={grant}>
              {t('Sync')}
            </button>
          </div>
        </>
      ) : (
        <>
          <h2 id={TITLE_ID} css={titleStyle}>
            <Icon type="cloud_done" size={ICON.DEFAULT} disable={true} />
            {t('Your sessions are currently synced')}
          </h2>
          <p id={BODY_ID} css={bodyStyle}>
            {t('ExistingSyncBody')}
          </p>
          <p css={questionStyle}>
            {t('Would you like to keep sync on for this device?')}
          </p>
          <p css={fineStyle}>
            {t('ExistingSyncOff')} {policyLink}
          </p>
          <div css={actionsStyle}>
            <button
              ref={safeRef}
              type="button"
              css={buttonStyle}
              onClick={decline}
            >
              {t('Turn off sync')}
            </button>
            <button type="button" css={primaryButtonStyle} onClick={grant}>
              {t('Keep sync on')}
            </button>
          </div>
        </>
      )}
    </dialog>
  );
};
