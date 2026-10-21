import type { Locator, Page } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { grantedTest as test, expect } from './fixtures/grantedExtension';
import { putDeviceId } from './fixtures/cloud';
import { sessionHeaderMenu } from './fixtures/menus';
import { contrast, pixelsAt, rgbToHex } from './fixtures/pixels';
import {
  buildContainer,
  buildSession,
  seedSessions,
  seedSettings,
} from './fixtures/seed';
import {
  POPUP,
  TAB_VIEW,
  THEMES,
  savedWindow,
  session,
} from './fixtures/savedWindows';
import type { ThemeColors } from '../src/hooks/useThemeColors';

// KAN-725 on the real artifact: every kind of destructive control, in all five
// themes, measured from computed styles at rest, hover, press (held) and
// keyboard focus, and the sync meter at near and full. Presses are released
// off the control, so nothing is deleted. DESTRUCTIVE_SHOTS=<dir> also saves
// every reading as JSON and the dark themes' meters as PNGs, for the demo.

const SHOTS = process.env.DESTRUCTIVE_SHOTS;

const KINDS = ['button', 'dialog', 'menu', 'trash', 'close'] as const;
type Kind = (typeof KINDS)[number];
const STATES = ['rest', 'hover', 'press', 'focus', 'focus+hover'] as const;
type State = (typeof STATES)[number];
const POINTER_STATES = ['rest', 'hover', 'press'] as const;

interface Ink {
  what: string;
  color: string;
  glyph: boolean;
}

// One reading of a control, colours as the page computes them.
interface RawPaint {
  fill: string;
  edge: { color: string; width: string };
  ground: string;
  inks: Ink[];
  ring: { color: string; width: string; offset: string } | null;
  keyNav: boolean;
}

// The same reading as #RRGGBB, with what is painted behind the ink resolved.
interface Paint {
  ownFillTransparent: boolean;
  fill: string;
  edge: { color: string; width: string };
  inks: Array<Ink & { ratio: number }>;
  ring: { color: string; width: string; offset: string; ratio: number } | null;
  keyNav: boolean;
  pixel?: string;
}

const LIVE_TITLES = ['Destructive live 1', 'Destructive live 2'];
const SAVED_ROW = '[data-pane="detail"] [data-drag-row-id="w1-t2"]';
const OPEN_NOW = '[data-pane="open-now"]';

// A token spelled as rgbToHex reads a computed colour back: upper-case #RRGGBB.
const tokenHex = (token: string): string => token.toUpperCase();

// A reading, or the fade that stopped it: a translucent fill, or a control
// part-way through an opacity fade (a row's strip), paints a blend only
// pixels can measure.
type Reading = { paint: RawPaint } | { fading: string };

