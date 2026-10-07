const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const dist = path.join(root, 'prototype', 'dist');
let html = fs.readFileSync(path.join(dist, 'index.html'), 'utf8');
html = html.replace('<link rel="stylesheet" href="styles.css">', () => `<style>${fs.readFileSync(path.join(dist, 'styles.css'), 'utf8')}</style>`);
for (const name of ['qrcode.min.js', 'domain.js', 'repository.js', 'app.js']) {
  const script = fs.readFileSync(path.join(dist, name), 'utf8').replace(/<\/script/gi, '<\\/script');
  html = html.replace(`<script src="${name}" defer></script>`, () => `<script>${script}</script>`);
}
fs.writeFileSync(path.join(root, 'prototype', 'HumanProof_프로토타입.html'), html);
console.log('Standalone HTML rebuilt from dist sources.');
