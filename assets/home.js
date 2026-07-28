(function () {
  "use strict";

  var tabs = Array.prototype.slice.call(document.querySelectorAll("[data-provider]"));
  var panels = Array.prototype.slice.call(document.querySelectorAll(".provider-panel"));
  var providerContext = document.getElementById("provider-context");
  var providerExternal = document.getElementById("provider-external");
  var loaded = {};

  var providers = {
    squid: {
      context: "Squid · embedded router",
      href: "https://app.squidrouter.com/"
    },
    near: {
      context: "NEAR Intents · embedded swap",
      href: "https://near.com/"
    }
  };

  function loadPanel(panel) {
    if (!panel || loaded[panel.id]) return;
    var frame = panel.querySelector("iframe[data-src]");
    if (frame) frame.src = frame.dataset.src;
    loaded[panel.id] = true;
  }

  function selectProvider(name, moveFocus) {
    var activeTab = document.querySelector('[data-provider="' + name + '"]');
    var activePanel = document.getElementById("provider-" + name);
    if (!activeTab || !activePanel || !providers[name]) return;

    tabs.forEach(function (tab) {
      var selected = tab === activeTab;
      tab.classList.toggle("is-active", selected);
      tab.setAttribute("aria-selected", selected ? "true" : "false");
      tab.tabIndex = selected ? 0 : -1;
    });

    panels.forEach(function (panel) {
      var selected = panel === activePanel;
      panel.classList.toggle("is-active", selected);
      panel.hidden = !selected;
    });

    providerContext.textContent = providers[name].context;
    providerExternal.href = providers[name].href;
    loadPanel(activePanel);
    window._track("migration_provider_select", { provider: name });
    if (moveFocus) activeTab.focus();
  }

  tabs.forEach(function (tab, index) {
    tab.addEventListener("click", function () {
      selectProvider(tab.dataset.provider, false);
    });
    tab.addEventListener("keydown", function (event) {
      if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;
      event.preventDefault();
      var direction = event.key === "ArrowRight" ? 1 : -1;
      var next = tabs[(index + direction + tabs.length) % tabs.length];
      selectProvider(next.dataset.provider, true);
    });
  });

  document.querySelectorAll("[data-wallet]").forEach(function (link) {
    link.addEventListener("click", function () {
      window._track("wallet_select", { wallet: link.dataset.wallet });
    });
  });

  document.querySelectorAll("[data-track]").forEach(function (link) {
    link.addEventListener("click", function () {
      window._track(link.dataset.track);
    });
  });

  var credits = document.getElementById("creators");
  if (credits && window.location.hash === "#creators") {
    credits.open = true;
    window.requestAnimationFrame(function () {
      credits.scrollIntoView({ block: "start" });
    });
  }

  var summerSong = document.querySelector("[data-summer-song]");
  if (summerSong) {
    summerSong.addEventListener("play", function trackSummerSongPlay() {
      window._track("play_solana_summer_song");
      summerSong.removeEventListener("play", trackSummerSongPlay);
    });
  }

  var revealItems = document.querySelectorAll(".reveal");
  if ("IntersectionObserver" in window) {
    var observer = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        entry.target.classList.add("is-visible");
        observer.unobserve(entry.target);
      });
    }, { threshold: 0.12 });
    revealItems.forEach(function (item) { observer.observe(item); });
  } else {
    revealItems.forEach(function (item) { item.classList.add("is-visible"); });
  }

  if (window.location.hash === "#near") {
    selectProvider("near", false);
  } else {
    loadPanel(document.getElementById("provider-squid"));
  }
})();
