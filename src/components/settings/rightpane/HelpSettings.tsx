import { useEffect, useState } from 'react';
import { useDispatch } from 'react-redux';
import { useTranslation } from 'react-i18next';
import { css } from '@emotion/react';

import Button from '../../common/Button';
import { NormalLabel } from '../../common/Label';
import type { IconName } from '../../common/iconNames';
import { useThemeColors } from '../../../hooks/useThemeColors';
import { useFontFamily } from '../../../hooks/useFontFamily';
import type { AppDispatch } from '../../../redux/store';
import { showInFullView } from '../../../redux/fullViewShow';
import { restartSetup } from '../../../redux/slices/settingsDataStateSlice';
import { startRun, thisView } from '../../../redux/firstRun';
import { newRun } from '../../../utils/functions/firstRun';
import { requestTabView } from '../../../utils/functions/popOut';
import {
  readToolbarPin,
  watchToolbarPin,
  type ToolbarPin,
} from '../../../utils/functions/toolbarPin';
import { isTabView } from '../../../utils/functions/viewMode';
import { TYPE } from '../../../styles/scale';

const HELP_ICONS: Record<'setup' | 'pin' | 'tour', IconName> = {
  setup: 'tune',
  pin: 'keep',
  tour: 'school',
};

interface HelpRowProps {
  isFirst: boolean;
  label: string;
  description: string;
  button: string;
  icon: IconName;
  onClick: () => void;
}

// One Settings section, in the section style the Display pane's sections use.
function HelpRow({
  isFirst,
  label,
  description,
  button,
  icon,
  onClick,
}: HelpRowProps) {
  const COLORS = useThemeColors();
  const FONT_FAMILY = useFontFamily();
  return (
    <div
      data-settings-section
      css={css`
        display: flex;
        flex-direction: column;
        align-items: flex-start;
        padding-left: clamp(16px, 8%, 72px);
        padding-right: clamp(16px, 8%, 72px);
        width: 100%;
        margin-top: ${isFirst ? '20px' : '32px'};
      `}
    >
      <NormalLabel
        value={label}
        size={TYPE.BODY}
        color={COLORS.LABEL_L1_COLOR}
      />
      <p
        css={css`
          margin: 8px 0 0;
          max-width: 36rem;
          font-family: ${FONT_FAMILY};
          font-size: ${TYPE.SECONDARY};
          line-height: 1.45;
          color: ${COLORS.LABEL_L1_COLOR};
        `}
      >
        {description}
      </p>
      <div
        css={css`
          margin-top: 8px;
        `}
      >
        <Button text={button} iconType={icon} onClick={onClick} />
      </div>
    </div>
  );
}

// KAN-7 Help: setup, the pin guide and the first run, again.
export default function HelpSettings() {
  const { t } = useTranslation();
  const dispatch: AppDispatch = useDispatch();
  // null until Chrome answers: nothing draws, so the pin row never pops in.
  const [pin, setPin] = useState<ToolbarPin | null>(null);

  useEffect(() => {
    let isLive = true;
    void readToolbarPin().then((read) => {
      if (isLive) setPin(read);
    });
    const unwatch = watchToolbarPin(() => setPin('pinned'));
    return () => {
      isLive = false;
      unwatch();
    };
  }, []);

  // From the popup the full view shows it: the new tab can end this popup at once.
  const runSetupAgain = () => {
    if (isTabView()) {
      dispatch(showInFullView('setup'));
      return;
    }
    dispatch(restartSetup());
    void requestTabView('setup');
  };
  // Shown even when dismissed before; the dismissal stays as it was.
  const showPinGuide = () => {
    if (isTabView()) dispatch(showInFullView('pinGuide'));
    else void requestTabView('pinGuide');
  };
  // R11. This view's run from its first card, with no Hello: whoever opens Help has met Tab Keeper.
  const showMeAround = () => void dispatch(startRun(newRun(thisView(), 1)));

  return (
    <div
      data-help
      data-pin-state={pin ?? undefined}
      css={css`
        display: flex;
        flex-direction: column;
        align-items: center;
      `}
    >
      {pin !== null && (
        <>
          <HelpRow
            isFirst
            label={t('Make Tab Keeper yours')}
            description={t(
              'Choose your theme, language, default view and shortcut again.'
            )}
            button={t('Run setup again')}
            icon={HELP_ICONS.setup}
            onClick={runSetupAgain}
          />
          {pin === 'unpinned' && (
            <HelpRow
              isFirst={false}
              label={t('Pin to your toolbar')}
              description={t(
                'Show Tab Keeper next to the address bar, one click away.'
              )}
              button={t('Show me how')}
              icon={HELP_ICONS.pin}
              onClick={showPinGuide}
            />
          )}
          <HelpRow
            isFirst={false}
            label={t('Learn the basics')}
            description={t(
              'A one-minute tour of this view. Your open tabs and saved sessions stay just as they are.'
            )}
            button={t('Show me around')}
            icon={HELP_ICONS.tour}
            onClick={showMeAround}
          />
        </>
      )}
    </div>
  );
}
