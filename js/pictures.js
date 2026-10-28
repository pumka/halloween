// Picture puzzles without any text: for kids who don't read.
// Every level is "bring a picture to where it belongs" — by dragging or by
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
// help: a short note for the adult, shown small under the board.
//
// A picture is an emoji ('🎃'), a shape ('shape:star:#f08a24'), or an
// object { e, sil, half, size }.
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
    const glyph = el('span', 'glyph', s.e);
    if (s.sil) glyph.classList.add('sil');
    if (s.half) p.classList.add('half-' + s.half);
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
      document.querySelectorAll('.pg-overlay').forEach(o => o.remove());
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
      }

      current = { pieces, targets, mode, svg, lines: [] };
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
      const p = current.pieces.find(x => !x.classList.contains('used'));
      if (!p) return;
      const t = current.targets.find(
        x => !x.classList.contains('filled') && x.dataset.key === p.dataset.key,
      );
      if (!t) return;
      const a = p.getBoundingClientRect();
      const b = t.getBoundingClientRect();
      const hand = el('div', 'pg-hand', '👆');
      document.body.appendChild(hand);
      const at = (r, s) => ({
        transform: `translate(${r.left + r.width / 2}px, ${r.top + r.height / 2}px) scale(${s})`,
        opacity: 1,
      });
      const anim = hand.animate(
        [
          { ...at(a, 1), opacity: 0 },
          { ...at(a, 1), offset: 0.15 },
          { ...at(a, 0.85), offset: 0.25 },
          { ...at(b, 0.85), offset: 0.75 },
          { ...at(b, 1), offset: 0.85 },
          { ...at(b, 1), opacity: 0 },
        ],
        { duration: 2400, iterations: 2, easing: 'ease-in-out' },
      );
      anim.onfinish = () => hand.remove();
      idleTimer = setTimeout(hint, 15000);
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
      }
      const next = el('button', 'pg-next', last ? '🔁' : '▶');
      next.onclick = () => go(last ? 0 : level + 1);
      box.appendChild(next);
      o.appendChild(box);
      document.body.appendChild(o);
    }

    go(level);
  }

  return { start };
})();
