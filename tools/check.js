// Checks every puzzle page (all .html files except index.html): exactly one solution? which rules are unnecessary?
// Run:  node tools/check.js
const fs = require('fs');
const path = require('path');
const { Model, rules } = require('../js/engine.js');

const dir = path.join(__dirname, '..');
const pages = fs.readdirSync(dir).filter(f => f.endsWith('.html') && f !== 'index.html').sort();

for (const page of pages) {
  const html = fs.readFileSync(path.join(dir, page), 'utf8');
  const script = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]).join('\n');
  let cfg;
  new Function('LogicGame', script)({ rules, start: c => { cfg = c; } });

  const m = new Model(cfg);
  const board = m.emptyBoard();
  (cfg.given || []).forEach(([name, col]) => {
    const { row, item } = m.locate(name);
    board[row][col - 1] = item;
  });
  const sols = m.solutions(board, 3);
  console.log(`\n=== ${page}: ${cfg.title}`);
  if (sols.length !== 1) {
    console.log(sols.length === 0 ? '  ❌ KEINE Lösung' : '  ❌ Mehr als eine Lösung');
    continue;
  }
  console.log('  ✅ genau eine Lösung');
  sols[0].forEach((cells, r) => {
    console.log('  ' + m.rows[r].label.padEnd(16) + cells.map(i => m.rows[r].items[i].name.padEnd(15)).join(''));
  });
  const all = m.allRuleIdxs();
  const redundant = all.filter(i => {
    const rest = all.filter(j => j !== i);
    return m.solutions(board, 2).length === 1 && new Model({ ...cfg, rules: rest.map(j => cfg.rules[j]) })
      .solutions(board, 2).length === 1;
  });
  if (redundant.length) console.log('  ℹ️  Einzeln verzichtbare Regeln: ' + redundant.map(i => i + 1).join(', '));
}
