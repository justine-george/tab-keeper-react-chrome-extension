import { css } from '@emotion/react';

import { useThemeColors } from '../../hooks/useThemeColors';
import { TYPE } from '../../styles/scale';

/**
 * Where the keycaps go in a translated sentence (KAN-256).
 *
 * The key is "Press {{keys}} to open Tab Keeper." and the caps are markup,
 * which t() cannot return. So the sentence is translated with this slot in
 * place of the keys, split on it, and the caps rendered between the halves --
 * which lets each locale put the keys where its grammar wants them
 * ("⌥⇧K を押すと Tab Keeper が開きます"). An invisible separator rather than a
 * printable token, so a locale that drops the placeholder shows nothing odd.
 */
export const KEYS_SLOT = '\u2063';

export function ShortcutSentence({
  sentence,
  keys,
}: {
  sentence: string;
  keys: string[];
}) {
  const COLORS = useThemeColors();
  const [before, after = ''] = sentence.split(KEYS_SLOT);

  // A keycap: the app's square frame, a heavier bottom edge for the key's
  // depth, SECONDARY so the caps sit inside the sentence's line.
  const capStyle = css`
    display: inline-grid;
    place-items: center;
    box-sizing: border-box;
    min-width: 26px;
    height: 26px;
    padding: 0 6px;
    margin: 0 2px;
    vertical-align: middle;
    border: 1px solid ${COLORS.BORDER_COLOR};
    border-bottom-width: 2px;
    background: ${COLORS.PRIMARY_COLOR};
    font-family: inherit;
    font-size: ${TYPE.SECONDARY};
    color: ${COLORS.TEXT_COLOR};
  `;

  return (
    <>
      {before}
      {keys.map((key, i) => (
        <kbd key={`${key}-${i}`} css={capStyle}>
          {key}
        </kbd>
      ))}
      {after}
    </>
  );
}
