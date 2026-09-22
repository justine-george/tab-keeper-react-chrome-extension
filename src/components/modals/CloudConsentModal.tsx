import { useEffect, useRef } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { useTranslation } from 'react-i18next';

import { css } from '@emotion/react';

import Icon from '../common/Icon';
import { useFontFamily } from '../../hooks/useFontFamily';
import { useThemeColors } from '../../hooks/useThemeColors';
import { AppDispatch, RootState } from '../../redux/store';
import {
  closeCloudConsentModal,
  syncNowWhenSignedIn,
} from '../../redux/slices/globalStateSlice';
import {
  declineCloudConsent,
  grantCloudConsent,
  setAutoSync,
} from '../../redux/slices/settingsDataStateSlice';
import { PRIVACY_POLICY_LINK } from '../../utils/constants/common';
import { ICON, TYPE } from '../../styles/scale';
import { dialogButtonStyles } from './dialogButtons';

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
  // Opens UNLIT, as the rate prompt does (KAN-243): the dialog itself takes
  // the focus (tabIndex -1), so Escape still works and the first Tab lands on
  // the first control, but no button wears a ring on open. A lit button on a
  // consent screen reads as the answer already chosen, and the one this
  // dialog first lit was Turn off sync -- a settings change one accidental
  // Enter away. showModal() would otherwise focus the privacy-policy link.
  //
  // Escape remains the answer that changes nothing for each variant.

  const isOpen = useSelector(
    (s: RootState) => s.globalState.isCloudConsentModalOpen
  );
  const variant = useSelector(
    (s: RootState) => s.globalState.cloudConsentVariant
  );
  const then = useSelector((s: RootState) => s.globalState.cloudConsentThen);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) {
      dialog.showModal();
      dialog.focus();
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const decline = () => {
    dispatch(declineCloudConsent());
    dispatch(closeCloudConsentModal());
  };
  // A yes. What it does beyond recording consent depends on what the user
  // was doing: the welcome and the Auto Sync toggle turn Auto Sync on; the
  // existing user keeps what they had; the cloud button gets its ONE sync,
  // with Auto Sync left as it was (Justine's case: "I pressed sync, it
  // turned auto sync on" -- it must not).
  const grant = () => {
    dispatch(grantCloudConsent());
    dispatch(closeCloudConsentModal());
    if (variant === 'welcome' || then === 'autoSync') {
      dispatch(setAutoSync(true));
    } else if (then === 'syncNow') {
      // KAN-266/289. Waits for sign-in, and a failed sign-in shows as a
      // failed sync. See syncNowWhenSignedIn.
      void dispatch(syncNowWhenSignedIn());
    }
  };
  // 'enable' is a re-ask from someone who declined or never answered: Not now
  // leaves that as it is, rather than recording a fresh decline.
  const dismiss = () => {
    dispatch(closeCloudConsentModal());
  };
  // Escape: the answer that changes nothing for this user.
  const handleCancel =
    variant === 'welcome' ? decline : variant === 'existing' ? grant : dismiss;

  const buttons = dialogButtonStyles(COLORS);

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
    /* Focused by script only; a ring on the container would say "this box
       is a control". Tab never reaches it, so nothing is lost. */
    &:focus {
      outline: none;
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
      // Focusable only by script, never by Tab; see the effect above.
      tabIndex={-1}
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
            <button type="button" css={buttons.quiet} onClick={decline}>
              {t('Keep on this device')}
            </button>
            <button type="button" css={buttons.primary} onClick={grant}>
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
            {then === 'syncNow' ? t('EnableSyncOnceFine') : t('EnableSyncFine')}{' '}
            {policyLink}
          </p>
          <div css={actionsStyle}>
            <button type="button" css={buttons.quiet} onClick={dismiss}>
              {t('Not now')}
            </button>
            <button type="button" css={buttons.primary} onClick={grant}>
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
            <button type="button" css={buttons.quiet} onClick={decline}>
              {t('Turn off sync')}
            </button>
            <button type="button" css={buttons.primary} onClick={grant}>
              {t('Keep sync on')}
            </button>
          </div>
        </>
      )}
    </dialog>
  );
};
