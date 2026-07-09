// Extracts main article text from the active page.
// Returns { title, text } via the message reply.

(function () {
  const STRIP =
    "script, style, noscript, nav, header, footer, aside, form, button, iframe, " +
    "[role=navigation], [aria-hidden=true], .nav, .menu, .sidebar, .ad, .advert, " +
    ".advertisement, .promo, .share, .social, .comments, .related";
  const BLOCKS = "article, main, [role=main], .post, .entry-content, .article-body";

  function pickBest(root) {
    const candidates = Array.from(root.querySelectorAll("div, section"));
    let best = null, bestScore = 0;
    for (const el of candidates) {
      const text = el.textContent || "";
      const pCount = el.querySelectorAll("p").length;
      const score = text.length + pCount * 80;
      if (score > bestScore) { bestScore = score; best = el; }
    }
    return best;
  }

  function extract() {
    const clone = document.body.cloneNode(true);
    clone.querySelectorAll(STRIP).forEach((n) => n.remove());
    let container = clone.querySelector(BLOCKS) || pickBest(clone) || clone;
    const paragraphs = [];
    container.querySelectorAll("p, li, h2, h3").forEach((el) => {
      const t = (el.textContent || "").trim();
      if (t.length > 30) paragraphs.push(t);
    });
    const title =
      document.querySelector("h1")?.textContent?.trim() ||
      document.title?.trim() || "";
    return { title, text: paragraphs.join("\n\n"), url: location.href };
  }

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg && msg.type === "QF_EXTRACT") {
      try {
        sendResponse({ ok: true, data: extract() });
      } catch (e) {
        sendResponse({ ok: false, error: String(e) });
      }
      return true;
    }
  });
})();
