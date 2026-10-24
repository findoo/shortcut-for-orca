// Renders build/*.svg to the PNG icons. Run after editing an SVG: pnpm exec electron scripts/icons.mjs
import { app, BrowserWindow } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { setTimeout } from 'node:timers/promises';

const dir = path.join(import.meta.dirname, '..', 'build');

const SIZE = 1024; // render big, then scale down
const jobs = [
  ['icon.svg', 'icon.png', 1024],
  ['tray.svg', '../src/app/trayTemplate.png', 16],
  ['tray.svg', '../src/app/trayTemplate@2x.png', 32],
];
const page = (svg) =>
  `<body style="margin:0;background:transparent">${svg.replace(/width="\d+" height="\d+"/, `width="${SIZE}" height="${SIZE}"`)}</body>`;

app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, width: SIZE, height: SIZE, transparent: true, frame: false, webPreferences: { offscreen: true } });
  await win.loadURL('about:blank');
  for (const [src, out, size] of jobs) {
    const html = page(fs.readFileSync(path.join(dir, src), 'utf8'));
    await win.webContents.executeJavaScript(`document.documentElement.innerHTML = ${JSON.stringify(html)}`);
    await setTimeout(200); // let the SVG paint
    const img = await win.webContents.capturePage({ x: 0, y: 0, width: SIZE, height: SIZE });
    fs.writeFileSync(path.join(dir, out), img.resize({ width: size, height: size, quality: 'best' }).toPNG());
  }
  app.quit();
});
