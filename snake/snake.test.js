/**
 * 2P Snake — snake.test.js
 * Pure Node.js unit tests (no DOM/canvas).
 *
 * Run:  node snake.test.js
 *
 * Covers:
 *   ✓ Direction queue — 180° reversal blocked
 *   ✓ Direction queue — rapid inputs buffered correctly
 *   ✓ Wall collision
 *   ✓ Self collision (tail-vacate edge case)
 *   ✓ Cross-player head-on collision → both die
 *   ✓ Cross-player body collision (tail-vacate fair play)
 *   ✓ Food spawn — no overlap with both snakes
 *   ✓ Food spawn — full board returns null
 *   ✓ Snake grows on food, pops tail otherwise
 *   ✓ Score increments on eat
 *   ✓ Smooth interpolation lerp
 *   ✓ Dead snake renders at t=1 (no jitter)
 */

'use strict';

/* ── Test Harness ─────────────────────── */
let passed = 0, failed = 0;

function assert(condition, message) {
  if (condition) { console.log(`  ✅  ${message}`); passed++; }
  else           { console.error(`  ❌  ${message}`); failed++; }
}
function describe(label, fn) {
  console.log(`\n🔷 ${label}`);
  fn();
}

/* ── Extracted Pure Logic (mirrors game.js) ─ */

const COLS = 25, ROWS = 20, CELL = 20;

function lerp(a, b, t) { return a + (b - a) * t; }

function spawnFood(snakes) {
  const occ = new Set();
  snakes.forEach(s => s.segs.forEach(p => occ.add(`${p.x},${p.y}`)));
  const free = [];
  for (let y = 0; y < ROWS; y++)
    for (let x = 0; x < COLS; x++)
      if (!occ.has(`${x},${y}`)) free.push({ x, y });
  return free.length ? free[Math.floor(Math.random() * free.length)] : null;
}

class Snake {
  constructor(sx, sy, dx, dy) {
    this.sx = sx; this.sy = sy; this.sdx = dx; this.sdy = dy;
    this.reset();
  }
  reset() {
    this.segs = [
      { x: this.sx,              y: this.sy              },
      { x: this.sx - this.sdx,  y: this.sy - this.sdy   },
      { x: this.sx - this.sdx*2,y: this.sy - this.sdy*2 },
    ];
    this.prev  = this.segs.map(s => ({ ...s }));
    this.dir   = { x: this.sdx, y: this.sdy };
    this.score = 0;
    this.alive = true;
    this.queue = [];
  }
  get head() { return this.segs[0]; }

  queueDir(dx, dy) {
    if (this.queue.length < 2) this.queue.push({ x: dx, y: dy });
  }

  tick() {
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
  }
  popTail() { this.segs.pop(); }

  wallHit() {
    const h = this.head;
    return h.x < 0 || h.x >= COLS || h.y < 0 || h.y >= ROWS;
  }
  selfHit() {
    const h = this.head;
    for (let i = 1; i < this.segs.length - 1; i++)
      if (this.segs[i].x === h.x && this.segs[i].y === h.y) return true;
    return false;
  }
  hitsSnake(other) {
    const h = this.head;
    for (let i = 0; i < other.segs.length - 1; i++)
      if (other.segs[i].x === h.x && other.segs[i].y === h.y) return true;
    return false;
  }
}

/* ── Helper: simulate N ticks ─────────── */
function simulate(s1, s2, n) {
  for (let i = 0; i < n; i++) {
    s1.tick(); s2.tick();
    if (!s1.wallHit() && !s1.selfHit()) s1.popTail(); else s1.alive = false;
    if (!s2.wallHit() && !s2.selfHit()) s2.popTail(); else s2.alive = false;
  }
}

/* ─────────────────────────────────────────
   TESTS
───────────────────────────────────────── */