// The control's computed fill, edge, ring and inked descendants (label, glyph,
// key hint), and the first opaque fill behind it.
function readPaint(control: Locator): Promise<Reading> {
  return control.evaluate((el): Reading => {
    const alphaOf = (fill: string): number => {
      const parts = fill.match(/[\d.]+/g) ?? [];
      return parts.length >= 4 ? Number(parts[3]) : 1;
    };
    const groundOf = (
      start: Element | null
    ): { ground: string } | { fading: string } => {
      for (let node = start; node !== null; node = node.parentElement) {
        const fill = getComputedStyle(node).backgroundColor;
        const alpha = alphaOf(fill);
        if (alpha === 1) return { ground: fill };
        if (alpha > 0) return { fading: `translucent fill ${fill} behind` };
      }
      throw new Error('no opaque ground behind the control');
    };
    const own = getComputedStyle(el);
    const ownAlpha = alphaOf(own.backgroundColor);
    if (ownAlpha > 0 && ownAlpha < 1)
      return {
        fading: `translucent fill ${own.backgroundColor} on the control`,
      };
    for (let n: Element | null = el; n !== null; n = n.parentElement) {
      const opacity = Number(getComputedStyle(n).opacity);
      if (opacity > 0 && opacity < 1)
        return { fading: `opacity ${opacity} on ${n.tagName.toLowerCase()}` };
    }
    const behind = groundOf(el.parentElement);
    if ('fading' in behind) return behind;
    // Drawn: a box of its own, and no fully faded face (Button's hidden second face).
    const drawn = (node: Element): boolean => {
      const box = node.getBoundingClientRect();
      if (box.width === 0 || box.height === 0) return false;
      for (let n: Element | null = node; n !== null; n = n.parentElement) {
        if (Number(getComputedStyle(n).opacity) === 0) return false;
        if (n === el) break;
      }
      return true;
    };
    const inks: Ink[] = [];
    for (const node of [el, ...el.querySelectorAll('*')]) {
      if (!drawn(node)) continue;
      const glyph = node.matches('.material-symbols-outlined, svg');
      const words = [...node.childNodes]
        .filter((n) => n.nodeType === Node.TEXT_NODE)
        .map((n) => (n.textContent ?? '').trim())
        .join(' ')
        .trim();
      if (glyph) {
        inks.push({
          what: (node.textContent ?? '').trim() || 'svg',
          color: getComputedStyle(node).color,
          glyph: true,
        });
      } else if (
        words !== '' &&
        node.closest('.material-symbols-outlined, svg') === null
      ) {
        inks.push({
          what: words,
          color: getComputedStyle(node).color,
          glyph: false,
        });
      }
    }
    return {
      paint: {
        fill: own.backgroundColor,
        edge: { color: own.borderTopColor, width: own.borderTopWidth },
        ground: behind.ground,
        inks,
        ring:
          own.outlineStyle === 'none'
            ? null
            : {
                color: own.outlineColor,
                width: own.outlineWidth,
                offset: own.outlineOffset,
              },
        keyNav: document.documentElement.hasAttribute('data-key-nav'),
      },
    };
  });
}

// Fills and inks ease (120-200ms): read only once two reads 250ms apart agree.
// A fading read never agrees, so a control caught mid-fade is read again.
async function settledPaint(page: Page, control: Locator): Promise<Paint> {
  let last = await readPaint(control);
  for (let i = 0; i < 12; i++) {
    await page.waitForTimeout(250);
    const next = await readPaint(control);
    if (
      'paint' in last &&
      'paint' in next &&
      JSON.stringify(next.paint) === JSON.stringify(last.paint)
    )
      return resolve(next.paint);
    last = next;
  }
  throw new Error(
    'fading' in last
      ? `the control never settled: ${last.fading}`
      : 'the control never settled'
  );
}

function resolve(raw: RawPaint): Paint {
  const ownFillTransparent =
    raw.fill.endsWith(', 0)') || raw.fill === 'transparent';
  const fill = rgbToHex(ownFillTransparent ? raw.ground : raw.fill);
  return {
    ownFillTransparent,
    fill,
    edge: { ...raw.edge, color: rgbToHex(raw.edge.color) },
    inks: raw.inks.map((ink) => {
      const color = rgbToHex(ink.color);
      return { ...ink, color, ratio: contrast(color, fill) };
    }),
    ring:
      raw.ring === null
        ? null
        : {
            ...raw.ring,
            color: rgbToHex(raw.ring.color),
            ratio: contrast(rgbToHex(raw.ring.color), fill),
          },
    keyNav: raw.keyNav,
  };
}

const centreOf = async (control: Locator): Promise<[number, number]> => {
  const box = await control.boundingBox();
  if (box === null) throw new Error('the control has no box');
  return [box.x + box.width / 2, box.y + box.height / 2];
};

// A point inside the control's right edge, clear of its ink, for a pixel.
const fillPointOf = async (
  control: Locator,
  inset: number
): Promise<[number, number]> => {
  const box = await control.boundingBox();
  if (box === null) throw new Error('the control has no box');
  return [box.x + box.width - inset, box.y + box.height / 2];
};

