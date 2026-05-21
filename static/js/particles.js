/**
 * Cloak — 3D Particle Mesh
 * Lightweight canvas particle system with perspective projection.
 * No dependencies. ~5KB unminified. 60fps target.
 */
(function () {
  "use strict";

  const canvas = document.getElementById("particle-canvas");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");

  // ── Config ──────────────────────────────────────────────
  const isMobile = window.innerWidth < 768;
  const PARTICLE_COUNT = isMobile ? 45 : 80;
  const CONNECTION_DIST = isMobile ? 120 : 150;
  const MOUSE_INFLUENCE = 0.00015;
  const PERSPECTIVE = 600;
  const DEPTH_RANGE = 300;
  const BASE_SPEED = 0.15;
  const DPR = Math.min(window.devicePixelRatio || 1, 2);

  // Colors (from Cloak design tokens)
  const DOT_COLOR = { r: 201, g: 168, b: 124 };  // --accent #C9A87C
  const LINE_COLOR = { r: 201, g: 168, b: 124 };

  // ── State ───────────────────────────────────────────────
  let width = 0;
  let height = 0;
  let mouseX = 0;
  let mouseY = 0;
  let targetMouseX = 0;
  let targetMouseY = 0;
  let particles = [];
  let running = true;
  let animId = null;
  let lastTime = 0;

  // ── Particle Class ──────────────────────────────────────
  class Particle {
    constructor() {
      this.reset();
    }

    reset() {
      this.x = (Math.random() - 0.5) * width * 1.4;
      this.y = (Math.random() - 0.5) * height * 1.4;
      this.z = Math.random() * DEPTH_RANGE;
      this.vx = (Math.random() - 0.5) * BASE_SPEED;
      this.vy = (Math.random() - 0.5) * BASE_SPEED;
      this.vz = (Math.random() - 0.5) * BASE_SPEED * 0.5;
      this.baseSize = Math.random() * 1.5 + 0.8;
    }

    update(dt) {
      this.x += this.vx * dt;
      this.y += this.vy * dt;
      this.z += this.vz * dt;

      // Wrap around edges with padding
      const boundX = width * 0.8;
      const boundY = height * 0.8;
      if (this.x < -boundX) this.x = boundX;
      if (this.x > boundX) this.x = -boundX;
      if (this.y < -boundY) this.y = boundY;
      if (this.y > boundY) this.y = -boundY;
      if (this.z < 0) this.z = DEPTH_RANGE;
      if (this.z > DEPTH_RANGE) this.z = 0;
    }

    project() {
      // Apply mouse-driven parallax shift
      const parallaxX = (mouseX - width / 2) * MOUSE_INFLUENCE * this.z;
      const parallaxY = (mouseY - height / 2) * MOUSE_INFLUENCE * this.z;

      const scale = PERSPECTIVE / (PERSPECTIVE + this.z);
      return {
        sx: (this.x + parallaxX) * scale + width / 2,
        sy: (this.y + parallaxY) * scale + height / 2,
        scale: scale,
        size: this.baseSize * scale,
        alpha: scale * 0.6,
      };
    }
  }

  // ── Setup ───────────────────────────────────────────────
  function resize() {
    const rect = canvas.parentElement.getBoundingClientRect();
    width = rect.width;
    height = rect.height;
    canvas.width = width * DPR;
    canvas.height = height * DPR;
    canvas.style.width = width + "px";
    canvas.style.height = height + "px";
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  }

  function init() {
    resize();
    particles = [];
    for (let i = 0; i < PARTICLE_COUNT; i++) {
      particles.push(new Particle());
    }
  }

  // ── Render Loop ─────────────────────────────────────────
  function draw(timestamp) {
    if (!running) return;
    animId = requestAnimationFrame(draw);

    const dt = lastTime ? Math.min((timestamp - lastTime) / 16.667, 3) : 1;
    lastTime = timestamp;

    // Smooth mouse interpolation (lerp)
    mouseX += (targetMouseX - mouseX) * 0.08;
    mouseY += (targetMouseY - mouseY) * 0.08;

    ctx.clearRect(0, 0, width, height);

    // Update & project all particles
    const projected = [];
    for (let i = 0; i < particles.length; i++) {
      particles[i].update(dt);
      projected.push(particles[i].project());
    }

    // Draw connections (batch as single path per alpha bucket)
    for (let i = 0; i < projected.length; i++) {
      const a = projected[i];
      for (let j = i + 1; j < projected.length; j++) {
        const b = projected[j];
        const dx = a.sx - b.sx;
        const dy = a.sy - b.sy;
        const dist = dx * dx + dy * dy;
        const maxDist = CONNECTION_DIST * CONNECTION_DIST;

        if (dist < maxDist) {
          const opacity = (1 - dist / maxDist) * Math.min(a.alpha, b.alpha) * 0.35;
          ctx.beginPath();
          ctx.moveTo(a.sx, a.sy);
          ctx.lineTo(b.sx, b.sy);
          ctx.strokeStyle = `rgba(${LINE_COLOR.r},${LINE_COLOR.g},${LINE_COLOR.b},${opacity.toFixed(3)})`;
          ctx.lineWidth = 0.5;
          ctx.stroke();
        }
      }
    }

    // Draw dots
    for (let i = 0; i < projected.length; i++) {
      const p = projected[i];
      ctx.beginPath();
      ctx.arc(p.sx, p.sy, p.size, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(${DOT_COLOR.r},${DOT_COLOR.g},${DOT_COLOR.b},${p.alpha.toFixed(3)})`;
      ctx.fill();
    }
  }

  // ── Events ──────────────────────────────────────────────
  let resizeTimer;
  window.addEventListener("resize", () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(resize, 150);
  }, { passive: true });

  document.addEventListener("mousemove", (e) => {
    targetMouseX = e.clientX;
    targetMouseY = e.clientY;
  }, { passive: true });

  // Touch support
  document.addEventListener("touchmove", (e) => {
    if (e.touches.length) {
      targetMouseX = e.touches[0].clientX;
      targetMouseY = e.touches[0].clientY;
    }
  }, { passive: true });

  // Auto-pause when tab hidden
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      running = false;
      if (animId) cancelAnimationFrame(animId);
    } else {
      running = true;
      lastTime = 0;
      animId = requestAnimationFrame(draw);
    }
  });

  // Pause when not on landing view
  const observer = new MutationObserver(() => {
    const landing = document.getElementById("view-landing");
    if (!landing) return;
    const isActive = landing.classList.contains("active");
    if (isActive && !running) {
      running = true;
      lastTime = 0;
      animId = requestAnimationFrame(draw);
    } else if (!isActive && running) {
      running = false;
      if (animId) cancelAnimationFrame(animId);
    }
  });

  const landingEl = document.getElementById("view-landing");
  if (landingEl) {
    observer.observe(landingEl, { attributes: true, attributeFilter: ["class"] });
  }

  // ── Boot ────────────────────────────────────────────────
  init();
  animId = requestAnimationFrame(draw);
})();