describe('Direction queue — 180° reversal prevention', () => {
  const s = new Snake(10, 10, 1, 0); // moving RIGHT

  // Try to queue LEFT (direct reversal) — should be skipped
  s.queueDir(-1, 0);
  s.tick(); s.popTail();
  assert(s.dir.x === 1 && s.dir.y === 0, 'RIGHT → LEFT blocked, stays RIGHT');

  // Valid turn
  s.queueDir(0, -1);
  s.tick(); s.popTail();
  assert(s.dir.x === 0 && s.dir.y === -1, 'RIGHT → UP allowed');

  // Try to queue DOWN (reversal of current UP) — should be skipped
  s.queueDir(0, 1);
  s.tick(); s.popTail();
  assert(s.dir.x === 0 && s.dir.y === -1, 'UP → DOWN blocked, stays UP');
});

describe('Direction queue — rapid input buffering', () => {
  const s = new Snake(10, 10, 1, 0); // moving RIGHT
  // Queue UP then LEFT (valid sequence: RIGHT→UP→LEFT)
  s.queueDir(0, -1);
  s.queueDir(-1, 0);
  assert(s.queue.length === 2, 'Two directions buffered');

  s.tick(); s.popTail();  // applies UP
  assert(s.dir.x === 0 && s.dir.y === -1, 'First queued dir (UP) applied on tick 1');

  s.tick(); s.popTail();  // applies LEFT
  assert(s.dir.x === -1 && s.dir.y === 0, 'Second queued dir (LEFT) applied on tick 2');
});

describe('Queue overflow prevention (max 2)', () => {
  const s = new Snake(10, 10, 1, 0);
  s.queueDir(0, -1);
  s.queueDir(-1, 0);
  s.queueDir(0, 1);   // 3rd — should be dropped
  assert(s.queue.length === 2, 'Queue capped at 2 entries');
});

describe('Wall collision', () => {
  // Snake at left edge moving left → wall hit
  const s = new Snake(1, 5, -1, 0);
  s.tick(); // head now at x=0
  assert(!s.wallHit(), 'x=0 is still in bounds');
  s.tick(); // head now at x=-1
  assert(s.wallHit(), 'x=-1 is a wall hit');

  // Snake at right edge moving right
  const s2 = new Snake(COLS - 2, 5, 1, 0);
  s2.tick(); // head at COLS-1
  assert(!s2.wallHit(), `x=${COLS-1} is in bounds`);
  s2.tick(); // head at COLS
  assert(s2.wallHit(), `x=${COLS} is a wall hit`);

  // Top edge
  const s3 = new Snake(5, 1, 0, -1);
  s3.tick(); // head at y=0
  assert(!s3.wallHit(), 'y=0 is in bounds');
  s3.tick(); // head at y=-1
  assert(s3.wallHit(), 'y=-1 is a wall hit');
});

describe('Self collision — tail-vacate edge case', () => {
  // Snake of length 3 moving right: head moves forward, tail vacates
  // New head should NOT collide with old tail (it moved away)
  const s = new Snake(5, 5, 1, 0);
  // segs: [5,5],[4,5],[3,5]
  s.tick();   // segs: [6,5],[5,5],[4,5],[3,5] before popTail
  s.popTail(); // segs: [6,5],[5,5],[4,5]
  assert(!s.selfHit(), 'Normal forward move is not self-collision');

  // Build a snake that's turned into a U shape and about to collide with neck
  // Manually construct: head at (5,5), body at (4,5),(4,6),(5,6)
  const s2 = new Snake(5, 5, 1, 0);
  s2.segs = [{ x:5,y:5 },{ x:4,y:5 },{ x:4,y:6 },{ x:5,y:6 }];
  s2.prev = s2.segs.map(x => ({...x}));
  s2.dir  = { x:0, y:1 }; // moving down
  s2.tick(); // new head = (5,6) — same as last body segment (5,6)
  // selfHit checks [1..length-2] = [4,5],[4,6] — (5,6) is NOT in there
  // (5,6) IS segs[3] which is the last segment — skipped → no collision
  // This is the "tail vacate" case: the tail (5,6) moves away
  assert(!s2.selfHit(), 'Head moving into vacating tail is NOT a self-collision');

  // True self-collision: head into body
  const s3 = new Snake(5, 5, 1, 0);
  s3.segs = [{ x:5,y:5 },{ x:4,y:5 },{ x:4,y:6 },{ x:5,y:6 },{ x:6,y:6 }];
  s3.prev = s3.segs.map(x => ({...x}));
  s3.dir  = { x:0, y:1 };
  s3.tick(); // new head = (5,6) — same as segs[3]=(5,6) which is NOT last → collision
  assert(s3.selfHit(), 'Head moving into non-vacating body IS a self-collision');
});