interface Drive {
  kind: Kind;
  control: Locator;
  // Where the pointer rests and where a press is released: off the control.
  park: [number, number];
  // A row icon sits in a strip only a hovered row shows.
  focusHover: boolean;
  pixelInset: number;
}

// Rest, hover and a held press by pointer; then keyboard focus (a navigation
// key turns key-nav on); a row icon also focused and hovered.
async function measureStates(
  page: Page,
  drive: Drive,
  samplePixel: boolean
): Promise<Partial<Record<State, Paint>>> {
  const { control, park } = drive;
  const found: Partial<Record<State, Paint>> = {};
  await page.mouse.move(...park, { steps: 3 });
  found.rest = await settledPaint(page, control);
  await page.mouse.move(...(await centreOf(control)), { steps: 3 });
  found.hover = await settledPaint(page, control);
  if (samplePixel) {
    const [pixel] = await pixelsAt(page, [
      await fillPointOf(control, drive.pixelInset),
    ]);
    found.hover.pixel = pixel;
  }
  await page.mouse.down();
  found.press = await settledPaint(page, control);
  // Released off the control: no click, so nothing is deleted or closed.
  await page.mouse.move(...park, { steps: 4 });
  await page.mouse.up();
  if (drive.kind === 'menu') return found;
  await page.keyboard.press('Tab');
  await control.focus();
  found.focus = await settledPaint(page, control);
  if (drive.focusHover) {
    await page.mouse.move(...(await centreOf(control)), { steps: 3 });
    found['focus+hover'] = await settledPaint(page, control);
  }
  return found;
}

// One session whose single tab's address carries `pad` extra characters
// (as sync-space-bar.spec.ts), so the meter reads near or full.
function padded(pad: number) {
  const base = buildSession({ tabGroupId: 'big' });
  const tab = base.windows[0].tabs[0];
  return buildContainer([
    {
      ...base,
      windows: [
        {
          ...base.windows[0],
          tabs: [{ ...tab, url: `${tab.url}${'a'.repeat(pad)}` }],
        },
      ],
    },
  ]);
}

interface MeterPaint {
  level: string | null;
  bar: string;
  track: string;
  ground: string;
  vsTrack: number;
  vsGround: number;
  pixel?: string;
}

async function openSyncPane(page: Page, extensionId: string): Promise<void> {
  await page.setViewportSize(POPUP);
  await page.goto(`chrome-extension://${extensionId}/index.html`);
  await page.locator('[aria-label="Settings"]').click();
  await page.locator('button[aria-label="Sync & backup"]').click();
  await expect(page.getByTestId('sync-status')).toBeVisible();
}

async function measureMeter(
  page: Page,
  level: 'near' | 'full',
  samplePixel: boolean
): Promise<MeterPaint> {
  const bar = page.getByTestId('sync-space');
  await expect(bar).toHaveAttribute('data-level', level);
  await bar.scrollIntoViewIfNeeded();
  const fill = bar.locator('[role="meter"] > div');
  // The fill's width eases in (200ms); its colour does not, but wait it out.
  await page.waitForTimeout(400);
  const raw = await bar.evaluate((el) => {
    const meter = el.querySelector('[role="meter"]');
    const fillEl = meter?.firstElementChild;
    if (!meter || !fillEl) throw new Error('no meter');
    let ground: string | null = null;
    for (
      let n = meter.parentElement;
      n !== null && ground === null;
      n = n.parentElement
    ) {
      const b = getComputedStyle(n).backgroundColor;
      if (!b.endsWith(', 0)') && b !== 'transparent') ground = b;
    }
    if (ground === null) throw new Error('no opaque ground behind the meter');
    return {
      level: el.getAttribute('data-level'),
      bar: getComputedStyle(fillEl).backgroundColor,
      track: getComputedStyle(meter).backgroundColor,
      ground,
    };
  });
  const barHex = rgbToHex(raw.bar);
  const track = rgbToHex(raw.track);
  const ground = rgbToHex(raw.ground);
  const measured: MeterPaint = {
    level: raw.level,
    bar: barHex,
    track,
    ground,
    vsTrack: contrast(barHex, track),
    vsGround: contrast(barHex, ground),
  };
  if (samplePixel) {
    [measured.pixel] = await pixelsAt(page, [await centreOf(fill)]);
  }
  return measured;
}

