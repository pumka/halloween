// Adds a content-hash version (?v=...) to every css/ and js/ reference in the HTML pages,
// so browsers load the new file after an update instead of a cached copy.
// Run:  node tools/version.js   (the git pre-commit hook runs it automatically)
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const dir = path.join(__dirname, '..');
const hashes = new Map();
function hashOf(file) {
  if (!hashes.has(file)) {
    const data = fs.readFileSync(path.join(dir, file));
    hashes.set(file, crypto.createHash('sha1').update(data).digest('hex').slice(0, 8));
  }
  return hashes.get(file);
}

for (const page of fs.readdirSync(dir).filter(f => f.endsWith('.html'))) {
  const file = path.join(dir, page);
  const html = fs.readFileSync(file, 'utf8');
  const updated = html.replace(/(href|src)="((?:css|js)\/[^"?]+)(\?v=[^"]*)?"/g,
    (_, attr, asset) => `${attr}="${asset}?v=${hashOf(asset)}"`);
  if (updated !== html) {
    fs.writeFileSync(file, updated);
    console.log('updated ' + page);
  }
}
