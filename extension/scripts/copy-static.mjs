import { cp, mkdir } from 'node:fs/promises';
await mkdir('dist', { recursive: true });
for (const file of ['popup.html', 'options.html', 'popup.css', 'icon.png']) await cp(`src/${file}`, `dist/${file}`);
await cp('src/icons', 'dist/icons', { recursive: true });