// How far apart two #RRGGBB colours are, at worst over the three channels.
const channelGap = (a: string, b: string): number =>
  Math.max(
    ...[1, 3, 5].map((i) =>
      Math.abs(
        parseInt(a.slice(i, i + 2), 16) - parseInt(b.slice(i, i + 2), 16)
      )
    )
  );

// The token each kind's fill takes per state; null where it paints none of
// its own (a menu item and a row icon at rest show what is behind them).
const RUNGS = (
  C: ThemeColors
): Record<Kind, Record<(typeof POINTER_STATES)[number], string | null>> => ({
  button: {
    rest: C.PRIMARY_COLOR,
    hover: C.DANGER_FILL,
    press: C.DANGER_FILL_DEEP,
  },
  dialog: {
    rest: C.DANGER_FILL,
    hover: C.DANGER_FILL_DEEP,
    press: C.DANGER_FILL_DEEPER,
  },
  menu: { rest: null, hover: C.DANGER_FILL, press: C.DANGER_FILL_DEEP },
  trash: { rest: null, hover: C.DANGER_FILL, press: C.DANGER_FILL_DEEP },
  close: { rest: null, hover: C.DANGER_FILL, press: C.DANGER_FILL_DEEP },
});

// The edge a boxed kind draws per state: the fill's own red once touched.
const EDGES = (
  C: ThemeColors
): Partial<Record<Kind, Record<(typeof POINTER_STATES)[number], string>>> => ({
  button: {
    rest: C.CONTROL_BORDER_COLOR,
    hover: C.DANGER_FILL,
    press: C.DANGER_FILL_DEEP,
  },
  dialog: {
    rest: C.DANGER_FILL,
    hover: C.DANGER_FILL_DEEP,
    press: C.DANGER_FILL_DEEPER,
  },
});

// The ink each kind's label and glyph take at rest; on any red fill it is ON_DANGER_FILL.
const REST_INK = (C: ThemeColors): Record<Kind, string> => ({
  button: C.DANGER_INK,
  dialog: C.ON_DANGER_FILL,
  menu: C.DANGER_INK,
  trash: C.TEXT_COLOR,
  close: C.TEXT_COLOR,
});

// What each kind draws: Delete cloud data and the menu item a glyph and a
// label, the dialog's Delete a label alone, a row icon a glyph alone.
const INKED: Record<Kind, { glyph: boolean; text: boolean }> = {
  button: { glyph: true, text: true },
  dialog: { glyph: false, text: true },
  menu: { glyph: true, text: true },
  trash: { glyph: true, text: false },
  close: { glyph: true, text: false },
};

