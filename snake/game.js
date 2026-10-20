/**
 * 2P Snake — game.js
 *
 * Architecture
 *   Snake class      — per-player state + rendering
 *   spawnFood()      — safe food placement
 *   gameTick()       — discrete game logic (fixed timestep)
 *   render(t)        — smooth interpolated draw via requestAnimationFrame
 *   Game loop        — delta-time accumulator (rAF + fixed step)
 *   Input            — keydown queue per player
 *
 * Smooth animation: each segment stores prevPos + currPos.
 * Render interpolates between them based on tick progress (t ∈ [0,1]).
 * This gives silky movement without any setTimeout jank.
 */

'use strict';

/* ─────────────────────────────────────────
   CONFIG
───────────────────────────────────────── */
const COLS     = 25;
const ROWS     = 20;
const CELL     = 20;      // px per grid cell
const TICK     = 130;     // ms between game ticks
const FOOD_PTS = 10;

/* ─────────────────────────────────────────
   CANVAS SETUP
───────────────────────────────────────── */
const canvas = document.getElementById('game');
canvas.width  = COLS * CELL;   // 500
canvas.height = ROWS * CELL;   // 400
const ctx = canvas.getContext('2d');

/* ─────────────────────────────────────────
   PALETTE  (muted, pixel-style)
───────────────────────────────────────── */
const PAL = {
  bg       : '#0c0c0c',
  gridA    : '#101010',   // checkerboard dark
  gridB    : '#0c0c0c',   // checkerboard base
  border   : '#1e1e1e',
  // Player 1 — green
  p1Head   : '#6bc46b',
  p1Body   : '#3d8a3d',
  p1DeadH  : '#3a3a3a',
  p1DeadB  : '#222222',
  // Player 2 — blue
  p2Head   : '#6b9de8',
  p2Body   : '#3d5dbf',
  p2DeadH  : '#3a3a3a',
  p2DeadB  : '#222222',
  // Food
  food     : '#c84444',
  foodShine: 'rgba(255,255,255,0.28)',
};

/* ─────────────────────────────────────────
   HELPERS
───────────────────────────────────────── */
function lerp(a, b, t) { return a + (b - a) * t; }

/**
 * Pick a random free cell not occupied by any snake.
 * Returns null if board is full.
 */
function spawnFood(snakes) {
  const occ = new Set();
  snakes.forEach(s => s.segs.forEach(p => occ.add(`${p.x},${p.y}`)));
  const free = [];
  for (let y = 0; y < ROWS; y++)
    for (let x = 0; x < COLS; x++)
      if (!occ.has(`${x},${y}`)) free.push({ x, y });
  if (!free.length) return null;
  return free[Math.floor(Math.random() * free.length)];
}

/* ─────────────────────────────────────────
   SNAKE CLASS
───────────────────────────────────────── */
class Snake {
  /**
   * @param {number} sx       start X
   * @param {number} sy       start Y
   * @param {number} dx       start direction X (±1 or 0)
   * @param {number} dy       start direction Y (±1 or 0)
   * @param {object} colors   { head, body, deadHead, deadBody }
   */
  constructor(sx, sy, dx, dy, colors) {
    this.sx = sx; this.sy = sy;
    this.sdx = dx; this.sdy = dy;
    this.colors = colors;
    this.reset();
  }

  reset() {
    // Initial 3-segment snake behind head in opposite direction
    this.segs = [
      { x: this.sx,            y: this.sy            },
      { x: this.sx - this.sdx, y: this.sy - this.sdy },
      { x: this.sx - this.sdx * 2, y: this.sy - this.sdy * 2 },
    ];
    // prevSegs for smooth interpolation
    this.prev = this.segs.map(s => ({ ...s }));
    this.dir     = { x: this.sdx, y: this.sdy };
    this.score   = 0;
    this.alive   = true;
    // Direction queue — allows buffering one turn per tick
    this.queue   = [];
  }

  get head() { return this.segs[0]; }

  /** Buffer an intended direction change */
  queueDir(dx, dy) {
    if (this.queue.length < 2) this.queue.push({ x: dx, y: dy });
  }

  /**
   * Advance one game tick:
   * 1. Consume first valid direction from queue
   * 2. Save current positions as prev (for interpolation)
   * 3. Prepend new head (tail NOT removed here — caller handles it)
   */
  tick() {
    // Apply first queued dir that isn't a 180° reversal
    while (this.queue.length) {
      const d = this.queue.shift();
      if (this.dir.x + d.x !== 0 || this.dir.y + d.y !== 0) {
        this.dir = d;
        break;
      }
    }
    this.prev = this.segs.map(s => ({ ...s }));
    const h = this.head;
    this.segs.unshift({ x: h.x + this.dir.x, y: h.y + this.dir.y });
    // Caller: call popTail() if no food was eaten
  }

  popTail() { this.segs.pop(); }

  /* ── Collision checks ── */

  wallHit() {
    const h = this.head;
    return h.x < 0 || h.x >= COLS || h.y < 0 || h.y >= ROWS;
  }

