/* global WeixinClipIdb */
importScripts('idb-store.js');

/**
 * 注入到页面各 frame 执行（必须自包含，勿引用 SW 外层变量）。
 */
function injectedExtractPayload() {
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
      return document.title.replace(/\s*-\s*微信公众号$/, '').trim();
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

  function findArticleRoot() {
    return (
      document.querySelector('#js_content') ||
      document.querySelector('#js_article') ||
      document.querySelector('.rich_media_area_primary_inner') ||
      document.querySelector('#js_article_content')
    );
  }

  function normalizeArticleHtml() {
    var root = findArticleRoot();
    if (!root) {
      return {
        ok: false,
        error:
          '未找到正文容器（已尝试 #js_content / #js_article / .rich_media_area_primary_inner）。可能不是文章页、在特殊子 frame，或 DOM 已变更。',
      };
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

  return normalizeArticleHtml();
}

var MENU_CLIP = 'weixin-clip-save';
var MENU_REBIND = 'weixin-clip-rebind';

function notifySafe(title, message) {
  return new Promise(function (resolve) {
    try {
      chrome.notifications.create(
        {
          type: 'basic',
          iconUrl: chrome.runtime.getURL('icons/icon48.png'),
          title: title,
          message: (message || '').slice(0, 250),
          priority: 2,
        },
        function () {
          if (chrome.runtime.lastError) {
            console.warn('weixin-clip notify', chrome.runtime.lastError.message);
          }
          resolve();
        }
      );
    } catch (e) {
      console.warn('weixin-clip notify', e);
      resolve();
    }
  });
}

function recordClipResult(payload) {
  return chrome.storage.local.set({
    lastClipResult: Object.assign({ at: Date.now() }, payload),
  });
}

function setClipBadge(ok) {
  return Promise.all([
    chrome.action.setBadgeText({ text: ok ? 'OK' : '!' }),
    chrome.action.setBadgeBackgroundColor({ color: ok ? '#22863a' : '#cb2431' }),
  ]).catch(function (e) {
    console.warn('weixin-clip badge', e);
  });
}

async function extractArticlePayloadFromTab(tabId) {
  var results;
  try {
    results = await chrome.scripting.executeScript({
      target: { tabId: tabId, allFrames: true },
      func: injectedExtractPayload,
    });
  } catch (e) {
    var msg = (e && e.message) || String(e);
    throw new Error('无法注入页面脚本：' + msg);
  }
  if (!results || !results.length) {
    return { ok: false, error: '脚本注入未返回任何 frame 结果' };
  }
  var oks = results.filter(function (x) {
    return x && x.result && x.result.ok && x.result.html;
  });
  if (oks.length) {
    oks.sort(function (a, b) {
      return (b.result.html || '').length - (a.result.html || '').length;
    });
    return oks[0].result;
  }
  var errs = results.filter(function (x) {
    return x && x.result && x.result.ok === false;
  });
  if (errs.length) {
    return errs[0].result;
  }
  return { ok: false, error: '未拿到正文（各 frame 均无有效结果）' };
}

function openClipWriterWindow() {
  return chrome.windows.create({
    url: chrome.runtime.getURL('writer.html'),
    type: 'popup',
    width: 440,
    height: 200,
    focused: true,
  });
}

async function ensureMenus() {
  await chrome.contextMenus.removeAll();
  chrome.contextMenus.create({
    id: MENU_CLIP,
    title: '剪藏到 Obsidian',
    contexts: ['page', 'frame'],
    documentUrlPatterns: ['https://mp.weixin.qq.com/*'],
  });
  chrome.contextMenus.create({
    id: MENU_REBIND,
    title: '重新选择保存目录…',
    contexts: ['page', 'frame'],
    documentUrlPatterns: ['https://mp.weixin.qq.com/*'],
  });
}

chrome.runtime.onInstalled.addListener(ensureMenus);
chrome.runtime.onStartup.addListener(ensureMenus);

chrome.contextMenus.onClicked.addListener(function (info, tab) {
  if (!tab || !tab.id) {
    return Promise.resolve();
  }
  if (info.menuItemId === MENU_REBIND) {
    chrome.runtime.openOptionsPage();
    return Promise.resolve();
  }
  if (info.menuItemId !== MENU_CLIP) {
    return Promise.resolve();
  }

  return (async function () {
    try {
      var dir = await WeixinClipIdb.getRootDirHandle();
      if (!dir) {
        await recordClipResult({ ok: false, message: '未绑定保存目录' });
        await setClipBadge(false);
        chrome.runtime.openOptionsPage();
        await notifySafe('weixin-clip', '请先在扩展选项里选择保存目录（File System Access）。');
        return;
      }

      var payload = await extractArticlePayloadFromTab(tab.id);
      if (!payload.ok) {
        var errMsg = payload.error || '提取失败';
        await recordClipResult({ ok: false, message: errMsg });
        await setClipBadge(false);
        await notifySafe('weixin-clip', '剪藏失败：' + errMsg);
        return;
      }

      await WeixinClipIdb.setPendingClipPayload(payload);
      await openClipWriterWindow();
    } catch (e) {
      var text = (e && e.message) || String(e);
      var name = e && e.name;
      if (name === 'NotAllowedError' || /not allowed|permission|denied/i.test(text)) {
        text =
          '无写盘权限或目录授权已失效，请到扩展「选项」里重新点「选择目录…」。原始错误：' + text;
      }
      await recordClipResult({ ok: false, message: text, errorName: name });
      await setClipBadge(false);
      await notifySafe('weixin-clip', '剪藏失败：' + text);
      console.error('weixin-clip', e);
    }
  })();
});
