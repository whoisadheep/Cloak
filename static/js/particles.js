/**
 * Cloak — 3D Particle Mesh
 * Lightweight canvas particle system with perspective projection.
 * No dependencies. ~5KB unminified. 60fps target.
 * Supports multiple canvas instances.
 */
(function () {
  "use strict";

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

  // ── Shared mouse state ─────────────────────────────────
  let globalMouseX = 0;
  let globalMouseY = 0;

  document.addEventListener("mousemove", (e) => {
    globalMouseX = e.clientX;
    globalMouseY = e.clientY;
  }, { passive: true });

  document.addEventListener("touchmove", (e) => {
    if (e.touches.length) {
      globalMouseX = e.touches[0].clientX;
      globalMouseY = e.touches[0].clientY;
    }
  }, { passive: true });

  // ── Particle Class ──────────────────────────────────────
  class Particle {
    constructor(w, h) {
      this._w = w; this._h = h;
      this.reset();
    }

    reset() {
      this.x = (Math.random() - 0.5) * this._w * 1.4;
      this.y = (Math.random() - 0.5) * this._h * 1.4;
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

      const boundX = this._w * 0.8;
      const boundY = this._h * 0.8;
      if (this.x < -boundX) this.x = boundX;
      if (this.x > boundX) this.x = -boundX;
      if (this.y < -boundY) this.y = boundY;
      if (this.y > boundY) this.y = -boundY;
      if (this.z < 0) this.z = DEPTH_RANGE;
      if (this.z > DEPTH_RANGE) this.z = 0;
    }

    project(mX, mY, w, h) {
      const parallaxX = (mX - w / 2) * MOUSE_INFLUENCE * this.z;
      const parallaxY = (mY - h / 2) * MOUSE_INFLUENCE * this.z;
      const scale = PERSPECTIVE / (PERSPECTIVE + this.z);
      return {
        sx: (this.x + parallaxX) * scale + w / 2,
        sy: (this.y + parallaxY) * scale + h / 2,
        scale, size: this.baseSize * scale, alpha: scale * 0.6,
      };
    }
  }

  // ── Factory: create a particle system on a canvas ──────
  function createSystem(canvasId, viewId) {
    const canvas = document.getElementById(canvasId);
    if (!canvas) return null;
    const ctx = canvas.getContext("2d");

    let width = 0, height = 0;
    let mouseX = 0, mouseY = 0;
    let particles = [];
    let running = false;
    let animId = null;
    let lastTime = 0;

    function resize() {
      const parent = canvas.parentElement;
      if (!parent) return;
      const rect = parent.getBoundingClientRect();
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
        particles.push(new Particle(width, height));
      }
    }

    function draw(timestamp) {
      if (!running) return;
      animId = requestAnimationFrame(draw);

      const dt = lastTime ? Math.min((timestamp - lastTime) / 16.667, 3) : 1;
      lastTime = timestamp;

      mouseX += (globalMouseX - mouseX) * 0.08;
      mouseY += (globalMouseY - mouseY) * 0.08;

      ctx.clearRect(0, 0, width, height);

      const projected = [];
      for (let i = 0; i < particles.length; i++) {
        particles[i].update(dt);
        projected.push(particles[i].project(mouseX, mouseY, width, height));
      }

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

      for (let i = 0; i < projected.length; i++) {
        const p = projected[i];
        ctx.beginPath();
        ctx.arc(p.sx, p.sy, p.size, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(${DOT_COLOR.r},${DOT_COLOR.g},${DOT_COLOR.b},${p.alpha.toFixed(3)})`;
        ctx.fill();
      }
    }

    function start() {
      if (running) return;
      if (!particles.length) init();
      resize();
      running = true;
      lastTime = 0;
      animId = requestAnimationFrame(draw);
    }

    function stop() {
      running = false;
      if (animId) cancelAnimationFrame(animId);
      animId = null;
    }

    // Observe the parent view's .active class
    const viewEl = document.getElementById(viewId);
    if (viewEl) {
      const obs = new MutationObserver(() => {
        if (viewEl.classList.contains("active")) { start(); }
        else { stop(); }
      });
      obs.observe(viewEl, { attributes: true, attributeFilter: ["class"] });

      // Start immediately if view is already active
      if (viewEl.classList.contains("active")) start();
    }

    // Handle resize
    let resizeTimer;
    window.addEventListener("resize", () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(resize, 150);
    }, { passive: true });

    // Handle tab visibility
    document.addEventListener("visibilitychange", () => {
      const viewEl = document.getElementById(viewId);
      if (!viewEl) return;
      if (document.hidden) { stop(); }
      else if (viewEl.classList.contains("active")) { start(); }
    });

    return { start, stop, init };
  }

  // ── Boot both systems ──────────────────────────────────
  createSystem("particle-canvas", "view-landing");
  createSystem("template-particle-canvas", "view-template");
  createSystem("onboarding-particle-canvas", "view-onboarding");
})();