  /**
   * Self-collision. Skips last segment (it vacates this tick).
   */
  selfHit() {
    const h = this.head;
    for (let i = 1; i < this.segs.length - 1; i++)
      if (this.segs[i].x === h.x && this.segs[i].y === h.y) return true;
    return false;
  }

  /**
   * Does this snake's head overlap any segment of `other`?
   * Skips other's last segment (it vacates this tick unless it ate).
   * Head-on (both heads same cell) is caught here → both die.
   */
  hitsSnake(other) {
    const h = this.head;
    for (let i = 0; i < other.segs.length - 1; i++)
      if (other.segs[i].x === h.x && other.segs[i].y === h.y) return true;
    return false;
  }

  /* ── Drawing ── */

  /**
   * Draw with smooth interpolation.
   * @param {number} t  progress [0,1] between last tick and next tick
   */
  draw(t) {
    const { head: hc, body: bc, deadHead: dhc, deadBody: dbc } = this.colors;
    const alive = this.alive;

    for (let i = this.segs.length - 1; i >= 0; i--) {
      const curr = this.segs[i];
      const prev = this.prev[i] || curr;

      const vx = lerp(prev.x, curr.x, t);
      const vy = lerp(prev.y, curr.y, t);

      // Pixel-perfect rectangle with 1px gap on each side
      const px = vx * CELL + 1;
      const py = vy * CELL + 1;
      const sz = CELL - 2;

      ctx.fillStyle = i === 0
        ? (alive ? hc  : dhc)
        : (alive ? bc  : dbc);

      ctx.fillRect(px, py, sz, sz);

      // Pixel eyes on head (alive only)
      if (i === 0 && alive) this._drawEyes(vx, vy);
    }
  }

  _drawEyes(vx, vy) {
    const { x: dx, y: dy } = this.dir;
    // Two 2×2 dark pixels perpendicular to movement
    const e1x = Math.round((vx + 0.5 + dy  * 0.22 - dx * 0.15) * CELL) - 1;
    const e1y = Math.round((vy + 0.5 - dx  * 0.22 - dy * 0.15) * CELL) - 1;
    const e2x = Math.round((vx + 0.5 - dy  * 0.22 - dx * 0.15) * CELL) - 1;
    const e2y = Math.round((vy + 0.5 + dx  * 0.22 - dy * 0.15) * CELL) - 1;
    ctx.fillStyle = '#0c0c0c';
    ctx.fillRect(e1x, e1y, 2, 2);
    ctx.fillRect(e2x, e2y, 2, 2);
  }
}

/* ─────────────────────────────────────────
   GAME STATE
───────────────────────────────────────── */
let s1, s2, food;
let gameState = 'menu';   // 'menu' | 'playing' | 'over'

// DOM refs
const overlay = document.getElementById('overlay');
const ovTitle = document.getElementById('ov-title');
const ovMsg   = document.getElementById('ov-msg');
const ovSub   = document.getElementById('ov-sub');
const scoreEl1 = document.getElementById('s1');
const scoreEl2 = document.getElementById('s2');

/* ─────────────────────────────────────────
   INIT / START / END
───────────────────────────────────────── */
function createSnakes() {
  s1 = new Snake(5, 9, 1, 0, {
    head: PAL.p1Head, body: PAL.p1Body,
    deadHead: PAL.p1DeadH, deadBody: PAL.p1DeadB,
  });
  s2 = new Snake(19, 9, -1, 0, {
    head: PAL.p2Head, body: PAL.p2Body,
    deadHead: PAL.p2DeadH, deadBody: PAL.p2DeadB,
  });
}

function showMenu() {
  ovTitle.className   = 'ov-title';
  ovTitle.textContent = '2P SNAKE';
  ovMsg.textContent   = 'P1: WASD  |  P2: ↑↓←→';
  ovSub.textContent   = 'ENTER veya SPACE ile başla';
  overlay.classList.remove('hidden');
}

function startGame() {
  createSnakes();
  food = spawnFood([s1, s2]);
  gameState = 'playing';
  accumulator = 0;
  scoreEl1.textContent = '0';
  scoreEl2.textContent = '0';
  overlay.classList.add('hidden');
}

function endGame() {
  gameState = 'over';
  let cls, title, msg;

  if (!s1.alive && !s2.alive) {
    cls   = 'draw';
    title = 'BERABERE';
    msg   = 'Aynı anda çarptınız!';
  } else if (!s1.alive) {
    cls   = 'p2-win';
    title = 'P2 KAZANDI!';
    msg   = `Skor: P1 ${s1.score}  ·  P2 ${s2.score}`;
  } else {
    cls   = 'p1-win';
    title = 'P1 KAZANDI!';
    msg   = `Skor: P1 ${s1.score}  ·  P2 ${s2.score}`;
  }

  ovTitle.className   = `ov-title ${cls}`;
  ovTitle.textContent = title;
  ovMsg.textContent   = msg;
  ovSub.textContent   = 'ENTER veya SPACE ile tekrar oyna';
  overlay.classList.remove('hidden');
}

