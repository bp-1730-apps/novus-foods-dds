/**
 * novus-interactions.js — Novus Foods 1730 Ops Hub
 * Premium micro-interactions: spring press, card reveals, smooth focus, ripples.
 * Add <script src="novus-interactions.js" defer></script> to every page.
 * Zero dependencies. Zero framework. Pure tactile delight.
 */

(function () {
  'use strict';

  /* ── 1. BUTTON TACTILE PRESS
     All buttons get a spring-scale on mousedown/touchstart.
     We use pointer events so it works on touch + mouse.
  ─────────────────────────────────────────────────────── */
  function initTactilePress() {
    const PRESS_SELECTORS = [
      'button', '.btn', '.cmd-tab', '.btn-cmd', '.btn-cmd-icon',
      '.sd-item', '.roe-add-btn', '.na-add-btn', '.na-toggle-done',
      '.checkbox-btn', '.toggle-btn', '.cv-close', '.roe-close',
      '.na-close', '.maint-close', '.help-close', '.maint-copy-btn',
      '.maint-done-btn', '.hub-logout', '.hub-card', '.dot',
      '.gallery-item', '.tool-btn',
    ].join(',');

    document.addEventListener('pointerdown', function (e) {
      const el = e.target.closest(PRESS_SELECTORS);
      if (!el || el.disabled || el.hasAttribute('disabled')) return;

      // Don't intercept drag/scroll gestures
      if (e.pointerType === 'touch' && e.isPrimary === false) return;

      // Skip elements whose transform is owned by CSS (e.g. nav arrows use
      // translateY(-50%) for centering). If an element has a computed transform
      // but no *inline* style transform, CSS is in charge — don't override it.
      const computedTx = getComputedStyle(el).transform;
      const inlineTx   = el.style.transform;
      const identity   = 'none';
      if (computedTx && computedTx !== identity && !inlineTx) return;

      // Compose scale with any existing inline transform so we don't stomp it.
      const base = inlineTx || '';
      el.style.transition = 'transform 80ms cubic-bezier(0.25,1,0.5,1)';
      el.style.transform  = base ? `${base} scale(0.97)` : 'scale(0.97)';

      function release() {
        el.style.transition = 'transform 300ms cubic-bezier(0.25,1,0.5,1)';
        el.style.transform  = base; // restore to exactly what it was
        cleanup();
      }
      function cleanup() {
        document.removeEventListener('pointerup',     release);
        document.removeEventListener('pointercancel', release);
      }
      document.addEventListener('pointerup',     release, { once: true });
      document.addEventListener('pointercancel', release, { once: true });
    }, { passive: true });
  }

  /* ── 2. RIPPLE EFFECT ON PRIMARY BUTTONS
     Creates a circular ink ripple from the click point.
  ─────────────────────────────────────────────────────── */
  function initRipple() {
    const RIPPLE_SELECTORS = '.btn-primary, .btn-teal, .btn-danger, .na-add-btn';

    document.addEventListener('click', function (e) {
      const btn = e.target.closest(RIPPLE_SELECTORS);
      if (!btn) return;

      const rect   = btn.getBoundingClientRect();
      const size   = Math.max(rect.width, rect.height) * 2;
      const x      = e.clientX - rect.left - size / 2;
      const y      = e.clientY - rect.top  - size / 2;

      const ripple = document.createElement('span');
      ripple.style.cssText = [
        `position:absolute`,
        `width:${size}px`,
        `height:${size}px`,
        `left:${x}px`,
        `top:${y}px`,
        `border-radius:50%`,
        `background:rgba(255,255,255,0.28)`,
        `transform:scale(0)`,
        `pointer-events:none`,
        `animation:novus-ripple 550ms cubic-bezier(0.25,1,0.5,1) forwards`,
      ].join(';');

      // Ensure btn has relative positioning
      const pos = getComputedStyle(btn).position;
      if (pos === 'static') btn.style.position = 'relative';
      btn.style.overflow = 'hidden';
      btn.appendChild(ripple);

      ripple.addEventListener('animationend', () => ripple.remove(), { once: true });
    });

    // Inject keyframe if not already present
    if (!document.getElementById('novus-ripple-kf')) {
      const style = document.createElement('style');
      style.id = 'novus-ripple-kf';
      style.textContent = `
        @keyframes novus-ripple {
          to { transform: scale(1); opacity: 0; }
        }
      `;
      document.head.appendChild(style);
    }
  }

  /* ── 3. CARD SCROLL REVEAL
     Cards fade+slide up as they enter the viewport.
     Works on any element with class .panel, .pretty-card,
     .hub-card, .manager-panel, .rule-card, .value-card.
  ─────────────────────────────────────────────────────── */
  function initScrollReveal() {
    if (!window.IntersectionObserver) return;

    const REVEAL_SELECTORS = [
      '.pretty-card', '.hub-card', '.manager-panel',
      '.rule-card', '.value-card', '.summary-card',
      '.add-panel', '.table-panel', '.metric-box',
    ].join(',');

    const cards = document.querySelectorAll(REVEAL_SELECTORS);
    if (!cards.length) return;

    // Pre-hide cards that are below the fold
    cards.forEach((card, i) => {
      const rect = card.getBoundingClientRect();
      if (rect.top > window.innerHeight) {
        card.style.opacity    = '0';
        card.style.transform  = 'translateY(16px)';
        card.style.transition = 'none';
        card.dataset.revealIndex = i;
      }
    });

    const observer = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (!entry.isIntersecting) return;
        const card  = entry.target;
        const delay = (parseInt(card.dataset.revealIndex, 10) % 6) * 50;

        requestAnimationFrame(() => {
          card.style.transition = `opacity 400ms cubic-bezier(0.25,1,0.5,1) ${delay}ms,
                                   transform 400ms cubic-bezier(0.25,1,0.5,1) ${delay}ms`;
          card.style.opacity   = '1';
          card.style.transform = 'none';
        });

        observer.unobserve(card);
      });
    }, { threshold: 0.1, rootMargin: '0px 0px -40px 0px' });

    cards.forEach(card => observer.observe(card));
  }

  /* ── 4. INPUT FOCUS GLOW
     Subtle lift + shadow when any input gains focus.
  ─────────────────────────────────────────────────────── */
  function initInputFocus() {
    const INPUT_SELECTORS = 'input, textarea, select, .task-input, .na-input';

    document.addEventListener('focusin', function (e) {
      const el = e.target;
      if (!el.matches(INPUT_SELECTORS)) return;
      el.style.transition = 'transform 200ms cubic-bezier(0.25,1,0.5,1)';
      el.style.transform  = 'translateY(-1px)';
    });

    document.addEventListener('focusout', function (e) {
      const el = e.target;
      if (!el.matches(INPUT_SELECTORS)) return;
      el.style.transition = 'transform 200ms cubic-bezier(0.25,1,0.5,1)';
      el.style.transform  = '';
    });
  }

  /* ── 5. CARD HOVER PARALLAX (subtle tilt)
     On desktop only — adds a 3D tilt to hub-cards.
  ─────────────────────────────────────────────────────── */
  function initCardParallax() {
    if (window.matchMedia('(pointer: coarse)').matches) return; // skip touch

    document.querySelectorAll('.hub-card, .pretty-card, .value-card').forEach(card => {
      card.addEventListener('mousemove', function (e) {
        const rect   = card.getBoundingClientRect();
        const cx     = rect.left + rect.width  / 2;
        const cy     = rect.top  + rect.height / 2;
        const dx     = (e.clientX - cx) / rect.width;
        const dy     = (e.clientY - cy) / rect.height;
        const rotX   = -dy * 5;
        const rotY   =  dx * 5;

        card.style.transition = 'transform 80ms linear';
        card.style.transform  = `perspective(800px) rotateX(${rotX}deg) rotateY(${rotY}deg) translateY(-4px)`;
      });

      card.addEventListener('mouseleave', function () {
        card.style.transition = 'transform 400ms cubic-bezier(0.25,1,0.5,1)';
        card.style.transform  = '';
      });
    });
  }

  /* ── 6. SMOOTH DROPDOWN CLOSE ON OUTSIDE CLICK ── */
  function initDropdownDismiss() {
    // The existing code uses toggleMore() — we just enhance the close animation
    const origCloseMore = window.closeMore;
    if (typeof origCloseMore === 'function') {
      window.closeMore = function () {
        const dd = document.getElementById('more-dropdown');
        if (dd && !dd.classList.contains('hidden')) {
          dd.style.animation = 'novus-fadeUp 120ms cubic-bezier(0.4,0,1,1) forwards';
          setTimeout(() => {
            dd.classList.add('hidden');
            dd.style.animation = '';
            origCloseMore();
          }, 100);
          return;
        }
        origCloseMore();
      };
    }

    // Inject fadeUp-out keyframe
    if (!document.getElementById('novus-extra-kf')) {
      const style = document.createElement('style');
      style.id = 'novus-extra-kf';
      style.textContent = `
        @keyframes novus-fadeUp {
          to { opacity: 0; transform: translateY(-6px) scale(0.97); }
        }
      `;
      document.head.appendChild(style);
    }
  }

  /* ── 7. SPRING NUMBER COUNTER
     Animates numeric values on .metric-value and .summary-value
     when they first appear in the viewport.
  ─────────────────────────────────────────────────────── */
  function initCountUp() {
    if (!window.IntersectionObserver) return;

    const targets = document.querySelectorAll('.summary-value, .na-pill span');
    if (!targets.length) return;

    function parseNum(text) {
      const n = parseFloat((text || '').replace(/[^0-9.%-]/g, ''));
      return isNaN(n) ? null : n;
    }

    function easeOutExpo(t) { return t === 1 ? 1 : 1 - Math.pow(2, -10 * t); }

    function animateCount(el, target) {
      const suffix = (el.textContent || '').replace(/[\d.]/g, '');
      const isInt  = Number.isInteger(target);
      const start  = performance.now();
      const dur    = 700;

      function step(now) {
        const t   = Math.min((now - start) / dur, 1);
        const val = easeOutExpo(t) * target;
        el.textContent = (isInt ? Math.round(val) : val.toFixed(1)) + suffix;
        if (t < 1) requestAnimationFrame(step);
      }
      requestAnimationFrame(step);
    }

    const obs = new IntersectionObserver(entries => {
      entries.forEach(entry => {
        if (!entry.isIntersecting) return;
        const el  = entry.target;
        const num = parseNum(el.textContent);
        if (num !== null && num > 0) animateCount(el, num);
        obs.unobserve(el);
      });
    }, { threshold: 0.5 });

    targets.forEach(el => obs.observe(el));
  }

  /* ── 8. HEADER SCROLL SHADOW
     The glass header picks up a stronger shadow as user scrolls.
  ─────────────────────────────────────────────────────── */
  function initHeaderScroll() {
    const header = document.querySelector('.cmd-header, .hub-topbar');
    if (!header) return;

    let ticking = false;
    window.addEventListener('scroll', () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(() => {
        const y = window.scrollY;
        if (y > 10) {
          header.style.boxShadow = '0 2px 24px rgba(0,0,0,.10), 0 1px 4px rgba(0,0,0,.06)';
          header.style.background = 'rgba(255,255,255,0.92)';
        } else {
          header.style.boxShadow = '';
          header.style.background = '';
        }
        ticking = false;
      });
    }, { passive: true });
  }

  /* ── INIT ── */
  function init() {
    initTactilePress();
    initRipple();
    initScrollReveal();
    initInputFocus();
    initCardParallax();
    initDropdownDismiss();
    initCountUp();
    initHeaderScroll();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();