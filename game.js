// A small jumping-bird (Flappy Bird style) canvas game.
(() => {
  const canvas = document.getElementById('game-canvas');
  if (!canvas) return;
  const overlay = document.getElementById('game-overlay');
  const overlayTitle = overlay.querySelector('.game-overlay-title');
  const overlaySub = overlay.querySelector('.game-overlay-sub');
  const scoreEl = document.getElementById('game-score');
  const bestEl = document.getElementById('game-best');
  const ctx = canvas.getContext('2d');
  const WIDTH = canvas.width;
  const HEIGHT = canvas.height;

  const BEST_KEY = 'jumping-bird-best-score';
  let best = Number(localStorage.getItem(BEST_KEY)) || 0;
  bestEl.textContent = String(best);

  const GRAVITY = 1400;        // px/s^2
  const FLAP_VELOCITY = -380;  // px/s
  const PIPE_SPEED = 140;      // px/s
  const PIPE_GAP = 150;        // px
  const PIPE_WIDTH = 54;       // px
  const PIPE_INTERVAL = 1450;  // ms

  let state = 'ready'; // 'ready' | 'playing' | 'over'
  let bird, pipes, score, spawnTimer, lastTime;

  function reset() {
    bird = { x: 70, y: HEIGHT / 2, vy: 0, r: 13, rot: 0 };
    pipes = [];
    score = 0;
    spawnTimer = 0;
    scoreEl.textContent = '0';
  }
  reset();

  function spawnPipe() {
    const margin = 60;
    const gapY = margin + Math.random() * (HEIGHT - margin * 2 - PIPE_GAP);
    pipes.push({ x: WIDTH + PIPE_WIDTH, gapY, passed: false });
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

  function update(dt) {
    if (state !== 'playing') return;

    bird.vy += GRAVITY * dt;
    bird.y += bird.vy * dt;
    bird.rot = Math.max(-0.5, Math.min(1.1, bird.vy / 500));

    spawnTimer += dt * 1000;
    if (spawnTimer >= PIPE_INTERVAL) {
      spawnTimer = 0;
      spawnPipe();
    }

    for (const pipe of pipes) {
      pipe.x -= PIPE_SPEED * dt;
      if (!pipe.passed && pipe.x + PIPE_WIDTH < bird.x) {
        pipe.passed = true;
        score += 1;
        scoreEl.textContent = String(score);
      }
    }
    pipes = pipes.filter((p) => p.x > -PIPE_WIDTH);

    if (bird.y - bird.r < 0 || bird.y + bird.r > HEIGHT) {
      gameOver();
      return;
    }
    for (const pipe of pipes) {
      const withinX = bird.x + bird.r > pipe.x && bird.x - bird.r < pipe.x + PIPE_WIDTH;
      if (!withinX) continue;
      const hitsTop = bird.y - bird.r < pipe.gapY;
      const hitsBottom = bird.y + bird.r > pipe.gapY + PIPE_GAP;
      if (hitsTop || hitsBottom) {
        gameOver();
        return;
      }
    }
  }

  function draw() {
    ctx.clearRect(0, 0, WIDTH, HEIGHT);

    ctx.fillStyle = '#28665a';
    for (const pipe of pipes) {
      ctx.fillRect(pipe.x, 0, PIPE_WIDTH, pipe.gapY);
      ctx.fillRect(pipe.x, pipe.gapY + PIPE_GAP, PIPE_WIDTH, HEIGHT - (pipe.gapY + PIPE_GAP));
    }

    ctx.save();
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
