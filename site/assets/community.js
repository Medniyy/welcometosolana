/* Community button.
 *
 * A standing invitation to say something — a feature you want, a question, or
 * just that it worked. It exists so the roadmap comes from people who use the
 * thing rather than from guesses, which means it has to be visible on every
 * page and not only where someone has already succeeded.
 *
 * Rendered here rather than sitting in each page's markup, for the same reason
 * as the terms gate: it belongs on all of them, and duplicated markup drifts.
 * Fails open — if anything in here throws, the site is unaffected.
 */

(function () {
  "use strict";

  var TELEGRAM = "https://t.me/+3prPanTSreIwMzMy";
  var DISMISS_KEY = "wts.community.dismissed.v1";

  function dismissed() {
    try { return !!window.localStorage.getItem(DISMISS_KEY); } catch (e) { return false; }
  }
  function remember() {
    try { window.localStorage.setItem(DISMISS_KEY, "1"); } catch (e) { /* private mode */ }
  }
  function track(n, d) {
    try { if (window._track) window._track(n, d || {}); } catch (e) { /* noop */ }
  }

  if (dismissed()) return;

  function build() {
    var wrap = document.createElement("div");
    wrap.className = "community";
    wrap.id = "community";
    wrap.innerHTML =
      '<a class="community-btn" href="' + TELEGRAM + '" target="_blank" rel="noopener"' +
        ' aria-label="Ask the community on Telegram">' +
        '<svg class="community-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">' +
          '<path fill="currentColor" d="M21.9 4.3 18.9 19c-.2 1-.8 1.2-1.7.8l-4.6-3.4-2.2 2.1c-.2.2-.5.5-1 .5l.3-4.7 8.6-7.8c.4-.3-.1-.5-.6-.2L6.1 13l-4.6-1.4c-1-.3-1-1 .2-1.5l18-6.9c.8-.3 1.5.2 1.2 1.1z"/>' +
        '</svg>' +
        '<span class="community-text">' +
          '<strong>Ask the community</strong>' +
          '<small>Ideas, questions, or just say it worked</small>' +
        '</span>' +
      '</a>' +
      '<button class="community-close" type="button" aria-label="Hide this">&times;</button>';
    return wrap;
  }

  function mount() {
    var el = build();
    document.body.appendChild(el);

    el.querySelector(".community-btn").addEventListener("click", function () {
      track("click_community", { from: window.location.pathname });
    });

    /* Dismissible on purpose. A permanent floating element that cannot be got
       rid of is the kind of thing people learn to resent, and someone who has
       closed it once has told us something. */
    el.querySelector(".community-close").addEventListener("click", function () {
      remember();
      track("community_dismissed", {});
      el.remove();
    });
  }

  try {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", mount);
    } else {
      mount();
    }
  } catch (e) { /* never block the site on this */ }
})();