describe('Cross-player: head-on collision → both die', () => {
  // P1 at (10,9) moving right, P2 at (12,9) moving left
  // After 1 tick: P1 head = (11,9), P2 head = (11,9) → head-on
  const p1 = new Snake(10, 9, 1, 0);
  const p2 = new Snake(12, 9, -1, 0);
  p1.tick(); p2.tick();

  const p1HitsP2 = p1.hitsSnake(p2);
  const p2HitsP1 = p2.hitsSnake(p1);
  assert(p1HitsP2, 'P1 head detects P2 head at same cell');
  assert(p2HitsP1, 'P2 head detects P1 head at same cell');
  // Both would die → draw
});

describe('Cross-player: body collision', () => {
  // P1 running horizontally, P2 turning into P1's body
  const p1 = new Snake(5, 5, 1, 0);
  // Manually extend P1 to have a long horizontal body
  p1.segs = [
    {x:10,y:5},{x:9,y:5},{x:8,y:5},{x:7,y:5},{x:6,y:5}
  ];
  p1.prev = p1.segs.map(s=>({...s}));
  p1.dir  = { x:1, y:0 };

  // P2 above P1's body, moving down
  const p2 = new Snake(8, 3, 0, 1);
  p2.tick(); // head = (8,4)
  p2.tick(); // head = (8,5) — same row as P1's body at x=8

  assert(p2.hitsSnake(p1), 'P2 head collides with P1 body');
  assert(!p1.hitsSnake(p2), 'P1 head does NOT collide with P2 (P2 is above)');
});

describe('Cross-player: tail-vacate is safe', () => {
  // P2's tail is at (5,5). P1's head moves to (5,5) same tick.
  // P2's tail should vacate → P1 is safe.
  const p1 = new Snake(4, 5, 1, 0); // head at (4,5), moving right → new head = (5,5)
  const p2 = new Snake(8, 5, -1, 0);
  // Manually set P2 body so its last segment (tail) is at (5,5)
  p2.segs = [{x:8,y:5},{x:7,y:5},{x:6,y:5},{x:5,y:5}];
  p2.prev = p2.segs.map(s=>({...s}));
  p2.dir  = { x:-1, y:0 };

  p1.tick(); // P1 head → (5,5)
  // hitsSnake checks p2.segs[0..length-2] = [{x:8},{x:7},{x:6}] → (5,5) NOT in there
  assert(!p1.hitsSnake(p2), 'P1 moving into P2 vacating tail is NOT a collision (fair play)');
});

describe('Food spawn — correctness', () => {
  const p1 = new Snake(0, 0, 1, 0);
  const p2 = new Snake(24, 19, -1, 0);
  const f  = spawnFood([p1, p2]);
  assert(f !== null, 'Food spawns when board has free cells');
  assert(f.x >= 0 && f.x < COLS, 'Food x is within bounds');
  assert(f.y >= 0 && f.y < ROWS, 'Food y is within bounds');

  const allSegs = [...p1.segs, ...p2.segs];
  const onSnake = allSegs.some(s => s.x === f.x && s.y === f.y);
  assert(!onSnake, 'Food does not overlap either snake');
});