/* ─────────────────────────────────────────
   GAME TICK  (fixed-timestep logic)
───────────────────────────────────────── */
function gameTick() {
  if (gameState !== 'playing') return;

  // Move both snakes (tail NOT removed yet)
  s1.tick();
  s2.tick();

  /* ── Collision detection ── */

  // Wall + self
  const s1Dies = s1.wallHit() || s1.selfHit();
  const s2Dies = s2.wallHit() || s2.selfHit();
  if (s1Dies) s1.alive = false;
  if (s2Dies) s2.alive = false;

  // Cross-player (only check if still alive)
  // hitsSnake skips other's last segment (vacating tail — fair play)
  if (s1.alive && s1.hitsSnake(s2)) s1.alive = false;
  if (s2.alive && s2.hitsSnake(s1)) s2.alive = false;

  // If any snake died → game over (don't pop tails → show full body)
  if (!s1.alive || !s2.alive) {
    endGame();
    return;
  }

  /* ── Food check ── */
  const ate1 = food && s1.head.x === food.x && s1.head.y === food.y;
  const ate2 = food && s2.head.x === food.x && s2.head.y === food.y;

  if (ate1 || ate2) {
    if (ate1) { s1.score += FOOD_PTS; scoreEl1.textContent = s1.score; }
    else        s1.popTail();

    if (ate2) { s2.score += FOOD_PTS; scoreEl2.textContent = s2.score; }
    else        s2.popTail();

    food = spawnFood([s1, s2]);   // null if board full (win condition)
  } else {
    s1.popTail();
    s2.popTail();
  }
}

/* ─────────────────────────────────────────
   RENDERER  (called every rAF frame)
───────────────────────────────────────── */
function render(t) {
  // Background
  ctx.fillStyle = PAL.bg;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // Subtle checkerboard grid
  for (let y = 0; y < ROWS; y++) {
    for (let x = 0; x < COLS; x++) {
      if ((x + y) % 2 === 0) {
        ctx.fillStyle = PAL.gridA;
        ctx.fillRect(x * CELL, y * CELL, CELL, CELL);
      }
    }
  }

  // Food — small pixel square with highlight dot
  if (food) {
    const fw = 10;
    const fo = (CELL - fw) / 2;
    ctx.fillStyle = PAL.food;
    ctx.fillRect(food.x * CELL + fo, food.y * CELL + fo, fw, fw);
    ctx.fillStyle = PAL.foodShine;
    ctx.fillRect(food.x * CELL + fo + 1, food.y * CELL + fo + 1, 3, 3);
  }

  // Snakes (draw dead snake first so winner renders on top)
  if (!s1.alive) s1.draw(1);  // dead — no interpolation
  if (!s2.alive) s2.draw(1);
  if (s1.alive)  s1.draw(t);
  if (s2.alive)  s2.draw(t);
}

/* ─────────────────────────────────────────
   GAME LOOP  (rAF + fixed timestep)
───────────────────────────────────────── */
let lastTime    = 0;
let accumulator = 0;

function loop(now) {
  const delta = Math.min(now - lastTime, 250);  // cap spike at 250ms
  lastTime = now;

  if (gameState === 'playing') {
    accumulator += delta;
    while (accumulator >= TICK) {
      gameTick();
      accumulator -= TICK;
    }
  }

  const t = gameState === 'playing'
    ? Math.min(accumulator / TICK, 1)
    : 1;   // freeze at current position when not playing

  render(t);
  requestAnimationFrame(loop);
}

/* ─────────────────────────────────────────
   INPUT
───────────────────────────────────────── */
document.addEventListener('keydown', e => {
  switch (e.key) {
    /* P1 — WASD */
    case 'w': case 'W': s1?.queueDir( 0, -1); e.preventDefault(); break;
    case 's': case 'S': s1?.queueDir( 0,  1); e.preventDefault(); break;
    case 'a': case 'A': s1?.queueDir(-1,  0); e.preventDefault(); break;
    case 'd': case 'D': s1?.queueDir( 1,  0); e.preventDefault(); break;
    /* P2 — Arrows */
    case 'ArrowUp'   : s2?.queueDir( 0, -1); e.preventDefault(); break;
    case 'ArrowDown' : s2?.queueDir( 0,  1); e.preventDefault(); break;
    case 'ArrowLeft' : s2?.queueDir(-1,  0); e.preventDefault(); break;
    case 'ArrowRight': s2?.queueDir( 1,  0); e.preventDefault(); break;
    /* Start / Restart */
    case 'Enter': case ' ':
      if (gameState !== 'playing') startGame();
      e.preventDefault();
      break;
  }
});

/* ─────────────────────────────────────────
   BOOT
───────────────────────────────────────── */
createSnakes();
food = spawnFood([s1, s2]);
showMenu();

requestAnimationFrame(ts => {
  lastTime = ts;
  loop(ts);
});