function expectKind(
  theme: string,
  kind: Kind,
  states: Partial<Record<State, Paint>>,
  C: ThemeColors
): void {
  const at = (state: State): Paint => {
    const paint = states[state];
    if (paint === undefined)
      throw new Error(`${theme} ${kind}: no ${state} reading`);
    return paint;
  };
  const [rest, hover, press] = [at('rest'), at('hover'), at('press')];
  const label = `${theme} ${kind}`;

  // Each state answers: a visible step between every pair of rungs.
  expect(
    contrast(hover.fill, press.fill),
    `${label}: hover ${hover.fill} vs press ${press.fill}`
  ).toBeGreaterThanOrEqual(1.2);
  expect(
    contrast(rest.fill, hover.fill),
    `${label}: rest ${rest.fill} vs hover ${hover.fill}`
  ).toBeGreaterThanOrEqual(1.2);
  expect(
    contrast(rest.fill, press.fill),
    `${label}: rest ${rest.fill} vs press ${press.fill}`
  ).toBeGreaterThanOrEqual(1.2);

  // The fills are the spec's tokens for this kind.
  const rungs = RUNGS(C)[kind];
  const edges = EDGES(C)[kind];
  for (const state of POINTER_STATES) {
    const paint = at(state);
    const token = rungs[state];
    if (edges !== undefined) {
      expect(paint.edge, `${label} ${state} edge`).toEqual({
        color: tokenHex(edges[state]),
        width: '1px',
      });
    }
    if (token === null) {
      expect(
        paint.ownFillTransparent,
        `${label} ${state}: paints no fill of its own`
      ).toBe(true);
    } else {
      expect(paint.fill, `${label} ${state} fill`).toBe(tokenHex(token));
    }
  }

  // Ink: the kind's resting ink, ON_DANGER_FILL on any red fill; text ≥ 4.5, glyph ≥ 3.
  for (const state of STATES) {
    const paint = states[state];
    if (paint === undefined) continue;
    const onRed = kind === 'dialog' || (state !== 'rest' && state !== 'focus');
    const ink = onRed ? C.ON_DANGER_FILL : REST_INK(C)[kind];
    expect(
      {
        glyph: paint.inks.some((i) => i.glyph),
        text: paint.inks.some((i) => !i.glyph),
      },
      `${label} ${state}: the inks measured`
    ).toEqual(INKED[kind]);
    for (const i of paint.inks) {
      expect(i.color, `${label} ${state} "${i.what}" ink`).toBe(tokenHex(ink));
      expect(
        i.ratio,
        `${label} ${state} "${i.what}" ${i.color} on ${paint.fill}`
      ).toBeGreaterThanOrEqual(i.glyph ? 3 : 4.5);
    }
  }

  // Focus: the app's inset ring, ≥ 3 against the fill inside it. Menu items: menu-focus-ring.spec.ts (KAN-726).
  if (kind === 'menu') return;
  const focused: State[] =
    kind === 'trash' || kind === 'close' ? ['focus', 'focus+hover'] : ['focus'];
  for (const state of focused) {
    const paint = at(state);
    expect(paint.keyNav, `${label} ${state}: key-nav is on`).toBe(true);
    expect(paint.ring, `${label} ${state}: a ring is drawn`).not.toBeNull();
    if (paint.ring === null) continue;
    expect(
      [paint.ring.width, paint.ring.offset],
      `${label} ${state}: inset ring`
    ).toEqual(['2px', '-4px']);
    expect(
      paint.ring.ratio,
      `${label} ${state} ring ${paint.ring.color} on ${paint.fill}`
    ).toBeGreaterThanOrEqual(3);
  }
  if (kind === 'trash' || kind === 'close') {
    expect(at('focus+hover').fill, `${label} focus+hover fill`).toBe(
      tokenHex(C.DANGER_FILL)
    );
    expect(at('focus+hover').ring?.color, `${label} focus+hover ring`).toBe(
      tokenHex(C.ON_DANGER_FILL)
    );
  }
}

test.setTimeout(150_000);

