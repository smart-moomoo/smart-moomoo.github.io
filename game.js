// A small jumping-bird (Flappy Bird style) canvas game — with a real
// difficulty curve, gaps that drift, a risk/reward "close call" bonus
// for tight flying, a streak multiplier, and a one-hit shield pickup.
(() => {
  const canvas = document.getElementById('game-canvas');
  if (!canvas) return;
  const overlay = document.getElementById('game-overlay');
  const overlayTitle = overlay.querySelector('.game-overlay-title');
  const overlaySub = overlay.querySelector('.game-overlay-sub');
  const scoreEl = document.getElementById('game-score');
  const bestEl = document.getElementById('game-best');
  const shieldEl = document.getElementById('game-shield');
  const ctx = canvas.getContext('2d');
  const WIDTH = canvas.width;
  const HEIGHT = canvas.height;

  const BEST_KEY = 'jumping-bird-best-score';
  let best = Number(localStorage.getItem(BEST_KEY)) || 0;
  bestEl.textContent = String(best);

  const GRAVITY = 1400;        // px/s^2
  const FLAP_VELOCITY = -380;  // px/s
  const PIPE_WIDTH = 54;
  const PIPE_MARGIN = 56;      // min distance a gap can sit from top/bottom

  // Difficulty ramps with score, each capped so it stays playable.
  const BASE_SPEED = 140, MAX_SPEED = 260, SPEED_RAMP = 4;         // px/s per point
  const BASE_GAP = 150, MIN_GAP = 118, GAP_SHRINK = 1.6;           // px per point
  const BASE_INTERVAL = 1450, MIN_INTERVAL = 950, INTERVAL_SHRINK = 12; // ms per point

  // Drifting gaps unlock once the run has warmed up.
  const MOVING_PIPE_SCORE = 5;
  const MOVING_PIPE_CHANCE = 0.45;
  const MOVING_AMPLITUDE = 38;   // px
  const MOVING_SPEED = 1.6;      // rad/s

  // Risk/reward scoring: flying close to a pipe edge pays out more.
  const GRAZE_DISTANCE = 16;     // px clearance counted as a "close call"
  const GRAZE_BONUS = 1;
  const STREAK_MILESTONE = 3;
  const STREAK_BONUS = 5;

  // A collectible shield absorbs one death instead of ending the run.
  const MAX_SHIELDS = 1;
  const SHIELD_CHANCE = 0.28;    // per spawned pipe, while under the cap
  const ORB_RADIUS = 8;
  const INVULN_TIME = 1.1;       // seconds of grace after a shield is used

  let state = 'ready'; // 'ready' | 'playing' | 'over'
  let bird, pipes, popups, score, shields, combo, spawnTimer, elapsed, invuln, lastTime;

  function currentSpeed() { return Math.min(MAX_SPEED, BASE_SPEED + score * SPEED_RAMP); }
  function currentGap() { return Math.max(MIN_GAP, BASE_GAP - score * GAP_SHRINK); }
  function currentInterval() { return Math.max(MIN_INTERVAL, BASE_INTERVAL - score * INTERVAL_SHRINK); }

  function reset() {
    bird = { x: 70, y: HEIGHT / 2, vy: 0, r: 13, rot: 0 };
    pipes = [];
    popups = [];
    score = 0;
    shields = 0;
    combo = 0;
    spawnTimer = 0;
    elapsed = 0;
    invuln = 0;
    scoreEl.textContent = '0';
    shieldEl.textContent = '0';
  }
  reset();

  function spawnPipe() {
    const gapHeight = currentGap();
    const gapY = PIPE_MARGIN + Math.random() * (HEIGHT - PIPE_MARGIN * 2 - gapHeight);
    const moving = score >= MOVING_PIPE_SCORE && Math.random() < MOVING_PIPE_CHANCE;
    const hasOrb = shields < MAX_SHIELDS && Math.random() < SHIELD_CHANCE;
    pipes.push({
      x: WIDTH + PIPE_WIDTH,
      baseGapY: gapY,
      gapY,
      gapHeight,
      moving,
      phase: Math.random() * Math.PI * 2,
      hasOrb,
      orbTaken: false,
      passed: false,
      minClearance: Infinity,
    });
  }

  function addPopup(text, x, y, color) {
    popups.push({ text, x, y, life: 0.7, color });
  }

  function showOverlay(title, sub) {
    overlayTitle.textContent = title;
    overlaySub.textContent = sub;
    overlay.hidden = false;
  }

  function flap() {
    if (state === 'ready') {
      state = 'playing';
      overlay.hidden = true;
      bird.vy = FLAP_VELOCITY;
      return;
    }
    if (state === 'over') {
      reset();
      state = 'playing';
      overlay.hidden = true;
      bird.vy = FLAP_VELOCITY;
      return;
    }
    bird.vy = FLAP_VELOCITY;
  }

  function gameOver() {
    state = 'over';
    if (score > best) {
      best = score;
      localStorage.setItem(BEST_KEY, String(best));
    }
    bestEl.textContent = String(best);
    showOverlay('Game over', `Score ${score} — click, tap, or press Space to try again`);
  }

  function consumeShield() {
    shields -= 1;
    shieldEl.textContent = String(shields);
    invuln = INVULN_TIME;
    bird.vy = FLAP_VELOCITY * 0.7;
    bird.y = Math.max(bird.r + 2, Math.min(HEIGHT - bird.r - 2, bird.y));
    addPopup('Shield used!', bird.x, bird.y - 24, '#c98a1f');
  }

  function registerPass(pipe) {
    pipe.passed = true;
    const graze = pipe.minClearance < GRAZE_DISTANCE;
    let gained = 1;
    if (graze) {
      gained += GRAZE_BONUS;
      combo += 1;
      addPopup(`+${gained} close call`, bird.x, bird.y - 22, '#28665a');
      if (combo % STREAK_MILESTONE === 0) {
        gained += STREAK_BONUS;
        addPopup(`streak x${combo}! +${STREAK_BONUS}`, bird.x, bird.y - 40, '#c98a1f');
      }
    } else {
      combo = 0;
    }
    score += gained;
    scoreEl.textContent = String(score);
  }

  function update(dt) {
    if (state !== 'playing') return;
    elapsed += dt;
    if (invuln > 0) invuln = Math.max(0, invuln - dt);

    bird.vy += GRAVITY * dt;
    bird.y += bird.vy * dt;
    bird.rot = Math.max(-0.5, Math.min(1.1, bird.vy / 500));

    spawnTimer += dt * 1000;
    if (spawnTimer >= currentInterval()) {
      spawnTimer = 0;
      spawnPipe();
    }

    const speed = currentSpeed();
    for (const pipe of pipes) {
      pipe.x -= speed * dt;
      if (pipe.moving) {
        const maxY = HEIGHT - PIPE_MARGIN - pipe.gapHeight;
        const drift = Math.sin(elapsed * MOVING_SPEED + pipe.phase) * MOVING_AMPLITUDE;
        pipe.gapY = Math.min(maxY, Math.max(PIPE_MARGIN, pipe.baseGapY + drift));
      }
    }

    for (const pipe of pipes) {
      if (pipe.hasOrb && !pipe.orbTaken) {
        const orbX = pipe.x + PIPE_WIDTH / 2;
        const orbY = pipe.gapY + pipe.gapHeight / 2;
        const dx = bird.x - orbX, dy = bird.y - orbY;
        if (Math.sqrt(dx * dx + dy * dy) < bird.r + ORB_RADIUS) {
          pipe.orbTaken = true;
          shields = Math.min(MAX_SHIELDS, shields + 1);
          shieldEl.textContent = String(shields);
          score += 3;
          scoreEl.textContent = String(score);
          addPopup('+3 shield!', orbX, orbY - 16, '#c98a1f');
        }
      }

      const withinX = bird.x + bird.r > pipe.x && bird.x - bird.r < pipe.x + PIPE_WIDTH;
      if (withinX) {
        const distTop = bird.y - pipe.gapY;
        const distBottom = (pipe.gapY + pipe.gapHeight) - bird.y;
        pipe.minClearance = Math.min(pipe.minClearance, Math.min(distTop, distBottom) - bird.r);

        if (invuln <= 0 && (distTop < bird.r || distBottom < bird.r)) {
          if (shields > 0) {
            consumeShield();
          } else {
            gameOver();
            return;
          }
        }
      }

      if (!pipe.passed && pipe.x + PIPE_WIDTH < bird.x) {
        registerPass(pipe);
      }
    }
    pipes = pipes.filter((p) => p.x > -PIPE_WIDTH);

    for (const p of popups) { p.life -= dt; p.y -= dt * 26; }
    popups = popups.filter((p) => p.life > 0);

    if (invuln <= 0 && (bird.y - bird.r < 0 || bird.y + bird.r > HEIGHT)) {
      if (shields > 0) {
        consumeShield();
      } else {
        gameOver();
        return;
      }
    }
  }

  function draw() {
    ctx.clearRect(0, 0, WIDTH, HEIGHT);

    for (const pipe of pipes) {
      ctx.fillStyle = pipe.moving ? '#3c7d6d' : '#28665a';
      ctx.fillRect(pipe.x, 0, PIPE_WIDTH, pipe.gapY);
      ctx.fillRect(pipe.x, pipe.gapY + pipe.gapHeight, PIPE_WIDTH, HEIGHT - (pipe.gapY + pipe.gapHeight));
      if (pipe.hasOrb && !pipe.orbTaken) {
        ctx.fillStyle = '#e0a52e';
        ctx.beginPath();
        ctx.arc(pipe.x + PIPE_WIDTH / 2, pipe.gapY + pipe.gapHeight / 2, ORB_RADIUS, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    ctx.save();
    ctx.globalAlpha = invuln > 0 ? (Math.floor(elapsed * 20) % 2 === 0 ? 0.4 : 1) : 1;
    ctx.translate(bird.x, bird.y);
    ctx.rotate(bird.rot);
    ctx.fillStyle = '#242d31';
    ctx.beginPath();
    ctx.arc(0, 0, bird.r, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#f8f7f3';
    ctx.beginPath();
    ctx.arc(4, -3, 2.4, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    ctx.textAlign = 'center';
    ctx.font = '600 14px sans-serif';
    for (const p of popups) {
      ctx.globalAlpha = Math.max(0, p.life / 0.7);
      ctx.fillStyle = p.color;
      ctx.fillText(p.text, p.x, p.y);
    }
    ctx.globalAlpha = 1;
  }

  function loop(t) {
    if (!lastTime) lastTime = t;
    const dt = Math.min((t - lastTime) / 1000, 0.033);
    lastTime = t;
    update(dt);
    draw();
    requestAnimationFrame(loop);
  }

  canvas.addEventListener('pointerdown', (e) => { e.preventDefault(); flap(); });
  overlay.addEventListener('pointerdown', (e) => { e.preventDefault(); flap(); });
  window.addEventListener('keydown', (e) => {
    if (e.code === 'Space') { e.preventDefault(); flap(); }
  });

  requestAnimationFrame(loop);
})();