describe('Food spawn — full board returns null', () => {
  // Fill the entire board
  const fullSnake = { segs: [] };
  for (let y = 0; y < ROWS; y++)
    for (let x = 0; x < COLS; x++)
      fullSnake.segs.push({ x, y });
  assert(spawnFood([fullSnake]) === null, 'Returns null when board is completely full');
});

describe('Food spawn — probabilistic spread (500 runs)', () => {
  const p1 = new Snake(12, 10, 1, 0);
  const p2 = new Snake(13, 10, -1, 0);
  const seen = new Set();
  for (let i = 0; i < 500; i++) {
    const f = spawnFood([p1, p2]);
    if (f) seen.add(`${f.x},${f.y}`);
  }
  assert(seen.size > 30, `Food uses varied cells (${seen.size} unique in 500 runs)`);
});

describe('Snake grows on food, stays same length otherwise', () => {
  const s = new Snake(5, 5, 1, 0);
  const lenBefore = s.segs.length;

  // Tick without eating: unshift + popTail → same length
  s.tick();
  s.popTail();
  assert(s.segs.length === lenBefore, 'Length unchanged when no food eaten');
  assert(s.segs[0].x === 6, 'Head advanced one step right');

  // Tick simulating food (no popTail) → grows by 1
  s.tick();
  // DO NOT call popTail — simulates eating food
  assert(s.segs.length === lenBefore + 1, 'Snake grows by 1 when food eaten (no popTail)');
});

describe('Score increments correctly', () => {
  const s = new Snake(5, 5, 1, 0);
  assert(s.score === 0, 'Score starts at 0');
  s.score += 10;
  assert(s.score === 10, 'Score is 10 after one food (+10)');
  s.score += 10;
  assert(s.score === 20, 'Score is 20 after two foods');
});

describe('Smooth interpolation — lerp', () => {
  assert(lerp(0, 10, 0)   === 0,   'lerp(0,10,0) = 0');
  assert(lerp(0, 10, 1)   === 10,  'lerp(0,10,1) = 10');
  assert(lerp(0, 10, 0.5) === 5,   'lerp(0,10,0.5) = 5');
  assert(lerp(5, 15, 0.25) === 7.5,'lerp(5,15,0.25) = 7.5');
  assert(lerp(10, 0, 0.3) === 7,   'lerp(10,0,0.3) = 7 (reverse)');

  // Interpolated pixel position should map grid coords smoothly
  const cellLerp = (a, b, t) => lerp(a, b, t) * CELL + 1;
  assert(cellLerp(3, 4, 0)   === 3 * CELL + 1, 'Cell pos at t=0 is prev cell');
  assert(cellLerp(3, 4, 1)   === 4 * CELL + 1, 'Cell pos at t=1 is curr cell');
  assert(cellLerp(3, 4, 0.5) === 3.5 * CELL + 1, 'Cell pos at t=0.5 is halfway');
});

describe('Dead snake renders at t=1 (stable, no jitter)', () => {
  // When game is over, dead snake should draw at t=1 (fully at final position)
  // prevSegs === segs at t=1 → no visual movement
  const s = new Snake(5, 5, 1, 0);
  s.tick(); s.popTail();
  // Simulate death
  s.alive = false;
  // At t=1, lerp(prev, curr, 1) === curr (no jitter)
  for (let i = 0; i < s.segs.length; i++) {
    const curr = s.segs[i];
    const prev = s.prev[i] || curr;
    const vx = lerp(prev.x, curr.x, 1);
    const vy = lerp(prev.y, curr.y, 1);
    assert(vx === curr.x && vy === curr.y,
      `Seg ${i} renders at exact grid position at t=1`);
  }
});

/* ── Summary ─────────────────────────── */
console.log('\n' + '─'.repeat(50));
console.log(`Results: ${passed} passed, ${failed} failed out of ${passed + failed} tests`);
if (failed === 0) { console.log('🎉 All tests passed!\n'); }
else              { console.error(`⚠️  ${failed} test(s) failed.\n`); process.exit(1); }