for (const [theme, COLORS] of THEMES) {
  test(`destructive controls answer touch and stay legible in ${theme} (KAN-725)`, async ({
    context,
    extensionId,
    serviceWorker,
  }) => {
    // Declined with a stored id: Delete cloud data opens its dialog with no cloud check (CI has none).
    await seedSettings(context, {
      theme,
      cloudConsent: 'declined',
      isAutoSync: false,
      foldSavedSessionInTabView: false,
    });
    await seedSessions(context, {
      ...buildContainer([
        {
          ...session('S1', 'Reading list', [savedWindow('w1', '', 3)]),
          isSelected: true,
        },
      ]),
      selectedTabGroupId: 'S1',
    });
    await putDeviceId(serviceWorker);
    // Live tabs for Open now, opened now so Chrome has titled them by the time it is read.
    await serviceWorker.evaluate(
      (urls) => chrome.windows.create({ focused: false, url: urls }),
      LIVE_TITLES.map((t) => `data:text/html,<title>${t}</title>`)
    );

    const pixels = theme === 'Light';
    const states: Partial<Record<Kind, Partial<Record<State, Paint>>>> = {};
    const page = await context.newPage();

    // Settings › Sync & backup › Delete cloud data.
    await openSyncPane(page, extensionId);
    const button = page.getByRole('button', { name: 'Delete cloud data' });
    await button.scrollIntoViewIfNeeded();
    const b = await button.boundingBox();
    if (b === null) throw new Error('no Delete cloud data button');
    states.button = await measureStates(
      page,
      {
        kind: 'button',
        control: button,
        park: [b.x + b.width + 120, b.y - 30],
        focusHover: false,
        pixelInset: 6,
      },
      pixels
    );

    // Its dialog's Delete.
    await page.mouse.move(1, 1);
    await button.click();
    const dialog = page.getByRole('dialog', {
      name: 'Delete your cloud data?',
    });
    await expect(dialog).toBeVisible();
    const confirm = dialog.getByRole('button', { name: 'Delete', exact: true });
    const d = await dialog.boundingBox();
    if (d === null) throw new Error('no dialog');
    states.dialog = await measureStates(
      page,
      {
        kind: 'dialog',
        control: confirm,
        park: [d.x + 24, d.y + 24],
        focusHover: false,
        pixelInset: 6,
      },
      pixels
    );
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);

    // Session ⋮ › Delete session.
    await page.goto(`chrome-extension://${extensionId}/index.html`);
    await expect(page.locator(SAVED_ROW)).toBeVisible();
    await sessionHeaderMenu(page).click();
    const menu = page.getByRole('menu');
    await expect(menu).toBeVisible();
    const m = await menu.boundingBox();
    if (m === null) throw new Error('no menu');
    states.menu = await measureStates(
      page,
      {
        kind: 'menu',
        control: menu.locator('[data-menu-item="delete"]'),
        park: [m.x - 40, m.y + 10],
        focusHover: false,
        pixelInset: 6,
      },
      pixels
    );
    await page.keyboard.press('Escape');

    // A saved row's trash, its row hovered; released along the row, a drag back to where it was.
    await page.goto(`chrome-extension://${extensionId}/index.html`);
    const row = page.locator(SAVED_ROW);
    await expect(row).toBeVisible();
    const r = await row.boundingBox();
    if (r === null) throw new Error('no saved row');
    await page.mouse.move(r.x + r.width * 0.45, r.y + r.height / 2, {
      steps: 3,
    });
    states.trash = await measureStates(
      page,
      {
        kind: 'trash',
        control: row.getByRole('button', { name: 'Delete tab', exact: true }),
        park: [r.x + r.width * 0.45, r.y + r.height / 2],
        focusHover: true,
        pixelInset: 2,
      },
      pixels
    );
    await expect(page.locator(SAVED_ROW)).toBeVisible();

    // An Open now row's ×, on a live tab.
    await page.setViewportSize(TAB_VIEW);
    await page.goto(`chrome-extension://${extensionId}/index.html?view=tab`);
    const liveRow = page.locator(OPEN_NOW).getByRole('button', {
      name: `Switch to tab: ${LIVE_TITLES[1]}`,
      exact: true,
    });
    await expect(liveRow).toBeVisible({ timeout: 15_000 });
    await liveRow.scrollIntoViewIfNeeded();
    const l = await liveRow.boundingBox();
    if (l === null) throw new Error('no live row');
    await page.mouse.move(l.x + l.width * 0.45, l.y + l.height / 2, {
      steps: 3,
    });
    states.close = await measureStates(
      page,
      {
        kind: 'close',
        control: page.locator(OPEN_NOW).getByRole('button', {
          name: `Close tab: ${LIVE_TITLES[1]}`,
          exact: true,
        }),
        park: [l.x + l.width * 0.45, l.y + l.height / 2],
        focusHover: true,
        pixelInset: 2,
      },
      pixels
    );
    await expect(liveRow).toBeVisible();

    // The sync meter, near the limit and past it.
    const meters: Partial<Record<'near' | 'full', MeterPaint>> = {};
    for (const [level, pad] of [
      ['near', 900_000],
      ['full', 1_150_000],
    ] as const) {
      await seedSessions(context, padded(pad));
      await openSyncPane(page, extensionId);
      meters[level] = await measureMeter(page, level, pixels);
      if (SHOTS && (theme === 'Darkenheimer' || theme === 'Blue')) {
        mkdirSync(SHOTS, { recursive: true });
        const status = await page.getByTestId('sync-status').boundingBox();
        const meterBox = await page.getByTestId('sync-space').boundingBox();
        if (status === null || meterBox === null) throw new Error('no meter');
        const x = Math.max(0, Math.min(status.x, meterBox.x) - 14);
        await page.screenshot({
          path: join(SHOTS, `meter-${theme}-${level}.png`),
          clip: {
            x,
            y: status.y - 4,
            width: Math.min(
              POPUP.width - x,
              Math.max(status.width, meterBox.width) + 28
            ),
            height: meterBox.y + meterBox.height - status.y + 12,
          },
        });
      }
    }

    const worst = (pick: (p: Paint) => number[]) =>
      Math.min(
        ...Object.values(states).flatMap((s) => Object.values(s).flatMap(pick))
      );
    const summary = {
      theme,
      text: worst((p) => p.inks.filter((i) => !i.glyph).map((i) => i.ratio)),
      glyph: worst((p) => p.inks.filter((i) => i.glyph).map((i) => i.ratio)),
      ring: worst((p) => (p.ring ? [p.ring.ratio] : [])),
      rung: Math.min(
        ...Object.values(states).flatMap((s) =>
          s.rest && s.hover && s.press
            ? [
                contrast(s.rest.fill, s.hover.fill),
                contrast(s.hover.fill, s.press.fill),
                contrast(s.rest.fill, s.press.fill),
              ]
            : []
        )
      ),
      meters,
    };
    console.log(`[destructive] ${JSON.stringify(summary)}`);
    if (SHOTS) {
      mkdirSync(SHOTS, { recursive: true });
      writeFileSync(
        join(SHOTS, `measured-${theme}.json`),
        JSON.stringify({ summary, states }, null, 1)
      );
    }

    for (const kind of KINDS) {
      const measured = states[kind];
      if (measured === undefined) throw new Error(`${kind} was not measured`);
      expectKind(theme, kind, measured, COLORS);
    }

    for (const level of ['near', 'full'] as const) {
      const meter = meters[level];
      if (meter === undefined) throw new Error(`no ${level} meter`);
      expect(meter.bar, `${theme} ${level} bar`).toBe(
        tokenHex(COLORS.DANGER_MARK)
      );
      expect(meter.track, `${theme} ${level} track`).toBe(
        tokenHex(COLORS.DIVIDER_COLOR)
      );
      expect(
        meter.vsTrack,
        `${theme} ${level} bar vs track`
      ).toBeGreaterThanOrEqual(3);
      expect(
        meter.vsGround,
        `${theme} ${level} bar vs ground ${meter.ground}`
      ).toBeGreaterThanOrEqual(3);
    }

    // Light: the computed fill is what is painted, within 6 per channel, so a
    // fill set and painted over fails.
    if (pixels) {
      for (const kind of KINDS) {
        const hover = states[kind]?.hover;
        expect(hover?.pixel, `${kind}: pixel sampled`).toBeDefined();
        if (hover?.pixel === undefined) continue;
        expect(
          channelGap(hover.pixel, hover.fill),
          `${kind} painted ${hover.pixel} vs computed ${hover.fill}`
        ).toBeLessThanOrEqual(6);
      }
      const near = meters.near;
      expect(near?.pixel, 'meter: pixel sampled').toBeDefined();
      if (near?.pixel !== undefined) {
        expect(
          channelGap(near.pixel, near.bar),
          `meter painted ${near.pixel} vs computed ${near.bar}`
        ).toBeLessThanOrEqual(6);
      }
    }
  });
}
