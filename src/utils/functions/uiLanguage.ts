// KAN-282. Which of the languages this build ships matches the browser's UI
// language, if any.
//
// Generic over the supported list rather than importing the Language enum:
// the settings slice owns that enum and calls into this module while it is
// still being evaluated, so a value import back would close a cycle.
//
// Never returns a raw browser tag. In 2023 (#42) an i18next language detector
// passed `en-US` straight through, i18next asked for
// /locales/en-US/translation.json, which does not exist, and the popup lost
// every string. The only answers are a member of `supported`, or undefined.

// Traditional Chinese, by script or by the regions that write it. A script
// subtag outranks the region: zh-Hans-HK is Simplified, zh-Hant-CN is not.
const TRADITIONAL_CHINESE = 'zh-tw';
const SIMPLIFIED_CHINESE = 'zh';
const TRADITIONAL_REGIONS = new Set(['tw', 'hk', 'mo']);

export function matchUiLanguage<L extends string>(
  tag: unknown,
  supported: readonly L[]
): L | undefined {
  if (typeof tag !== 'string') return undefined;
  const subtags = tag.trim().toLowerCase().replace(/_/g, '-').split('-');
  const [primary, ...rest] = subtags;
  if (!primary) return undefined;

  const byLowercase = new Map(supported.map((l) => [l.toLowerCase(), l]));

  const exact = byLowercase.get(subtags.join('-'));
  if (exact) return exact;

  if (primary === 'zh') {
    const script = rest.find((s) => s === 'hant' || s === 'hans');
    const traditional = script
      ? script === 'hant'
      : rest.some((s) => TRADITIONAL_REGIONS.has(s));
    return byLowercase.get(
      traditional ? TRADITIONAL_CHINESE : SIMPLIFIED_CHINESE
    );
  }

  return byLowercase.get(primary);
}

// Chrome's UI language, or undefined when it cannot be read. Called at module
// load by the settings slice, before React renders, where a throw is a blank
// popup -- so a missing API (the unit and component test environments) and a
// throwing call (an invalidated extension context) are both "no answer".
export function readUiLanguage(): string | undefined {
  if (typeof chrome === 'undefined' || !chrome.i18n?.getUILanguage) {
    return undefined;
  }
  try {
    return chrome.i18n.getUILanguage();
  } catch {
    return undefined;
  }
}
