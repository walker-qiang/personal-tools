/* global WeixinClipIdb, TurndownService */
importScripts('idb-store.js', 'vendor/turndown.js');

/**
 * 注入到页面各 frame 执行（必须自包含，勿引用 SW 外层变量）。
 * 与已移除的 content.js 逻辑保持一致；变更时请同步两处注释。
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

function notify(title, message) {
  chrome.notifications.create({
    type: 'basic',
    iconUrl: chrome.runtime.getURL('icons/icon48.png'),
    title: title,
    message: (message || '').slice(0, 250),
    priority: 2,
  });
}

function simpleHash(str) {
  var h = 0;
  for (var i = 0; i < str.length; i++) {
    h = (Math.imul(31, h) + str.charCodeAt(i)) | 0;
  }
  return ('0000000' + (h >>> 0).toString(16)).slice(-8);
}

function slugFromTitle(title, pageUrl) {
  var ascii = title
    .normalize('NFKD')
    .replace(/[^\x00-\x7F]/g, '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  if (ascii.length >= 3) {
    return ascii.slice(0, 60);
  }
  return 'weixin-' + simpleHash(pageUrl + '\n' + title);
}

function todayYmd() {
  var d = new Date();
  function p(n) {
    return String(n).padStart(2, '0');
  }
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
}

function localIsoTimestamp() {
  var d = new Date();
  function p(n) {
    return String(n).padStart(2, '0');
  }
  return (
    d.getFullYear() +
    '-' +
    p(d.getMonth() + 1) +
    '-' +
    p(d.getDate()) +
    'T' +
    p(d.getHours()) +
    ':' +
    p(d.getMinutes()) +
    ':' +
    p(d.getSeconds())
  );
}

function yamlScalar(s) {
  return JSON.stringify(String(s == null ? '' : s));
}

async function resolveUniqueBase(dirHandle, date, slug) {
  for (var n = 0; ; n++) {
    var base = n === 0 ? date + '-' + slug : date + '-' + slug + '-' + n;
    try {
      await dirHandle.getFileHandle(base + '.md', { create: false });
    } catch (e) {
      if (e && e.name === 'NotFoundError') {
        return base;
      }
      throw e;
    }
  }
}

function extFromMime(mime, url) {
  if (mime && mime.indexOf('image/jpeg') !== -1) return '.jpg';
  if (mime && mime.indexOf('image/png') !== -1) return '.png';
  if (mime && mime.indexOf('image/gif') !== -1) return '.gif';
  if (mime && mime.indexOf('image/webp') !== -1) return '.webp';
  if (mime && mime.indexOf('image/svg') !== -1) return '.svg';
  try {
    var u = new URL(url);
    var m = u.pathname.match(/\.(jpe?g|png|gif|webp|svg)$/i);
    if (m) return '.' + m[1].toLowerCase().replace('jpeg', 'jpg');
  } catch (e) {}
  return '.bin';
}

async function fetchImageBlob(url) {
  var res = await fetch(url, {
    method: 'GET',
    credentials: 'omit',
    headers: {
      Referer: 'https://mp.weixin.qq.com/',
    },
  });
  if (!res.ok) {
    throw new Error('HTTP ' + res.status);
  }
  var blob = await res.blob();
  return { blob: blob, mime: res.headers.get('content-type') || blob.type || '' };
}

async function clipArticle(dirHandle, payload) {
  if (!payload.ok) {
    throw new Error(payload.error || '提取失败');
  }
  var title = payload.title || 'weixin-article';
  var pageUrl = payload.pageUrl || '';
  var slug = slugFromTitle(title, pageUrl);
  var date = todayYmd();
  var base = await resolveUniqueBase(dirHandle, date, slug);
  var assetsFolderName = base + '_assets';
  var assetsDir = await dirHandle.getDirectoryHandle(assetsFolderName, { create: true });

  var parser = new DOMParser();
  var doc = parser.parseFromString(payload.html, 'text/html');
  var root = doc.querySelector('#js_content') || (doc.body && doc.body.firstElementChild);
  if (!root) {
    throw new Error('无法解析正文 HTML');
  }

  var failed = [];
  var seen = Object.create(null);
  var imgNodes = root.querySelectorAll('img');
  var seq = 0;

  for (var i = 0; i < imgNodes.length; i++) {
    var img = imgNodes[i];
    var src = (img.getAttribute('src') || '').trim();
    if (!src || src.indexOf('data:') === 0) continue;
    if (seen[src]) {
      img.setAttribute('src', seen[src]);
      continue;
    }
    seen[src] = src;
    seq += 1;
    var localName = 'img-' + String(seq).padStart(4, '0');
    try {
      var got = await fetchImageBlob(src);
      var ext = extFromMime(got.mime, src);
      var fileName = localName + ext;
      var fh = await assetsDir.getFileHandle(fileName, { create: true });
      var w = await fh.createWritable();
      await w.write(got.blob);
      await w.close();
      var rel = './' + assetsFolderName + '/' + fileName;
      seen[src] = rel;
      img.setAttribute('src', rel);
    } catch (err) {
      failed.push({ url: src, reason: (err && err.message) || String(err) });
    }
  }

  var td = new TurndownService({
    headingStyle: 'atx',
    codeBlockStyle: 'fenced',
  });
  var bodyMd = td.turndown(root);

  var fm = [
    '---',
    'title: ' + yamlScalar(title),
    'source_url: ' + yamlScalar(pageUrl),
    'clipped_at: ' + yamlScalar(localIsoTimestamp()),
    'clipper: weixin-clip',
  ];
  if (failed.length) {
    fm.push('failed_assets:');
    for (var j = 0; j < failed.length; j++) {
      fm.push('  - url: ' + yamlScalar(failed[j].url));
      fm.push('    reason: ' + yamlScalar(failed[j].reason));
    }
  }
  fm.push('---', '');

  var mdPath = base + '.md';
  var mdHandle = await dirHandle.getFileHandle(mdPath, { create: true });
  var mw = await mdHandle.createWritable();
  await mw.write(fm.join('\n') + bodyMd + '\n');
  await mw.close();

  return { mdPath: mdPath, assetsFolder: assetsFolderName, failedCount: failed.length };
}

/**
 * 用 scripting 注入到所有 frame 并直接取返回值，避免「Receiving end does not exist」
 * 以及正文落在子 frame 时 sendMessage 只打到主 frame 的问题。
 */
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
  if (!tab || !tab.id) return;
  if (info.menuItemId === MENU_REBIND) {
    chrome.runtime.openOptionsPage();
    return;
  }
  if (info.menuItemId !== MENU_CLIP) return;

  (async function () {
    try {
      var dir = await WeixinClipIdb.getRootDirHandle();
      if (!dir) {
        chrome.runtime.openOptionsPage();
        notify('weixin-clip', '请先在扩展选项里选择保存目录（File System Access）。');
        return;
      }
      var payload = await extractArticlePayloadFromTab(tab.id);
      var result = await clipArticle(dir, payload);
      var msg =
        '已保存 ' +
        result.mdPath +
        (result.failedCount ? '（' + result.failedCount + ' 张图失败，见 frontmatter）' : '');
      notify('weixin-clip', msg);
    } catch (e) {
      var text = (e && e.message) || String(e);
      var name = e && e.name;
      if (name === 'NotAllowedError' || /not allowed|permission|denied/i.test(text)) {
        text =
          '无写盘权限或目录授权已失效，请到扩展「选项」里重新点「选择目录…」。原始错误：' + text;
      }
      notify('weixin-clip', '剪藏失败：' + text);
      console.error('weixin-clip', e);
    }
  })();
});
