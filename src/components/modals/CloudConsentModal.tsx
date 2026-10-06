import { useEffect, useRef, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { useTranslation } from 'react-i18next';

import { css } from '@emotion/react';

import Icon from '../common/Icon';
import TabKeeperMark from '../common/TabKeeperMark';
import WelcomeHero from './WelcomeHero';
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
import { welcomeGetStarted, welcomeNotNow } from '../../redux/firstRun';
import { PRIVACY_POLICY_LINK } from '../../utils/constants/common';
import { DIALOG, ICON, TYPE } from '../../styles/scale';
import { dialogButtonStyles } from './dialogButtons';
import {
  canAnimate,
  playGetStarted,
  prefersReducedMotion,
  type Motion,
} from './getStartedMotion';
import { playWelcomeLoop, type HeroLoop } from './welcomeMotion';

const TITLE_ID = 'cloud-consent-title';
const BODY_ID = 'cloud-consent-body';

/**
 * The cloud question (KAN-259), asked before anything is uploaded.
 *
 * 'welcome' is a fresh install and asks nothing (KAN-410): what Tab Keeper
 * does, Get started into the full view, or Not now into the popup run. Its
 * opening already recorded the device as local-only; sync comes later,
 * through 'enable'. 'existing' is a user whose sessions are already synced:
 * the current state first, then what is stored, then the question, then what
 * turning it off does and does not do -- a preference, not a confession.
 * 'enable' is the question asked when someone reaches for sync without having
 * said yes.
 *
 * The questions give two complete answers and no "OK" hiding a default.
 * Escape never grants: for an existing user it is Turn off sync (KAN-410), as
 * "currently synced" may be untrue and only a click may upload.
 * Same <dialog> contract as FocusConfirmModal.
 */
export const CloudConsentModal: React.FC = () => {
  const COLORS = useThemeColors();
  const FONT_FAMILY = useFontFamily();
  const { t } = useTranslation();
  const dispatch: AppDispatch = useDispatch();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const getStartedRef = useRef<HTMLButtonElement>(null);
  const motion = useRef<Motion | null>(null);
  const loop = useRef<HeroLoop | null>(null);
  // Decided once: a still hero shows its end frame (reduced motion, or no Web Animations).
  const [heroFrame] = useState<'start' | 'end'>(() =>
    prefersReducedMotion() || typeof Element.prototype.animate !== 'function'
      ? 'end'
      : 'start'
  );
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
    // Outside the open guard: StrictMode re-runs this with the dialog already open.
    const hero = dialog?.querySelector<HTMLElement>(
      '[data-hero-frame="start"]'
    );
    if (hero) loop.current = playWelcomeLoop(hero);
    return () => loop.current?.cancel();
  }, [isOpen]);

  if (!isOpen) return null;

  // 'enable' Not now and Escape only close: a re-ask leaves the earlier answer as it is.
  const close = () => dispatch(closeCloudConsentModal());
  const decline = () => {
    dispatch(declineCloudConsent());
    close();
  };
  // A yes. What it does beyond recording consent depends on what the user
  // was doing: the Auto Sync toggle turns Auto Sync on; the existing user
  // keeps what they had; the cloud button gets its ONE sync, with Auto Sync
  // left as it was (Justine's case: "I pressed sync, it turned auto sync on"
  // -- it must not).
  const grant = () => {
    dispatch(grantCloudConsent());
    close();
    if (then === 'autoSync') {
      dispatch(setAutoSync(true));
    } else if (then === 'syncNow') {
      // KAN-266/289. Waits for sign-in, and a failed sign-in shows as a
      // failed sync. See syncNowWhenSignedIn.
      void dispatch(syncNowWhenSignedIn());
    }
  };
  // The moment plays once; a press while it plays does nothing.
  const getStarted = () => {
    if (motion.current !== null) return;
    loop.current?.finish();
    loop.current = null;
    const dialog = dialogRef.current;
    const button = getStartedRef.current;
    if (
      dialog === null ||
      button === null ||
      prefersReducedMotion() ||
      !canAnimate(dialog)
    ) {
      void dispatch(welcomeGetStarted());
      return;
    }
    motion.current = playGetStarted({
      button,
      shutter: dialog.querySelector('[data-hero-part="shutter"]'),
      dialog,
    });
    // R12: cut short or not, Get started was chosen and completes.
    void motion.current.finished.then(() => {
      motion.current = null;
      void dispatch(welcomeGetStarted());
    });
  };
  const notNow = () => void dispatch(welcomeNotNow());
  // §5: Esc is Not now; during Get started's beat it cuts the beat short (R12).
  const leaveWelcome = () => {
    if (motion.current !== null) {
      motion.current.cancel();
      return;
    }
    notNow();
  };
  // Escape never uploads: existing declines (KAN-410), enable changes nothing,
  // and the welcome's Escape is Not now.
  const handleCancel =
    variant === 'welcome'
      ? leaveWelcome
      : variant === 'existing'
        ? decline
        : close;

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
  // §5: the hint is smaller, in the fine print's style.
  const hintStyle = css`
    margin: 0 0 20px 0;
    font-size: ${TYPE.SECONDARY};
    line-height: 1.5;
    color: ${COLORS.LABEL_L1_COLOR};
  `;
  const welcomeActionsStyle = css`
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 12px;
  `;
  const endStyle = css`
    margin-left: auto;
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
            <TabKeeperMark size={ICON.DEFAULT} />
            {t('Welcome to Tab Keeper')}
          </h2>
          <WelcomeHero frame={heroFrame} />
          <p id={BODY_ID} css={bodyStyle}>
            {t(
              'Save your open windows, close them, and bring them all back later.'
            )}
          </p>
          <p css={hintStyle}>
            {t('Get started opens Tab Keeper in its own tab.')}
          </p>
          <div css={welcomeActionsStyle}>
            <button type="button" css={buttons.link} onClick={notNow}>
              {t('Not now')}
            </button>
            <button
              ref={getStartedRef}
              type="button"
              css={[buttons.filled, endStyle]}
              onClick={getStarted}
            >
              {t('Get started')}
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
            <button type="button" css={buttons.quiet} onClick={close}>
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
