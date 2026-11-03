// KAN-907. Draws Chrome's icons (public/icons/icon{16,32,48,128}.png) from TabKeeperMark, so they keep its shape.
// Run: node scripts/render_icons.mjs [outDir]
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { chromium } from '@playwright/test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';

import { icon16Pixels } from './icon16_pixels.mjs';
import { ICON_FILL, iconSvg } from './icon_palette.mjs';
import { encodePng } from './png.mjs';

// 16 is pixelled by hand (icon16_pixels.mjs); the rest are drawn from the mark.
const DRAWN = [32, 48, 128];

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const outDir = resolve(process.argv[2] ?? 'public/icons');
  const vite = await createServer({
    server: { middlewareMode: true },
    appType: 'custom',
    logLevel: 'error',
  });
  const browser = await chromium.launch();
  try {
    const { default: TabKeeperMark } = await vite.ssrLoadModule(
      '/src/components/common/TabKeeperMark.tsx'
    );
    const svg = iconSvg(renderToStaticMarkup(createElement(TabKeeperMark)));
    const page = await browser.newPage({ deviceScaleFactor: 1 });
    const fill = (mark) => ICON_FILL[mark];
    writeFileSync(
      resolve(outDir, 'icon16.png'),
      encodePng(
        icon16Pixels({
          ground: fill('#99bf9d'),
          body: fill('#445562'),
          shadow: fill('#253038'),
          cream: fill('#f4eae2'),
          dark: fill('#20292e'),
          orange: fill('#d09263'),
        })
      )
    );
    console.log('icon16.png');
    for (const px of DRAWN) {
      await page.setViewportSize({ width: px, height: px });
      await page.setContent(
        `<style>html,body{margin:0;background:transparent}svg{display:block;width:${px}px;height:${px}px}</style>${svg}`
      );
      const png = await page.screenshot({ omitBackground: true });
      writeFileSync(resolve(outDir, `icon${px}.png`), png);
      console.log(`icon${px}.png`);
    }
  } finally {
    await browser.close();
    await vite.close();
  }
}
