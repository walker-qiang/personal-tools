/**
 * Extract WeChat article body HTML for clipping (runs in page context).
 */
(function () {
  function pickTitle() {
    var og = document.querySelector('meta[property="og:title"]');
    if (og && og.getAttribute('content')) {
      return og.getAttribute('content').trim();
    }
    var act = document.querySelector('#activity-name');
    if (act && act.textContent) {
      return act.textContent.trim();
    }
    if (document.title) {
      return document.title.replace(/\s*-\s*微信公众号$/,'').trim();
    }
    return 'weixin-article';
  }

  function resolveImgUrl(raw) {
    if (!raw) return '';
    var t = raw.trim();
    if (!t || t.indexOf('data:') === 0) return '';
    try {
      return new URL(t, location.href).href;
    } catch (e) {
      return '';
    }
  }

  function normalizeArticleHtml() {
    var root = document.querySelector('#js_content');
    if (!root) {
      return { ok: false, error: '未找到正文容器 #js_content（可能不是文章页或 DOM 已变更）' };
    }
    var clone = root.cloneNode(true);
    var imgs = clone.querySelectorAll('img');
    for (var i = 0; i < imgs.length; i++) {
      var img = imgs[i];
      var raw =
        img.getAttribute('data-src') ||
        img.getAttribute('data-original') ||
        img.getAttribute('data-lazy-src') ||
        img.getAttribute('src');
      var abs = resolveImgUrl(raw);
      if (abs) {
        img.setAttribute('src', abs);
      }
      img.removeAttribute('data-src');
      img.removeAttribute('data-original');
      img.removeAttribute('data-lazy-src');
    }
    return {
      ok: true,
      title: pickTitle(),
      html: clone.outerHTML,
      pageUrl: location.href,
    };
  }

  chrome.runtime.onMessage.addListener(function (msg, _sender, sendResponse) {
    if (msg && msg.type === 'WEIXIN_CLIP_EXTRACT') {
      sendResponse(normalizeArticleHtml());
      return true;
    }
    return false;
  });
})();
