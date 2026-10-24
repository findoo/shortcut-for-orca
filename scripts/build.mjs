import { build } from 'esbuild';
import { copyFileSync, existsSync, mkdirSync } from 'node:fs';

mkdirSync('dist', { recursive: true });
const common = { bundle: true, logLevel: 'info' };
await Promise.all([
  build({ ...common, entryPoints: ['src/app/main.ts'], outfile: 'dist/main.cjs', platform: 'node', format: 'cjs', external: ['electron'] }),
  build({ ...common, entryPoints: ['src/app/preload.ts'], outfile: 'dist/preload.cjs', platform: 'node', format: 'cjs', external: ['electron'] }),
  build({ ...common, entryPoints: ['src/app/renderer.ts'], outfile: 'dist/renderer.js', platform: 'browser', format: 'iife', loader: { '.md': 'text' } }),
]);
for (const f of ['index.html', 'styles.css']) if (existsSync(`src/app/${f}`)) copyFileSync(`src/app/${f}`, `dist/${f}`);
