// Picture puzzles without any text: for kids who don't read.
// Most levels are "bring a picture to where it belongs" — by dragging or by
// tapping the picture and then its place. A pointing hand shows the first
// move, a chime says "yes", a soft wiggle says "try again".
//
// Level types (see vasyl.html):
//   connect  pairs: [[left, right], ...]   draw a line left → right
//   pairs    pairs: [[shown, piece], ...]  put the piece in the box next to it
//   halves   items: [emoji, ...]           put the right half to the left half
//   holes    items: [piece, ...]           put each piece in its hole
//            sizes: true → holes ordered from small to big
//   pattern  rows: [[...seq, answer]], extra: [distractors]
//   jigsaw   items: [emoji, ...]           four quarters make the picture
//   sort     groups: [{ color, items }]    put everything in its basket
//   copy     model: [top … bottom], extra  build the same tower
//   odd      rows: [[same, same, same, odd]]  tap the one that doesn't belong
//            (the odd one is written last; rows are shuffled)
//   memory   items: [emoji, ...]           turn over two cards that match
//   maze     map: ['S.#', ...], start, goal  walk from S to G; # is a wall
// help: a short note for the adult, shown small under the board.
// code: optional, shown big on the very last screen (a key for the next puzzle).
//
// A picture is an emoji ('🎃'), a shape ('shape:star:#f08a24'), or an
// object { e, sil, half, quarter, size, n } (n: that many small copies).
window.PictureGame = (function () {
  const SHAPES = {
    circle: '<circle cx="50" cy="50" r="42"/>',
    square: '<rect x="11" y="11" width="78" height="78" rx="8"/>',
    triangle: '<path d="M50 7 L94 88 L6 88 Z"/>',
    star: '<path d="M50 5 L61 37 L95 37 L68 58 L78 92 L50 72 L22 92 L32 58 L5 37 L39 37 Z"/>',
    heart:
      '<path d="M50 90 C20 68 5 52 5 32 C5 17 17 7 30 7 C40 7 46 13 50 21 ' +
      'C54 13 60 7 70 7 C83 7 95 17 95 32 C95 52 80 68 50 90 Z"/>',
    moon: '<path d="M64 6 A44 44 0 1 0 94 70 A36 36 0 1 1 64 6 Z"/>',
  };

  const el = (tag, cls, html) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html != null) e.innerHTML = html;
    return e;
  };

  function shuffle(list) {
    const a = list.slice();
    // No picture may stay in its place: a twin straight across is no puzzle.
    for (let tries = 0; tries < 100; tries++) {
      for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
      }
      if (a.length < 2 || a.every((x, i) => x !== list[i])) break;
    }
    return a;
  }

  function picture(spec, hole) {
    if (typeof spec === 'string' && spec.startsWith('shape:')) {
      const [, name, color] = spec.split(':');
      return el(
        'span',
        'pic shape' + (hole ? ' hole' : ''),
        `<svg viewBox="0 0 100 100" fill="${hole ? '#3b2d4a' : color}">` +
          SHAPES[name] +
          '</svg>',
      );
    }
    const s = typeof spec === 'string' ? { e: spec } : spec;
    const p = el('span', 'pic');
    if (s.n) {
      p.classList.add('many');
      for (let i = 0; i < s.n; i++) p.appendChild(el('span', 'glyph', s.e));
      return p;
    }
    const glyph = el('span', 'glyph', s.e);
    if (s.sil) glyph.classList.add('sil');
    if (s.half) p.classList.add('half-' + s.half);
    if (s.quarter) p.classList.add('q-' + s.quarter);
    if (s.size) p.style.setProperty('--k', s.size);
    if (hole) p.classList.add('hole');
    p.appendChild(glyph);
    return p;
  }

  // ---------- sound ----------
  let audio;
  function tones(notes, type = 'sine', vol = 0.18) {
    audio = audio || new (window.AudioContext || window.webkitAudioContext)();
    let t = audio.currentTime + 0.02;
    notes.forEach(([freq, len]) => {
      const o = audio.createOscillator();
      const g = audio.createGain();
      o.type = type;
      o.frequency.value = freq;
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(vol, t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.001, t + len);
      o.connect(g).connect(audio.destination);
      o.start(t);
      o.stop(t + len);
      t += len * 0.6;
    });
  }
  const sound = {
    yes: () =>
      tones([
        [660, 0.18],
        [990, 0.3],
      ]),
    no: () => tones([[220, 0.25]], 'triangle', 0.08),
    step: () => tones([[520 + Math.random() * 120, 0.08]], 'sine', 0.06),
    level: () =>
      tones(
        [
          [523, 0.2],
          [659, 0.2],
          [784, 0.2],
          [1047, 0.5],
        ],
        'triangle',
      ),
  };

  // ---------- game ----------
  function start(cfg) {
    const root = document.getElementById('game');
    const store = 'pictures-level-' + cfg.id;
    let level = Math.min(+localStorage.getItem(store) || 0, cfg.levels.length);
    if (level >= cfg.levels.length) level = 0;

    const top = el('div', 'pg-top');
    const dots = el('div', 'pg-progress');
    top.append(dots);
    const board = el('div', 'pg-board');
    const help = el('p', 'pg-help');
    root.append(top, board, help);

    cfg.levels.forEach((_, i) => {
      const d = el('button', 'pg-dot', cfg.levels[i].icon || '🎃');
      d.onclick = () => go(i);
      dots.appendChild(d);
    });

    let current; // { pieces, targets, mode, svg, lines, cleanup }
    let selected = null;
    let hintTimer, idleTimer;

    function go(i) {
      level = i;
      localStorage.setItem(store, String(i));
      [...dots.children].forEach((d, j) => {
        d.classList.toggle('done', j < i);
        d.classList.toggle('now', j === i);
      });
      // Clear the last level's celebration: falling candy would look like
      // part of the new level.
      document
        .querySelectorAll('.pg-overlay, .confetti')
        .forEach(o => o.remove());
      build(cfg.levels[i]);
    }

    // ----- building the levels -----
    function piece(spec, key) {
      const p = el('div', 'pg-piece');
      p.appendChild(picture(spec));
      p.dataset.key = key;
      return p;
    }
    function target(spec, key, hole) {
      const t = el('div', 'pg-target');
      if (spec != null) t.appendChild(picture(spec, hole));
      t.dataset.key = key;
      return t;
    }

    function build(lv) {
      clearTimeout(hintTimer);
      clearTimeout(idleTimer);
      if (current && current.cleanup) current.cleanup();
      board.innerHTML = '';
      board.className = 'pg-board lv-' + lv.type;
      help.textContent = lv.help || '';
      selected = null;
      const pieces = [];
      const targets = [];
      let mode = 'place';
      let svg = null;
      let tapHint = null; // hint of the levels without pieces to drag
      const pool = el('div', 'pg-pool');

      if (lv.type === 'connect') {
        mode = 'line';
        const left = el('div', 'pg-col');
        const right = el('div', 'pg-col');
        lv.pairs.forEach(([a], i) => {
          const p = piece(a, i);
          left.appendChild(p);
          pieces.push(p);
        });
        shuffle(lv.pairs.map((_, i) => i)).forEach(i => {
          const t = target(lv.pairs[i][1], i);
          t.classList.add('pg-card');
          right.appendChild(t);
          targets.push(t);
        });
        svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.classList.add('pg-lines');
        board.append(svg, left, right);
      } else if (lv.type === 'pairs' || lv.type === 'halves') {
        const grid = el('div', 'pg-pairs');
        const pairs =
          lv.type === 'halves'
            ? lv.items.map(e => [
                { e, half: 'left' },
                { e, half: 'right' },
              ])
            : lv.pairs;
        pairs.forEach(([shown], i) => {
          const row = el('div', 'pg-pair');
          const fixed = el('div', 'pg-fixed');
          fixed.appendChild(picture(shown));
          const t = target(null, i);
          row.append(fixed, t);
          grid.appendChild(row);
          targets.push(t);
        });
        shuffle(pairs.map((_, i) => i)).forEach(i => {
          const p = piece(pairs[i][1], i);
          pool.appendChild(p);
          pieces.push(p);
        });
        board.append(grid, pool);
      } else if (lv.type === 'holes') {
        const box = el('div', 'pg-holes');
        const specs = lv.items.map((s, i) =>
          lv.sizes
            ? { e: s, size: 0.45 + (0.55 * i) / (lv.items.length - 1) }
            : s,
        );
        (lv.sizes ? specs.map((_, i) => i) : shuffle(specs.map((_, i) => i)))
          .map(i => target(specs[i], i, true))
          .forEach(t => {
            box.appendChild(t);
            targets.push(t);
          });
        shuffle(specs.map((_, i) => i)).forEach(i => {
          const p = piece(specs[i], i);
          pool.appendChild(p);
          pieces.push(p);
        });
        board.append(box, pool);
      } else if (lv.type === 'pattern') {
        const rows = el('div', 'pg-patterns');
        lv.rows.forEach(seq => {
          const row = el('div', 'pg-seq');
          seq.slice(0, -1).forEach(s => {
            const f = el('div', 'pg-fixed');
            f.appendChild(picture(s));
            row.appendChild(f);
          });
          const t = target(null, seq[seq.length - 1]);
          row.appendChild(t);
          rows.appendChild(row);
          targets.push(t);
        });
        const all = lv.rows.map(r => r[r.length - 1]).concat(lv.extra || []);
        shuffle(all).forEach(s => {
          const p = piece(s, s);
          pool.appendChild(p);
          pieces.push(p);
        });
        board.append(rows, pool);
      } else if (lv.type === 'jigsaw') {
        const frames = el('div', 'pg-jigsaws');
        const all = [];
        lv.items.forEach((e, i) => {
          const frame = el('div', 'pg-jig');
          ['tl', 'tr', 'bl', 'br'].forEach(q => {
            const t = target({ e, quarter: q }, i + q, true);
            frame.appendChild(t);
            targets.push(t);
            all.push([{ e, quarter: q }, i + q]);
          });
          frames.appendChild(frame);
        });
        shuffle(all).forEach(([spec, key]) => {
          const p = piece(spec, key);
          pool.appendChild(p);
          pieces.push(p);
        });
        board.append(frames, pool);
      } else if (lv.type === 'sort') {
        const baskets = el('div', 'pg-baskets');
        const all = [];
        lv.groups.forEach((g, i) => {
          const t = el('div', 'pg-target pg-basket');
          t.dataset.key = i;
          t.dataset.cap = g.items.length;
          t.style.setProperty('--c', g.color);
          t.append(
            picture('shape:circle:' + g.color),
            el('div', 'pg-basket-items'),
          );
          baskets.appendChild(t);
          targets.push(t);
          g.items.forEach(e => all.push([e, i]));
        });
        shuffle(all).forEach(([e, key]) => {
          const p = piece(e, key);
          pool.appendChild(p);
          pieces.push(p);
        });
        board.append(baskets, pool);
      } else if (lv.type === 'copy') {
        const both = el('div', 'pg-copy');
        const model = el('div', 'pg-tower model');
        const tower = el('div', 'pg-tower');
        lv.model.forEach(e => {
          const f = el('div', 'pg-fixed');
          f.appendChild(picture(e));
          model.appendChild(f);
          const t = target(null, e);
          tower.appendChild(t);
          targets.push(t);
        });
        model.appendChild(el('div', 'pg-base'));
        tower.appendChild(el('div', 'pg-base'));
        both.append(model, tower);
        shuffle(lv.model.concat(lv.extra || [])).forEach(e => {
          const p = piece(e, e);
          pool.appendChild(p);
          pieces.push(p);
        });
        board.append(both, pool);
      } else if (lv.type === 'odd') {
        tapHint = buildOdd(lv);
      } else if (lv.type === 'memory') {
        tapHint = buildMemory(lv);
      } else if (lv.type === 'maze') {
        tapHint = buildMaze(lv);
      }

      current = { pieces, targets, mode, svg, lines: [], hint: tapHint };
      pieces.forEach(p => wire(p));
      targets.forEach(t =>
        t.addEventListener('click', () => {
          if (selected) attempt(selected, t);
        }),
      );
      if (svg) {
        const redraw = () => drawLines();
        window.addEventListener('resize', redraw);
        current.cleanup = () => window.removeEventListener('resize', redraw);
      }
      board.animate(
        [
          { opacity: 0, transform: 'scale(0.96)' },
          { opacity: 1, transform: 'none' },
        ],
        { duration: 350, easing: 'ease-out' },
      );
      hintTimer = setTimeout(hint, 900);
    }

    // ----- levels without pieces to drag -----
    function shake(...nodes) {
      nodes.forEach(x => {
        x.classList.remove('wiggle');
        void x.offsetWidth;
        x.classList.add('wiggle');
      });
    }

    // Odd one out: tap the picture that doesn't belong in its row.
    function buildOdd(lv) {
      const rows = el('div', 'pg-odd');
      const answers = [];
      let left = lv.rows.length;
      lv.rows.forEach(items => {
        const row = el('div', 'pg-odd-row');
        const odd = items.length - 1;
        shuffle(items.map((_, i) => i)).forEach(i => {
          const b = el('button', 'pg-fixed pg-tap');
          b.appendChild(picture(items[i]));
          if (i === odd) answers.push(b);
          b.onclick = () => {
            poke();
            if (row.classList.contains('done')) return;
            if (i !== odd) {
              sound.no();
              shake(b);
              return;
            }
            sound.yes();
            row.classList.add('done');
            b.classList.add('right');
            burst(b);
            if (!--left) setTimeout(won, 700);
          };
          row.appendChild(b);
        });
        rows.appendChild(row);
      });
      board.appendChild(rows);
      return () => {
        const b = answers.find(x => !x.closest('.done'));
        if (b) showHand([b]);
      };
    }

    // Memory: turn over two cards; a matching pair stays open.
    function buildMemory(lv) {
      const grid = el('div', 'pg-memory');
      let open = [];
      let left = lv.items.length;
      shuffle(lv.items.concat(lv.items)).forEach(e => {
        const c = el('button', 'pg-mem');
        c.dataset.key = e;
        const front = el('span', 'pg-mem-front');
        front.appendChild(picture(e));
        c.append(front, el('span', 'pg-mem-back', '🕸️'));
        c.onclick = () => {
          poke();
          if (open.length === 2 || c.classList.contains('open')) return;
          c.classList.add('open');
          open.push(c);
          if (open.length < 2) return;
          const [a, b] = open;
          if (a.dataset.key === b.dataset.key) {
            setTimeout(() => {
              open = [];
              a.classList.add('matched');
              b.classList.add('matched');
              sound.yes();
              burst(a);
              burst(b);
              if (!--left) setTimeout(won, 700);
            }, 350);
          } else {
            setTimeout(() => {
              a.classList.remove('open');
              b.classList.remove('open');
              open = [];
            }, 1100);
          }
        };
        grid.appendChild(c);
      });
      board.appendChild(grid);
      return () => {
        const c = grid.querySelector('.pg-mem:not(.open)');
        if (c) showHand([c]);
      };
    }

    // Maze: walk to the goal cell by cell, by tapping or dragging along.
    function buildMaze(lv) {
      const grid = el('div', 'pg-maze');
      const h = lv.map.length;
      const w = lv.map[0].length;
      grid.style.setProperty('--w', w);
      const cells = [];
      let pos;
      let goal;
      lv.map.forEach((line, r) =>
        [...line].forEach((ch, c) => {
          const cell = el('div', 'pg-cell' + (ch === '#' ? ' wall' : ''));
          cell.dataset.r = r;
          cell.dataset.c = c;
          if (ch === 'S') pos = [r, c];
          if (ch === 'G') {
            goal = [r, c];
            cell.appendChild(el('span', 'pg-goal', lv.goal));
          }
          cells.push(cell);
          grid.appendChild(cell);
        }),
      );
      const at = ([r, c]) => cells[r * w + c];
      const walker = el('span', 'pg-walker', lv.start);
      at(pos).append(walker);
      at(pos).classList.add('trail');
      let done = false;

      const stepTo = cell => {
        if (done || !cell || cell.classList.contains('wall')) return;
        const to = [+cell.dataset.r, +cell.dataset.c];
        if (Math.abs(to[0] - pos[0]) + Math.abs(to[1] - pos[1]) !== 1) return;
        pos = to;
        cell.appendChild(walker);
        cell.classList.add('trail');
        sound.step();
        if (pos[0] === goal[0] && pos[1] === goal[1]) {
          done = true;
          cell.classList.add('reached');
          sound.yes();
          burst(cell);
          setTimeout(won, 900);
        }
      };
      const cellAt = (x, y) => {
        const hit = document.elementFromPoint(x, y);
        return hit && hit.closest('.pg-cell');
      };
      grid.addEventListener('pointerdown', e => {
        e.preventDefault();
        poke();
        grid.setPointerCapture(e.pointerId);
        stepTo(cellAt(e.clientX, e.clientY));
      });
      grid.addEventListener('pointermove', e => {
        if (e.buttons) stepTo(cellAt(e.clientX, e.clientY));
      });
      board.appendChild(grid);

      // Shortest way from where the walker is to the goal, for the hint.
      const open = ([r, c]) =>
        r >= 0 && c >= 0 && r < h && c < w && lv.map[r][c] !== '#';
      const way = () => {
        const prev = new Map([[pos.join(), null]]);
        const queue = [pos];
        while (queue.length) {
          const p = queue.shift();
          [
            [1, 0],
            [-1, 0],
            [0, 1],
            [0, -1],
          ].forEach(([dr, dc]) => {
            const n = [p[0] + dr, p[1] + dc];
            if (open(n) && !prev.has(n.join())) {
              prev.set(n.join(), p);
              queue.push(n);
            }
          });
        }
        const path = [];
        for (let p = goal; p; p = prev.get(p.join())) path.unshift(p);
        return path;
      };
      return () => {
        if (!done) showHand(way().slice(0, 4).map(at));
      };
    }

    // ----- dragging and tapping -----
    function wire(p) {
      p.addEventListener('pointerdown', e => {
        if (p.classList.contains('used')) return;
        e.preventDefault();
        poke();
        const r = p.getBoundingClientRect();
        const sx = e.clientX;
        const sy = e.clientY;
        let ghost = null;
        let live = null;
        p.setPointerCapture(e.pointerId);

        const move = ev => {
          const dx = ev.clientX - sx;
          const dy = ev.clientY - sy;
          if (!ghost && !live && Math.hypot(dx, dy) < 8) return;
          select(p);
          if (current.mode === 'line') {
            live = live || addLine(p, null);
            live.setPoint(ev.clientX, ev.clientY);
          } else {
            if (!ghost) {
              ghost = p.cloneNode(true);
              ghost.classList.add('pg-ghost');
              ghost.style.width = r.width + 'px';
              ghost.style.height = r.height + 'px';
              // The ghost lives outside the board: take the card size along.
              ghost.style.setProperty(
                '--s',
                getComputedStyle(p).getPropertyValue('--s'),
              );
              document.body.appendChild(ghost);
              p.classList.add('lifted');
            }
            ghost.style.left = r.left + dx + 'px';
            ghost.style.top = r.top + dy + 'px';
          }
          hover(ev.clientX, ev.clientY);
        };
        const up = ev => {
          p.removeEventListener('pointermove', move);
          p.removeEventListener('pointerup', up);
          p.removeEventListener('pointercancel', up);
          hover();
          if (live) live.remove();
          if (ghost) ghost.remove();
          p.classList.remove('lifted');
          if (!ghost && !live) {
            // A tap: select it (or unselect).
            select(selected === p ? null : p);
            return;
          }
          const t = targetAt(ev.clientX, ev.clientY);
          if (t) attempt(p, t);
          else select(null);
        };
        p.addEventListener('pointermove', move);
        p.addEventListener('pointerup', up);
        p.addEventListener('pointercancel', up);
      });
    }

    function targetAt(x, y) {
      const hit = document.elementFromPoint(x, y);
      const t = hit && hit.closest('.pg-target');
      return t && current.targets.includes(t) && !t.classList.contains('filled')
        ? t
        : null;
    }
    function hover(x, y) {
      current.targets.forEach(t => t.classList.remove('hover'));
      const t = x != null && targetAt(x, y);
      if (t) t.classList.add('hover');
    }
    function select(p) {
      if (selected) selected.classList.remove('selected');
      selected = p;
      if (p) p.classList.add('selected');
    }

    function attempt(p, t) {
      poke();
      select(null);
      if (t.classList.contains('filled')) return;
      if (p.dataset.key !== t.dataset.key) {
        sound.no();
        [p, t].forEach(x => {
          x.classList.remove('wiggle');
          void x.offsetWidth;
          x.classList.add('wiggle');
        });
        return;
      }
      sound.yes();
      t.classList.add('filled');
      p.classList.add('used');
      if (current.mode === 'line') {
        current.lines.push(addLine(p, t));
        t.classList.add('matched');
      } else if (t.dataset.cap) {
        // A basket takes several pictures; it's full when all are in.
        const items = t.querySelector('.pg-basket-items');
        items.appendChild(p.firstChild);
        p.remove();
        if (items.children.length < +t.dataset.cap)
          t.classList.remove('filled');
      } else {
        t.replaceChildren(p.firstChild);
        p.remove();
      }
      burst(t);
      if (current.targets.every(x => x.classList.contains('filled')))
        setTimeout(won, 700);
    }

    // ----- lines (connect levels) -----
    function center(node) {
      const b = board.getBoundingClientRect();
      const r = node.getBoundingClientRect();
      return {
        left: r.left - b.left,
        right: r.right - b.left,
        y: r.top - b.top + r.height / 2,
      };
    }
    function addLine(p, t) {
      const ns = 'http://www.w3.org/2000/svg';
      const line = document.createElementNS(ns, 'line');
      line.setAttribute('class', t ? 'done' : 'live');
      current.svg.appendChild(line);
      const api = {
        from: p,
        to: t,
        draw() {
          const a = center(p);
          line.setAttribute('x1', a.right);
          line.setAttribute('y1', a.y);
          if (api.to) {
            const b = center(api.to);
            line.setAttribute('x2', b.left);
            line.setAttribute('y2', b.y);
          }
        },
        setPoint(x, y) {
          const b = board.getBoundingClientRect();
          api.draw();
          line.setAttribute('x2', x - b.left);
          line.setAttribute('y2', y - b.top);
        },
        remove: () => line.remove(),
      };
      api.draw();
      return api;
    }
    function drawLines() {
      current.lines.forEach(l => l.draw());
    }

    // ----- hint: a hand shows one correct move -----
    function poke() {
      clearTimeout(idleTimer);
      clearTimeout(hintTimer);
      document.querySelectorAll('.pg-hand').forEach(h => h.remove());
      idleTimer = setTimeout(hint, 15000);
    }
    function hint() {
      idleTimer = setTimeout(hint, 15000);
      if (current.hint) return current.hint();
      const free = x => !x.classList.contains('used');
      const t = current.targets.find(
        x =>
          !x.classList.contains('filled') &&
          current.pieces.some(p => free(p) && p.dataset.key === x.dataset.key),
      );
      if (!t) return;
      const p = current.pieces.find(
        x => free(x) && x.dataset.key === t.dataset.key,
      );
      showHand([p, t]);
    }
    // The hand presses the first node and moves on through the others;
    // with a single node it just taps it twice.
    function showHand(nodes) {
      const rs = nodes.map(n => n.getBoundingClientRect());
      const hand = el('div', 'pg-hand', '👆');
      document.body.appendChild(hand);
      const at = (r, s, offset) => ({
        transform: `translate(${r.left + r.width / 2}px, ${r.top + r.height / 2}px) scale(${s})`,
        opacity: 1,
        offset,
      });
      const a = rs[0];
      const z = rs[rs.length - 1];
      const frames =
        rs.length === 1
          ? [
              at(a, 1, 0.2),
              at(a, 0.8, 0.35),
              at(a, 1, 0.5),
              at(a, 0.8, 0.65),
              at(a, 1, 0.8),
            ]
          : [
              at(a, 1, 0.15),
              at(a, 0.85, 0.25),
              ...rs
                .slice(1)
                .map((r, i) =>
                  at(r, 0.85, 0.25 + (0.5 * (i + 1)) / (rs.length - 1)),
                ),
              at(z, 1, 0.85),
            ];
      frames.unshift({ ...at(a, 1, 0), opacity: 0 });
      frames.push({ ...at(z, 1, 1), opacity: 0 });
      const anim = hand.animate(frames, {
        duration: 2400,
        iterations: 2,
        easing: 'ease-in-out',
      });
      anim.onfinish = () => hand.remove();
    }

    // ----- rewards -----
    function burst(node) {
      const r = node.getBoundingClientRect();
      for (let i = 0; i < 8; i++) {
        const s = el('span', 'pg-spark', '✨');
        document.body.appendChild(s);
        const ang = (i / 8) * Math.PI * 2;
        const x = r.left + r.width / 2;
        const y = r.top + r.height / 2;
        s.animate(
          [
            { transform: `translate(${x}px, ${y}px) scale(0.4)`, opacity: 1 },
            {
              transform: `translate(${x + Math.cos(ang) * 70}px, ${y + Math.sin(ang) * 70}px) scale(1)`,
              opacity: 0,
            },
          ],
          { duration: 650, easing: 'ease-out' },
        ).onfinish = () => s.remove();
      }
    }
    function confetti(symbols) {
      for (let i = 0; i < 36; i++) {
        const s = el('span', 'confetti', symbols[i % symbols.length]);
        s.style.left = Math.random() * 100 + 'vw';
        s.style.fontSize = 22 + Math.random() * 22 + 'px';
        s.style.animationDuration = 2.2 + Math.random() * 2 + 's';
        s.style.animationDelay = Math.random() * 0.8 + 's';
        document.body.appendChild(s);
        setTimeout(() => s.remove(), 5200);
      }
    }
    // The end of the game: fireworks behind the trophy box for as long as
    // it is open. Silent on purpose – no bangs.
    function fireworks(o) {
      const cv = el('canvas', 'pg-fireworks');
      o.prepend(cv);
      const ctx = cv.getContext('2d');
      const colors = [
        '#ff8a1f',
        '#ffc832',
        '#7ee081',
        '#b48cff',
        '#ff6fb5',
        '#6fd3ff',
      ];
      const rockets = [];
      const sparks = [];
      let w;
      let h;
      let unit;
      let wait = 0;
      const gravity = () => 0.06 * unit;
      // Burst next to the trophy box, not behind it (on phones the box
      // covers the middle of the screen).
      const launch = () => {
        const box = o.querySelector('.win-box').getBoundingClientRect();
        const x = w * (0.1 + Math.random() * 0.8);
        let y = h * (0.1 + Math.random() * 0.6);
        if (x > box.left - 30 && x < box.right + 30) {
          const above = box.top - 40;
          const below = h - box.bottom - 120;
          y =
            above > below
              ? 30 + Math.random() * Math.max(above - 30, 0)
              : box.bottom + 40 + Math.random() * Math.max(below - 40, 0);
        }
        rockets.push({
          x,
          y: h,
          vx: (Math.random() - 0.5) * unit,
          vy: -Math.sqrt(2 * gravity() * (h - y)),
          color: colors[(Math.random() * colors.length) | 0],
        });
      };
      const explode = r => {
        const n = 50 + ((Math.random() * 30) | 0);
        for (let i = 0; i < n; i++) {
          const ang = (i / n) * Math.PI * 2;
          const speed = (1 + Math.random() * 3) * unit;
          const life = 55 + Math.random() * 35;
          sparks.push({
            x: r.x,
            y: r.y,
            vx: Math.cos(ang) * speed,
            vy: Math.sin(ang) * speed,
            life,
            max: life,
            color: Math.random() < 0.2 ? '#fff' : r.color,
          });
        }
      };
      const frame = () => {
        if (!cv.isConnected) return;
        if (cv.width !== innerWidth || cv.height !== innerHeight) {
          w = cv.width = innerWidth;
          h = cv.height = innerHeight;
          unit = Math.max(h / 700, 0.6);
        }
        if (--wait <= 0) {
          launch();
          wait = 18 + Math.random() * 30;
        }
        // Fade the previous frame a little: the sparks leave trails.
        ctx.globalCompositeOperation = 'destination-out';
        ctx.fillStyle = 'rgba(0, 0, 0, 0.22)';
        ctx.fillRect(0, 0, w, h);
        ctx.globalCompositeOperation = 'lighter';
        for (let i = rockets.length - 1; i >= 0; i--) {
          const r = rockets[i];
          r.x += r.vx;
          r.y += r.vy;
          r.vy += gravity();
          ctx.fillStyle = r.color;
          ctx.beginPath();
          ctx.arc(r.x, r.y, 3 * unit, 0, Math.PI * 2);
          ctx.fill();
          if (r.vy >= 0) {
            rockets.splice(i, 1);
            explode(r);
          }
        }
        for (let i = sparks.length - 1; i >= 0; i--) {
          const s = sparks[i];
          s.x += s.vx;
          s.y += s.vy;
          s.vx *= 0.97;
          s.vy = s.vy * 0.97 + 0.04 * unit;
          if (--s.life <= 0) {
            sparks.splice(i, 1);
            continue;
          }
          ctx.globalAlpha = s.life / s.max;
          ctx.fillStyle = s.color;
          ctx.beginPath();
          ctx.arc(s.x, s.y, 2.5 * unit, 0, Math.PI * 2);
          ctx.fill();
          ctx.globalAlpha = 1;
        }
        requestAnimationFrame(frame);
      };
      frame();
      // Three at once to start with.
      launch();
      launch();
    }
    function won() {
      clearTimeout(idleTimer);
      sound.level();
      const last = level === cfg.levels.length - 1;
      dots.children[level].classList.add('done');
      confetti(last ? ['🎃', '🍬', '⭐', '👻', '🍭'] : ['⭐', '✨', '🍬']);
      const o = el('div', 'win-overlay pg-overlay');
      const box = el('div', 'win-box pg-win');
      box.appendChild(el('div', 'win-emoji', cfg.levels[level].reward || '⭐'));
      if (last) {
        const row = el('div', 'pg-trophies');
        cfg.levels.forEach((lv, i) => {
          const s = el('span', '', lv.icon || '🎃');
          s.style.animationDelay = i * 0.12 + 's';
          row.appendChild(s);
        });
        box.appendChild(row);
        // A code for the next puzzle (e.g. a lock), shown big.
        if (cfg.code) box.appendChild(el('div', 'pg-code', '🔑 ' + cfg.code));
      }
      // Next: a big arrow. After the last level: start again.
      const next = last
        ? el('button', 'pg-again', '🔁')
        : el(
            'button',
            'pg-next',
            '<svg viewBox="0 0 160 100"><path d="M8 25 H95 V5 L155 50 ' +
              'L95 95 V75 H8 Z"/></svg>',
          );
      next.onclick = () => go(last ? 0 : level + 1);
      box.appendChild(next);
      o.appendChild(box);
      document.body.appendChild(o);
      if (last) {
        o.classList.add('pg-final');
        fireworks(o);
      }
    }

    go(level);
  }

  return { start };
})();
