/* global WeixinClipIdb, TurndownService */
importScripts('idb-store.js', 'vendor/turndown.js');

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

async function ensureMenus() {
  await chrome.contextMenus.removeAll();
  chrome.contextMenus.create({
    id: MENU_CLIP,
    title: '剪藏到 Obsidian',
    contexts: ['page'],
    documentUrlPatterns: ['https://mp.weixin.qq.com/*'],
  });
  chrome.contextMenus.create({
    id: MENU_REBIND,
    title: '重新选择保存目录…',
    contexts: ['page'],
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
        notify('weixin-clip', '请先在扩展选项里选择保存目录（File System Access）。', true);
        return;
      }
      var payload = await chrome.tabs.sendMessage(tab.id, { type: 'WEIXIN_CLIP_EXTRACT' });
      var result = await clipArticle(dir, payload);
      var msg =
        '已保存 ' +
        result.mdPath +
        (result.failedCount ? '（' + result.failedCount + ' 张图失败，见 frontmatter）' : '');
      notify('weixin-clip', msg, false);
    } catch (e) {
      var text = (e && e.message) || String(e);
      notify('weixin-clip', '剪藏失败：' + text, true);
    }
  })();
});
