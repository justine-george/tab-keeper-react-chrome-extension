/**
 * Every `:hover` rule in the document that targets one of `el`'s classes, as
 * text.
 *
 * jsdom does not apply `:hover` when an element is hovered, so a computed
 * style reads the resting state for both a hovered and an unhovered element
 * and passes against either. Reading the rules emotion injected is the one
 * thing a component test can say about hover; the real hover is verified in a
 * browser.
 *
 * Shared by the OverflowMenu tests and the session header's menu test, which
 * both need to tell a danger item from an ordinary one.
 */
export function hoverRulesFor(el: Element): string {
  const classes = [...el.classList].map((c) => `.${c}`);
  const out: string[] = [];
  for (const sheet of [...document.styleSheets]) {
    let rules: CSSRuleList;
    try {
      rules = sheet.cssRules;
    } catch {
      continue;
    }
    for (const rule of [...rules]) {
      const text = rule.cssText;
      if (text.includes(':hover') && classes.some((c) => text.includes(c))) {
        out.push(text);
      }
    }
  }
  return out.join('\n');
}
