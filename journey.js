(function () {
  'use strict';

  /* ===== Scroll reveal ===== */
  var revealEls = document.querySelectorAll('.seg-header, .learn-card, .proof-card, .cando-card, .next-card, .community-card, .app-card, .trust, .watch-row, .checkpoint, .wallet-hero, .wallet-alt');
  var ro = new IntersectionObserver(function (entries) {
    entries.forEach(function (e) {
      if (e.isIntersecting) {
        // stagger
        var siblings = e.target.parentElement ? Array.prototype.indexOf.call(e.target.parentElement.children, e.target) : 0;
        e.target.style.transitionDelay = Math.min(siblings, 6) * 60 + 'ms';
        e.target.classList.add('is-visible');
        ro.unobserve(e.target);
      }
    });
  }, { threshold: 0.08, rootMargin: '0px 0px -40px 0px' });
  revealEls.forEach(function (el) { ro.observe(el); });

  /* ===== Stepper / progress rail ===== */
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
      link.classList.toggle('is-active', s === step);
      link.classList.toggle('is-done', s < step);
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
