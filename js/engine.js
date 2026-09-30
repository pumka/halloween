/*
 * Halloween logic puzzle engine ("Profile Perfect" style).
 *
 * A puzzle is a table: columns are positions (1..N), rows are categories
 * (Wissenschaftler, Gegenstand, Ort, ...). Each row holds every one of its N
 * items exactly once. Rules are predicates over the finished table; the engine
 * brute-forces all tables to find the solution, to tell which rules a wrong
 * choice contradicts and which rules are already fulfilled.
 *
 * Usage in a page:   LogicGame.start({ ...config... })   (see alexia.html)
 */
(function (global) {
  'use strict';

  // ---------------------------------------------------------------------------
  // Rule helpers. Columns are 1-based: the leftmost column is 1.
  // Every helper returns a function (s) => boolean, where s.col(name) gives the
  // column of an item and s.columns the number of columns.
  // ---------------------------------------------------------------------------
  const R = {
    same: (a, b) => s => s.col(a) === s.col(b),
    notSame: (a, b) => s => s.col(a) !== s.col(b),
    leftOf: (a, b) => s => s.col(a) < s.col(b),
    rightOf: (a, b) => s => s.col(a) > s.col(b),
    directlyLeftOf: (a, b) => s => s.col(a) === s.col(b) - 1,
    directlyRightOf: (a, b) => s => s.col(a) === s.col(b) + 1,
    nextTo: (a, b) => s => Math.abs(s.col(a) - s.col(b)) === 1,
    notNextTo: (a, b) => s => Math.abs(s.col(a) - s.col(b)) !== 1,
    inColumn: (a, n) => s => s.col(a) === n,
    notInColumn: (a, n) => s => s.col(a) !== n,
    atEdge: a => s => s.col(a) === 1 || s.col(a) === s.columns,
    notAtEdge: a => s => s.col(a) !== 1 && s.col(a) !== s.columns,
    // a is somewhere between b and c (in either order)
    between: (a, b, c) => s => {
      const x = s.col(a),
        y = s.col(b),
        z = s.col(c);
      return (y < x && x < z) || (z < x && x < y);
    },
    all:
      (...fns) =>
      s =>
        fns.every(f => f(s)),
    any:
      (...fns) =>
      s =>
        fns.some(f => f(s)),
    not: f => s => !f(s),
  };

  function permutations(n) {
    const out = [];
    const cur = [];
    const used = new Array(n).fill(false);
    (function rec() {
      if (cur.length === n) {
        out.push(cur.slice());
        return;
      }
      for (let i = 0; i < n; i++) {
        if (used[i]) continue;
        used[i] = true;
        cur.push(i);
        rec();
        cur.pop();
        used[i] = false;
      }
    })();
    return out;
  }

  // ---------------------------------------------------------------------------
  // Model: pure puzzle logic, no DOM.
  // A board is rows x cols of item index or -1.
  // ---------------------------------------------------------------------------
  function Model(cfg) {
    this.columns = cfg.columns.map(c =>
      typeof c === 'string' ? { label: c } : c,
    );
    this.nCols = this.columns.length;
    this.rows = cfg.rows.map((row, r) => {
      // "|" in a name marks where a long word may wrap (shown as a hyphen);
      // rules use the name without it.
      const items = row.items
        .map(it => (typeof it === 'string' ? { name: it } : { ...it }))
        .map(it => ({
          ...it,
          display: it.name,
          name: it.name.replace(/\|/g, ''),
        }));
      if (items.length !== this.nCols) {
        throw new Error(
          `Zeile "${row.label}" hat ${items.length} Einträge, ` +
            `erwartet ${this.nCols}.`,
        );
      }
      return { label: row.label, items, index: r };
    });
    this.nRows = this.rows.length;
    this.nameToId = new Map();
    this.rows.forEach((row, r) =>
      row.items.forEach((it, i) => {
        if (this.nameToId.has(it.name))
          throw new Error(`"${it.name}" kommt doppelt vor.`);
        this.nameToId.set(it.name, r * this.nCols + i);
      }),
    );
    this.rules = cfg.rules.map(rule => rule.check);
    this.perms = permutations(this.nCols);
    this.posOf = new Int8Array(this.nRows * this.nCols);
    const self = this;
    this.S = {
      columns: this.nCols,
      col(name) {
        const id = self.nameToId.get(name);
        if (id === undefined)
          throw new Error(`Unbekannter Name in einer Regel: "${name}"`);
        return self.posOf[id] + 1;
      },
    };
  }

  Model.prototype.emptyBoard = function () {
    return this.rows.map(() => new Array(this.nCols).fill(-1));
  };

  Model.prototype.locate = function (name) {
    const id = this.nameToId.get(name);
    if (id === undefined) throw new Error(`Unbekannter Name: "${name}"`);
    return { row: Math.floor(id / this.nCols), item: id % this.nCols };
  };

  // Calls cb(S) for every full table consistent with the board;
  // stops if cb returns true.
  Model.prototype.enumerate = function (board, cb) {
    const nCols = this.nCols,
      posOf = this.posOf,
      S = this.S;
    const rowPerms = board.map(cells =>
      this.perms.filter(p =>
        p.every((it, c) => cells[c] < 0 || cells[c] === it),
      ),
    );
    const nRows = this.nRows;
    return (function rec(r) {
      if (r === nRows) return cb(S) === true;
      const base = r * nCols;
      for (const p of rowPerms[r]) {
        for (let c = 0; c < nCols; c++) posOf[base + p[c]] = c;
        if (rec(r + 1)) return true;
      }
      return false;
    })(0);
  };

  Model.prototype.satisfiable = function (board, ruleIdxs) {
    const rules = ruleIdxs.map(i => this.rules[i]);
    return this.enumerate(board, S => rules.every(f => f(S)));
  };

  Model.prototype.allRuleIdxs = function () {
    return this.rules.map((_, i) => i);
  };

  // Returns up to `limit` solutions as boards.
  Model.prototype.solutions = function (board, limit) {
    const out = [];
    const all = this.rules;
    this.enumerate(board, S => {
      if (!all.every(f => f(S))) return false;
      const b = this.emptyBoard();
      for (let id = 0; id < this.posOf.length; id++) {
        b[Math.floor(id / this.nCols)][this.posOf[id]] = id % this.nCols;
      }
      out.push(b);
      return out.length >= limit;
    });
    return out;
  };

  // For every rule: is it true no matter how the empty cells get filled?
  Model.prototype.entailed = function (board) {
    const flags = this.rules.map(() => true);
    let remaining = flags.length;
    this.enumerate(board, S => {
      for (let i = 0; i < flags.length; i++) {
        if (flags[i] && !this.rules[i](S)) {
          flags[i] = false;
          remaining--;
        }
      }
      return remaining === 0;
    });
    return flags;
  };

  Model.prototype.withPlacement = function (board, row, col, item) {
    const b = board.map(r => r.slice());
    b[row][col] = item;
    return b;
  };

  Model.prototype.isCorrect = function (board, row, col, item) {
    return this.satisfiable(
      this.withPlacement(board, row, col, item),
      this.allRuleIdxs(),
    );
  };

  // Minimal set of rules that together forbid this placement.
  Model.prototype.conflictingRules = function (board, row, col, item) {
    const b = this.withPlacement(board, row, col, item);
    let set = this.allRuleIdxs();
    if (this.satisfiable(b, set)) return [];
    for (const i of set.slice()) {
      const trial = set.filter(j => j !== i);
      if (!this.satisfiable(b, trial)) set = trial;
    }
    return set;
  };

  // ---------------------------------------------------------------------------
  // UI
  // ---------------------------------------------------------------------------
  const ROW_CLASSES = ['c0', 'c1', 'c2', 'c3', 'c4'];

  function el(tag, cls, html) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html !== undefined) e.innerHTML = html;
    return e;
  }

  function escapeHtml(s) {
    return String(s).replace(
      /[&<>"']/g,
      ch =>
        ({
          '&': '&amp;',
          '<': '&lt;',
          '>': '&gt;',
          '"': '&quot;',
          "'": '&#39;',
        })[ch],
    );
  }

  // An icon is an emoji, or an image file path such as 'img/usb.svg'.
  function iconHtml(icon) {
    if (!icon) return '';
    if (/\.(svg|png|jpe?g|gif|webp)$/i.test(icon)) {
      return `<img class="icon-img" src="${escapeHtml(icon)}" alt="">`;
    }
    return escapeHtml(icon);
  }

  // Item name as HTML, with "|" turned into soft hyphens (break points).
  function nameHtml(it) {
    return escapeHtml(it.display).replace(/\|/g, '&shy;');
  }

  function escapeRegex(s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  function storageGet(key) {
    try {
      return JSON.parse(localStorage.getItem(key));
    } catch (e) {
      return null;
    }
  }
  function storageSet(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch (e) {
      /* ignore */
    }
  }
  function storageDel(key) {
    try {
      localStorage.removeItem(key);
    } catch (e) {
      /* ignore */
    }
  }

  function Game(cfg, root) {
    this.cfg = cfg;
    this.root = root;
    this.model = new Model(cfg);
    this.storageKey = 'halloween-logic-' + (cfg.id || location.pathname);
    this.givens = new Set();
    this.selected = null;
    this.popup = null;
  }

  Game.prototype.init = function () {
    const m = this.model;
    this.board = m.emptyBoard();
    (this.cfg.given || []).forEach(([name, col]) => {
      const { row, item } = m.locate(name);
      this.board[row][col - 1] = item;
      this.givens.add(row + ',' + (col - 1));
    });
    this.wrong = {};

    // Sanity check the puzzle so a parent notices mistakes while configuring.
    const problems = [];
    try {
      m.enumerate(this.board, S => {
        m.rules.forEach(f => f(S));
        return true;
      });
      const sols = m.solutions(this.board, 2);
      if (sols.length === 0)
        problems.push(
          'Das Rätsel hat KEINE Lösung – die Regeln widersprechen sich.',
        );
      if (sols.length > 1)
        problems.push(
          'Das Rätsel hat mehr als eine Lösung – es fehlt noch eine Regel.',
        );
      if (sols.length && /[?&]debug\b/.test(location.search)) {
        console.table(
          sols[0].map((cells, r) => {
            const o = { Zeile: m.rows[r].label };
            cells.forEach((it, c) => {
              o[m.columns[c].label] = m.rows[r].items[it].name;
            });
            return o;
          }),
        );
      }
    } catch (e) {
      problems.push(e.message);
    }
    this.problems = problems;

    this.restore();
    this.render();
    this.updateRules(false);
    if (this.isComplete()) this.showWin(false);
  };

  Game.prototype.restore = function () {
    const saved = storageGet(this.storageKey);
    if (!saved || !Array.isArray(saved.board)) return;
    const m = this.model;
    const b = saved.board;
    const ok =
      b.length === m.nRows &&
      b.every(r => Array.isArray(r) && r.length === m.nCols) &&
      this.problems.length === 0 &&
      m.satisfiable(b, m.allRuleIdxs());
    if (!ok) {
      storageDel(this.storageKey);
      return;
    }
    this.board = b;
    this.wrong = saved.wrong || {};
  };

  Game.prototype.save = function () {
    storageSet(this.storageKey, { board: this.board, wrong: this.wrong });
  };

  Game.prototype.reset = function () {
    storageDel(this.storageKey);
    this.root.innerHTML = '';
    this.givens.clear();
    this.init();
  };

  Game.prototype.isComplete = function () {
    return this.board.every(r => r.every(v => v >= 0));
  };

  Game.prototype.itemHtml = function (row, item, small) {
    const it = this.model.rows[row].items[item];
    return (
      `<span class="piece-icon">${iconHtml(it.icon)}</span>` +
      `<span class="piece-name${small ? ' small' : ''}">${nameHtml(it)}</span>`
    );
  };

  // Turns item names in rule text into colored tags with icons.
  Game.prototype.ruleHtml = function (text) {
    const names = [];
    this.model.rows.forEach((row, r) =>
      row.items.forEach(it => names.push({ it, r })),
    );
    names.sort((a, b) => b.it.name.length - a.it.name.length);
    if (!names.length) return escapeHtml(text);
    const re = new RegExp(
      names.map(n => escapeRegex(n.it.name)).join('|'),
      'g',
    );
    const byName = new Map(names.map(n => [n.it.name, n]));
    let out = '',
      last = 0,
      mt;
    while ((mt = re.exec(text))) {
      out += escapeHtml(text.slice(last, mt.index));
      const { it, r } = byName.get(mt[0]);
      // Word joiner (&#8288;) keeps the icon on the same line as the name.
      out +=
        `<span class="tag ${ROW_CLASSES[r % ROW_CLASSES.length]}">` +
        (it.icon
          ? `<span class="tag-icon">${iconHtml(it.icon)}</span>&#8288;`
          : '') +
        `${nameHtml(it)}</span>`;
      last = mt.index + mt[0].length;
    }
    return out + escapeHtml(text.slice(last));
  };

  Game.prototype.render = function () {
    const cfg = this.cfg,
      m = this.model;
    const root = this.root;

    const head = el('header', 'game-head');
    const title = escapeHtml(cfg.title || 'Rätsel');
    head.appendChild(el('h1', 'game-title', title));
    if (cfg.intro)
      head.appendChild(el('p', 'game-intro', escapeHtml(cfg.intro)));
    root.appendChild(head);

    if (this.problems.length) {
      root.appendChild(
        el(
          'div',
          'config-warning',
          '<b>Hinweis für Erwachsene:</b><br>' +
            this.problems.map(escapeHtml).join('<br>'),
        ),
      );
    }

    // Board
    // Board and rules sit side by side on wide screens (see .play in game.css).
    const play = el('div', 'play');
    root.appendChild(play);
    const wrap = el('div', 'board-wrap');
    const grid = el('div', 'board');
    const cellCols = `repeat(${m.nCols}, minmax(0, 1fr))`;
    grid.style.gridTemplateColumns = `minmax(64px, auto) ${cellCols}`;
    grid.appendChild(el('div', 'corner'));
    m.columns.forEach(c => {
      grid.appendChild(
        el(
          'div',
          'col-head',
          (c.icon ? `<span class="col-icon">${iconHtml(c.icon)}</span>` : '') +
            `<span class="col-label">${escapeHtml(c.label)}</span>`,
        ),
      );
    });
    this.cells = [];
    m.rows.forEach((row, r) => {
      grid.appendChild(el('div', 'row-head', escapeHtml(row.label)));
      this.cells[r] = [];
      for (let c = 0; c < m.nCols; c++) {
        const cell = el(
          'button',
          'cell ' + ROW_CLASSES[r % ROW_CLASSES.length],
        );
        cell.type = 'button';
        cell.addEventListener('click', ev => {
          ev.stopPropagation();
          this.onCellClick(r, c);
        });
        grid.appendChild(cell);
        this.cells[r][c] = cell;
        this.paintCell(r, c, false);
      }
    });
    wrap.appendChild(grid);
    play.appendChild(wrap);
    this.wrap = wrap;

    // Rules drawer
    const drawer = el('section', 'drawer');
    const bar = el('div', 'drawer-bar');
    this.counter = el('div', 'rule-counter');
    bar.appendChild(this.counter);
    const resetBtn = el('button', 'reset-btn', '↺ Neu starten');
    resetBtn.type = 'button';
    resetBtn.addEventListener('click', () => {
      if (confirm('Wirklich von vorne anfangen?')) this.reset();
    });
    bar.appendChild(resetBtn);
    drawer.appendChild(bar);
    const list = el('div', 'rules');
    this.ruleCards = cfg.rules.map((rule, i) => {
      const card = el(
        'div',
        'rule',
        `<span class="rule-num">${i + 1}</span>` +
          `<span class="rule-check">✓</span>` +
          `<span class="rule-text">${this.ruleHtml(rule.text)}</span>`,
      );
      card.dataset.index = i;
      list.appendChild(card);
      return card;
    });
    drawer.appendChild(list);
    play.appendChild(drawer);
    this.ruleList = list;

    this.toast = el('div', 'toast');
    document.body.appendChild(this.toast);

    if (!this.docListener) {
      this.docListener = () => this.closePopup();
      document.addEventListener('click', this.docListener);
      window.addEventListener('resize', () => this.positionPopup());
    }
  };

  Game.prototype.paintCell = function (r, c, animate) {
    const cell = this.cells[r][c];
    const v = this.board[r][c];
    const given = this.givens.has(r + ',' + c);
    cell.classList.toggle('filled', v >= 0);
    cell.classList.toggle('given', given);
    cell.disabled = v >= 0;
    const pieceClass = animate ? 'piece pop' : 'piece';
    cell.innerHTML =
      v >= 0
        ? `<span class="${pieceClass}">${this.itemHtml(r, v, true)}</span>`
        : '';
  };

  Game.prototype.onCellClick = function (r, c) {
    if (this.board[r][c] >= 0) return;
    if (this.selected && this.selected.r === r && this.selected.c === c) {
      this.closePopup();
      return;
    }
    this.openPopup(r, c);
  };

  Game.prototype.openPopup = function (r, c) {
    this.closePopup();
    const m = this.model;
    this.selected = { r, c };
    this.cells[r][c].classList.add('selected');
    const used = new Set(this.board[r].filter(v => v >= 0));
    const wrong = new Set(this.wrong[r + ',' + c] || []);
    const pop = el('div', 'popup');
    pop.addEventListener('click', ev => ev.stopPropagation());
    pop.appendChild(el('div', 'popup-arrow'));
    const tiles = el('div', 'popup-tiles');
    // Alphabetical, so the option order doesn't give away the solution
    // order from the config.
    const order = m.rows[r].items
      .map((it, i) => i)
      .sort((a, b) =>
        m.rows[r].items[a].name.localeCompare(m.rows[r].items[b].name, 'de'),
      );
    order.forEach(i => {
      if (used.has(i)) return;
      const t = el(
        'button',
        'tile' + (wrong.has(i) ? ' crossed' : ''),
        this.itemHtml(r, i),
      );
      t.type = 'button';
      if (wrong.has(i)) t.disabled = true;
      t.addEventListener('click', () => this.choose(r, c, i, t));
      tiles.appendChild(t);
    });
    pop.appendChild(tiles);
    this.wrap.appendChild(pop);
    this.popup = pop;
    this.positionPopup();
    requestAnimationFrame(() => pop.classList.add('open'));
  };

  Game.prototype.positionPopup = function () {
    if (!this.popup || !this.selected) return;
    const pop = this.popup,
      wrap = this.wrap;
    const cell = this.cells[this.selected.r][this.selected.c];
    const wr = wrap.getBoundingClientRect();
    const cr = cell.getBoundingClientRect();
    const pw = pop.offsetWidth,
      ph = pop.offsetHeight;
    const center = cr.left - wr.left + cr.width / 2;
    let left = Math.max(0, Math.min(wr.width - pw, center - pw / 2));
    const below = cr.bottom - wr.top + 12;
    const above = cr.top - wr.top - ph - 12;
    const fitsBelow = cr.bottom + ph + 12 < window.innerHeight || above < 0;
    pop.classList.toggle('above', !fitsBelow);
    pop.style.left = left + 'px';
    pop.style.top = (fitsBelow ? below : above) + 'px';
    pop.querySelector('.popup-arrow').style.left = center - left + 'px';
  };

  Game.prototype.closePopup = function () {
    if (this.selected)
      this.cells[this.selected.r][this.selected.c].classList.remove('selected');
    this.selected = null;
    if (this.popup) {
      this.popup.remove();
      this.popup = null;
    }
  };

  Game.prototype.choose = function (r, c, item, tile) {
    const m = this.model;
    if (m.isCorrect(this.board, r, c, item)) {
      this.board[r][c] = item;
      this.closePopup();
      this.paintCell(r, c, true);
      this.save();
      this.updateRules(true);
      if (this.isComplete()) setTimeout(() => this.showWin(true), 700);
      return;
    }
    const key = r + ',' + c;
    (this.wrong[key] = this.wrong[key] || []).push(item);
    this.save();
    tile.classList.add('wrong');
    tile.disabled = true;
    setTimeout(() => {
      tile.classList.remove('wrong');
      tile.classList.add('crossed');
    }, 650);
    const cell = this.cells[r][c];
    cell.classList.remove('shake');
    void cell.offsetWidth;
    cell.classList.add('shake');

    const conflicts = m.conflictingRules(this.board, r, c, item);
    conflicts.forEach(i => {
      const card = this.ruleCards[i];
      card.classList.remove('violated');
      void card.offsetWidth;
      card.classList.add('violated');
      setTimeout(() => card.classList.remove('violated'), 1600);
    });
    const name = m.rows[r].items[item].name;
    const nums = conflicts.map(i => i + 1);
    let msg = `❌ ${name} passt hier nicht!`;
    if (nums.length === 1) msg += ` Schau dir Regel ${nums[0]} an.`;
    else if (nums.length > 1)
      msg +=
        ` Schau dir die Regeln ${nums.slice(0, -1).join(', ')}` +
        ` und ${nums[nums.length - 1]} an.`;
    this.showToast(msg);
  };

  Game.prototype.showToast = function (msg) {
    const t = this.toast;
    t.textContent = msg;
    t.classList.remove('show');
    void t.offsetWidth;
    t.classList.add('show');
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => t.classList.remove('show'), 3200);
  };

  Game.prototype.updateRules = function (animate) {
    const flags = this.model.entailed(this.board);
    const cards = this.ruleCards;
    const first = animate ? cards.map(c => c.getBoundingClientRect()) : null;
    const newlyMet = [];
    cards.forEach((card, i) => {
      if (flags[i] && !card.classList.contains('met')) newlyMet.push(card);
      card.classList.toggle('met', flags[i]);
    });
    const order = cards
      .map((_, i) => i)
      .sort((a, b) => flags[a] - flags[b] || a - b);
    order.forEach(i => this.ruleList.appendChild(cards[i]));
    const met = flags.filter(Boolean).length;
    this.counter.innerHTML = `Regeln erfüllt: <b>${met}/${flags.length}</b>`;
    if (!animate) return;
    cards.forEach((card, i) => {
      const last = card.getBoundingClientRect();
      const dx = first[i].left - last.left,
        dy = first[i].top - last.top;
      if (dx || dy) {
        card.animate(
          [{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'none' }],
          { duration: 600, easing: 'cubic-bezier(.2,.8,.2,1)' },
        );
      }
    });
    newlyMet.forEach(card => {
      card.classList.remove('just-met');
      void card.offsetWidth;
      card.classList.add('just-met');
    });
  };

  Game.prototype.showWin = function (celebrate) {
    const ov = el('div', 'win-overlay');
    const box = el(
      'div',
      'win-box',
      `<div class="win-emoji">` +
        `${escapeHtml(this.cfg.winEmoji || '🎃')}</div>` +
        `<h2>${escapeHtml(this.cfg.winTitle || 'Geschafft!')}</h2>` +
        `<p>${escapeHtml(this.cfg.winMessage || 'Super gemacht!')}</p>`,
    );
    const btn = el('button', 'win-close', 'Zum Rätsel');
    btn.type = 'button';
    btn.addEventListener('click', () => ov.remove());
    box.appendChild(btn);
    ov.appendChild(box);
    document.body.appendChild(ov);
    if (celebrate) confetti();
  };

  function confetti() {
    const symbols = ['🎃', '👻', '🦇', '🍬', '🕷️', '⭐', '🍭'];
    for (let i = 0; i < 40; i++) {
      const s = el('span', 'confetti', symbols[i % symbols.length]);
      s.style.left = Math.random() * 100 + 'vw';
      s.style.animationDuration = 2.2 + Math.random() * 2 + 's';
      s.style.animationDelay = Math.random() * 0.8 + 's';
      s.style.fontSize = 20 + Math.random() * 22 + 'px';
      document.body.appendChild(s);
      setTimeout(() => s.remove(), 5500);
    }
  }

  function start(cfg) {
    const run = () => {
      const root = document.getElementById(cfg.mount || 'game');
      try {
        new Game(cfg, root).init();
      } catch (e) {
        root.innerHTML = '';
        root.appendChild(
          el(
            'div',
            'config-warning',
            '<b>Fehler in der Konfiguration:</b><br>' + escapeHtml(e.message),
          ),
        );
        throw e;
      }
    };
    if (document.readyState === 'loading')
      document.addEventListener('DOMContentLoaded', run);
    else run();
  }

  const api = { start, rules: R, Model };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else global.LogicGame = api;
})(typeof window !== 'undefined' ? window : globalThis);
