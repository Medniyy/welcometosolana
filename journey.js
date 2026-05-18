(function () {
  'use strict';

  /* When the user has requested reduced motion, skip ALL JS-driven reveal
     and animation logic entirely. CSS already sets durations to 0.01ms, but
     if JS also fires classList changes + stagger timers they fight each other
     and produce a rapid flicker on macOS/iOS. Just mark everything visible
     immediately and bail out before any IntersectionObserver is created. */
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    document.querySelectorAll(
      '.reveal, .learn-card, .proof-card, .cando-card, .community-card, ' +
      '.next-card, .app-card, .seg-header, .stepper-step'
    ).forEach(function (el) { el.classList.add('is-visible'); });
    return;
  }

  /* ===== Scroll reveal — typed, staggered, fast-scroll-aware =====
     Replaces the old fade-in-everything pass. Each element gets a reveal
     variant based on what it is (kicker / title / card / image), and grids
     stagger their children. Elements that are already 60%+ on-screen on
     first observation (e.g. someone deep-linked and the section is in view)
     skip the animation entirely. */

  /* Tag elements with reveal variant + child index for stagger.
     Done once on init so the IO callback can stay light. */
  function tagReveal(el, variant) {
    el.classList.add('reveal', 'reveal--' + variant);
  }

  /* Section headers: kicker slides in from left, title scales in, lead fades up.
     Tag each child of .seg-header individually so they can stagger. */
  document.querySelectorAll('.seg-header').forEach(function (header) {
    var kicker = header.querySelector('.seg-label');
    var title  = header.querySelector('.seg-title');
    var lead   = header.querySelector('.seg-lead');
    if (kicker) tagReveal(kicker, 'left');
    if (title)  { tagReveal(title, 'scale'); title.style.transitionDelay = '90ms'; }
    if (lead)   { tagReveal(lead,  'up');    lead.style.transitionDelay  = '180ms'; }
  });

  /* Hero parts — kicker, title, desc, actions, help, scroll cue. */
  var heroLeft = document.querySelector('.hero-left');
  if (heroLeft) {
    var heroKicker = heroLeft.querySelector('.hero-kicker');
    var heroTitle  = heroLeft.querySelector('.hero-title');
    var heroDesc   = heroLeft.querySelector('.hero-desc');
    var heroActions = heroLeft.querySelector('.hero-actions');
    var heroHelp   = heroLeft.querySelector('.hero-help');
    if (heroKicker)  { tagReveal(heroKicker, 'left'); }
    if (heroTitle)   { tagReveal(heroTitle, 'scale');  heroTitle.style.transitionDelay  = '120ms'; }
    if (heroDesc)    { tagReveal(heroDesc, 'up');      heroDesc.style.transitionDelay   = '220ms'; }
    if (heroActions) { tagReveal(heroActions, 'up');   heroActions.style.transitionDelay= '320ms'; }
    if (heroHelp)    { tagReveal(heroHelp, 'up');      heroHelp.style.transitionDelay   = '420ms'; }
  }
  /* Hero portrait: fade only (no translate — keeps it grounded). Scale-in handled by CSS keyframe. */
  var heroPortrait = document.querySelector('.hero-portrait-frame');
  if (heroPortrait) tagReveal(heroPortrait, 'fade');

  /* Grid cards — translateY + scale-in. Stagger across siblings. */
  function tagGridChildren(selector, variant) {
    document.querySelectorAll(selector).forEach(function (grid) {
      Array.prototype.slice.call(grid.children).forEach(function (child, i) {
        tagReveal(child, variant);
        child.style.transitionDelay = Math.min(i, 6) * 75 + 'ms';
      });
    });
  }
  tagGridChildren('.learn-grid',     'card');
  tagGridChildren('.proof-grid',     'card');
  tagGridChildren('.cando-grid',     'card');
  tagGridChildren('.next-grid',      'card');
  tagGridChildren('.community-grid', 'card');
  tagGridChildren('.apps-grid',      'card');

  /* Other one-off blocks */
  document.querySelectorAll('.trust, .watch-row, .wallet-hero, .checkpoint, .closing, .apps-more, .route-summary-card').forEach(function (el) {
    tagReveal(el, 'up');
  });
  /* Wallet alt list: stagger each item */
  document.querySelectorAll('.wallet-others .wallet-alt').forEach(function (el, i) {
    tagReveal(el, 'card');
    el.style.transitionDelay = (60 + i * 75) + 'ms';
  });

  /* Observer — apply is-visible, with fast-scroll skip:
     if element is already 60%+ in viewport when first observed, mark
     visible immediately without animation. */
  var revealEls = document.querySelectorAll('.reveal');
  var io = new IntersectionObserver(function (entries, obs) {
    entries.forEach(function (e) {
      if (!e.isIntersecting) return;
      if (e.intersectionRatio >= 0.6) {
        /* Already deeply on-screen — skip animation. */
        e.target.classList.add('is-visible', 'reveal-no-anim');
      } else {
        e.target.classList.add('is-visible');
      }
      obs.unobserve(e.target);
    });
  }, { threshold: [0.08, 0.6], rootMargin: '0px 0px -40px 0px' });
  revealEls.forEach(function (el) { io.observe(el); });

  /* ===== Stepper / progress rail =====
     Active state + single-shot pulse animation when the active step changes. */
  var stepperLinks = document.querySelectorAll('.stepper-list a[data-step]');
  var railFill = document.getElementById('rail-fill');
  var sections = document.querySelectorAll('section[data-step]');
  var total = sections.length;
  var currentStep = 0;

  function setStep(step) {
    if (step === currentStep) return;
    currentStep = step;
    stepperLinks.forEach(function (link) {
      var s = parseInt(link.dataset.step, 10);
      var wasActive = link.classList.contains('is-active');
      var nowActive = s === step;
      link.classList.toggle('is-active', nowActive);
      link.classList.toggle('is-done', s < step);
      /* Single-shot pulse: re-trigger keyframe by toggling the class. */
      if (nowActive && !wasActive) {
        link.classList.remove('step-pulse');
        // force reflow so the next add re-runs the animation
        void link.offsetWidth;
        link.classList.add('step-pulse');
      }
    });
    if (railFill) {
      var pct = step === 0 ? 0 : ((step - 0.5) / total) * 100;
      railFill.style.height = Math.max(0, Math.min(100, pct)) + '%';
    }
    document.body.setAttribute('data-step', String(step));
  }

  var so = new IntersectionObserver(function (entries) {
    entries.forEach(function (e) {
      if (e.isIntersecting) {
        var s = parseInt(e.target.dataset.step, 10);
        if (!isNaN(s)) setStep(s);
      }
    });
  }, { threshold: 0.25, rootMargin: '-80px 0px -45% 0px' });
  sections.forEach(function (s) { so.observe(s); });

  /* ===== Flip cards (generic) ===== */
  document.querySelectorAll('[data-flip]').forEach(function (card) {
    function flip(e) {
      // ignore clicks on real links inside the back side
      if (e && e.target && e.target.closest('a[href]:not(.cando-link):not(.community-cta)')) {
        // links handle themselves
      }
      card.classList.toggle('is-flipped');
    }
    card.addEventListener('click', function (e) {
      // Don't flip when the inner CTA link is clicked
      if (e.target.closest('a')) {
        // a has its own behavior — for community-cta and cando-link, allow nav
        return;
      }
      flip(e);
    });
    card.tabIndex = 0;
    card.setAttribute('role', 'button');
    card.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        flip(e);
      }
    });
  });

  /* ===== Route builder ===== */
  var state = {
    mode: 'bridge', // bridge | buy
    chain: 'evm',   // evm | cosmos | other
    method: 'dex'   // dex | cex (only for evm/cosmos)
  };

  function updateRoute() {
    // Toggle route panel
    document.querySelectorAll('[data-route-panel]').forEach(function (p) {
      p.classList.toggle('is-active', p.dataset.routePanel === state.mode);
    });

    // Determine the steps key
    var key;
    if (state.mode === 'buy') {
      key = 'buy';
    } else {
      if (state.chain === 'other') key = 'other';
      else key = state.chain + '-' + state.method;
    }

    // Toggle steps list
    document.querySelectorAll('.route-steps').forEach(function (ol) {
      ol.classList.toggle('is-active', ol.dataset.stepsFor === key);
    });

    // Show/hide method-host (no method tabs for "other" or "buy")
    var methodHost = document.querySelector('[data-method-host]');
    if (methodHost) {
      methodHost.style.display = (state.mode === 'bridge' && state.chain !== 'other') ? '' : 'none';
    }

    // Update summary panel
    updateSummary(key);
  }

  function updateSummary(key) {
    var flowFrom = document.getElementById('flow-from');
    var flowFromGlyph = document.getElementById('flow-from-glyph');
    var flowMethod = document.getElementById('flow-method');
    var routeTime = document.getElementById('route-time');
    var ctaLabel = document.getElementById('route-cta-label');
    var cta = document.getElementById('route-cta');
    var list = document.getElementById('route-summary-list');

    var labels = {
      'evm-dex': {
        from: 'Ethereum / EVM', glyph: '⬡', method: 'Squid · Permissionless', time: '~2 min',
        ctaText: 'Open Squid Router', ctaHref: 'https://app.squidrouter.com/',
        steps: [
          ['1', '<strong>Install Solflare</strong> — your Solana address'],
          ['2', '<strong>Open Squid</strong> · connect EVM wallet'],
          ['3', '<strong>Token → SOL</strong> · enter address · confirm'],
          ['4', '<strong>SOL arrives</strong> in Solflare']
        ]
      },
      'evm-cex': {
        from: 'Ethereum / EVM', glyph: '⬡', method: 'CEX · KYC required', time: '~15 min',
        ctaText: 'Open Coinbase', ctaHref: 'https://www.coinbase.com/',
        steps: [
          ['1', '<strong>Deposit</strong> ETH/USDC to a CEX'],
          ['2', '<strong>Swap to SOL</strong> on exchange'],
          ['3', '<strong>Install Solflare</strong>'],
          ['4', '<strong>Withdraw SOL</strong> · Solana network']
        ]
      },
      'cosmos-dex': {
        from: 'Cosmos / IBC', glyph: '◇', method: 'Squid + Noble · Permissionless', time: '~5 min',
        ctaText: 'Open Squid Router', ctaHref: 'https://app.squidrouter.com/',
        steps: [
          ['1', '<strong>Swap → USDC</strong> on Osmosis via Squid'],
          ['2', '<strong>Install Solflare</strong>'],
          ['3', '<strong>Bridge USDC</strong> Cosmos → Solana (Noble)']
        ]
      },
      'cosmos-cex': {
        from: 'Cosmos / IBC', glyph: '◇', method: 'CEX · KYC required', time: '~20 min',
        ctaText: 'Open Osmosis', ctaHref: 'https://osmosis.zone/',
        steps: [
          ['1', '<strong>Swap to ATOM</strong> on Osmosis'],
          ['2', '<strong>IBC back</strong> to Cosmos Hub'],
          ['3', '<strong>Deposit + swap</strong> for SOL on CEX'],
          ['4', '<strong>Install Solflare</strong> · withdraw SOL']
        ]
      },
      'other': {
        from: 'Other chain', glyph: '○', method: 'Best-effort route', time: 'Varies',
        ctaText: 'Ask in Telegram', ctaHref: 'https://t.me/+3prPanTSreIwMzMy',
        steps: [
          ['1', '<strong>Bridge</strong> to EVM if possible'],
          ['2', '<strong>Or use a CEX</strong> — deposit, swap, withdraw'],
          ['3', '<strong>Ask in Telegram</strong> if stuck']
        ]
      },
      'buy': {
        from: 'Fiat (card / bank)', glyph: '$', method: 'In-wallet purchase', time: '~5 min',
        ctaText: 'Download Solflare', ctaHref: 'https://www.solflare.com/download/',
        steps: [
          ['1', '<strong>Install Solflare</strong> — has Buy built in'],
          ['2', '<strong>Tap Buy</strong> · use card or bank transfer'],
          ['3', '<strong>SOL arrives</strong> — you\u2019re on Solana']
        ]
      }
    };

    var l = labels[key] || labels['evm-dex'];
    if (flowFrom) flowFrom.textContent = l.from;
    if (flowFromGlyph) flowFromGlyph.textContent = l.glyph;
    if (flowMethod) flowMethod.textContent = l.method;
    if (routeTime) routeTime.textContent = l.time;
    if (ctaLabel) ctaLabel.textContent = l.ctaText;
    if (cta) cta.dataset.ctaHref = l.ctaHref;
    if (cta) cta.dataset.ctaIframe = l.ctaIframe || '';
    if (list) {
      list.innerHTML = l.steps.map(function (s) {
        return '<div class="route-summary-item"><span class="route-summary-item-num">' + s[0] + '.</span><span>' + s[1] + '</span></div>';
      }).join('');
    }
  }

  // mode tabs
  document.querySelectorAll('[data-route-mode]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      document.querySelectorAll('[data-route-mode]').forEach(function (b) {
        b.classList.toggle('is-active', b === btn);
        b.setAttribute('aria-selected', b === btn);
      });
      state.mode = btn.dataset.routeMode;
      updateRoute();
    });
  });
  // chain pills
  document.querySelectorAll('[data-chain]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      document.querySelectorAll('[data-chain]').forEach(function (b) {
        b.classList.toggle('is-active', b === btn);
        b.setAttribute('aria-selected', b === btn);
      });
      state.chain = btn.dataset.chain;
      updateRoute();
    });
  });
  // method tabs
  document.querySelectorAll('[data-method]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      document.querySelectorAll('[data-method]').forEach(function (b) {
        b.classList.toggle('is-active', b === btn);
        b.setAttribute('aria-selected', b === btn);
      });
      state.method = btn.dataset.method;
      updateRoute();
    });
  });

  // route CTA: open external link in a new tab
  var routeCta = document.getElementById('route-cta');
  if (routeCta) {
    routeCta.addEventListener('click', function () {
      var href = routeCta.dataset.ctaHref;
      if (href) window.open(href, '_blank', 'noopener');
    });
  }

  updateRoute();

  /* ===== Scroll to top ===== */
  var topBtn = document.getElementById('scroll-top');
  if (topBtn) {
    window.addEventListener('scroll', function () {
      topBtn.classList.toggle('is-visible', window.scrollY > 800);
    }, { passive: true });
    topBtn.addEventListener('click', function () {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
  }

  /* ===== Make community cards keyboard-flippable with link click stopping flip ===== */
  // already handled above
})();
