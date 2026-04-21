/**
 * HTML → Markdown 与写盘（须在 window / extension page 中运行，勿在 Service Worker 中调用）。
 * 依赖全局 TurndownService（vendor/turndown.js）。
 */
(function (global) {
  function simpleHash(str) {
    var h = 0;
    for (var i = 0; i < str.length; i++) {
      h = (Math.imul(31, h) + str.charCodeAt(i)) | 0;
    }
    return ('0000000' + (h >>> 0).toString(16)).slice(-8);
  }

  /**
   * 用于 .md / 图片前缀的文件名片段：尽量保留原标题（含中文），只去掉各系统文件名非法字符。
   */
  function sanitizeFileBaseForMd(title, pageUrl) {
    var raw = String(title || '').trim();
    if (!raw) {
      return 'weixin-' + simpleHash(String(pageUrl || '') + '\n');
    }
    raw = raw.normalize('NFKC');
    raw = raw.replace(/:/g, '：');
    raw = raw.replace(/[/\\?*|"<>]/g, '-');
    raw = raw.replace(/[\u0000-\u001F]/g, '');
    raw = raw.replace(/\s+/g, ' ').trim();
    raw = raw.replace(/^[.\s]+|[.\s]+$/g, '');
    if (!raw) {
      return 'weixin-' + simpleHash(String(pageUrl || '') + '\n' + title);
    }
    if (raw.length > 120) {
      raw = raw.slice(0, 120).trim();
    }
    raw = raw.replace(/[.\s]+$/g, '');
    if (!raw) {
      return 'weixin-' + simpleHash(String(pageUrl || '') + '\n' + title);
    }
    return raw;
  }

  function todayYmd() {
    var d = new Date();
    function p(n) {
      return String(n).padStart(2, '0');
    }
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
  }

  function yamlScalar(s) {
    return JSON.stringify(String(s == null ? '' : s));
  }

  /** 仅允许安全路径段，去掉 . / .. / 空段，统一斜杠。 */
  function normalizeRelPath(raw) {
    var t = String(raw == null ? '' : raw)
      .trim()
      .replace(/\\/g, '/')
      .replace(/\/+/g, '/')
      .replace(/^\/+|\/+$/g, '');
    if (!t || t === 'undefined' || t === 'null') return '';
    var parts = t.split('/').filter(function (p) {
      return p && p !== '.' && p !== '..';
    });
    return parts.join('/');
  }

  function normalizeClipMode(mode) {
    if (mode === 'relative' || mode === 'articleRoot' || mode === 'perArticle') {
      return mode;
    }
    return 'perArticle';
  }

  /**
   * 在 article 根下按相对路径逐段 getDirectoryHandle({ create: true })。
   */
  async function getOrCreateNestedDir(root, relPath) {
    var clean = normalizeRelPath(relPath);
    if (!clean) return root;
    var parts = clean.split('/');
    var cur = root;
    for (var i = 0; i < parts.length; i++) {
      cur = await cur.getDirectoryHandle(parts[i], { create: true });
    }
    return cur;
  }

  async function resolveUniqueBase(dirHandle, date, nameSeg) {
    for (var n = 0; ; n++) {
      var base = n === 0 ? date + '-' + nameSeg : date + '-' + nameSeg + '-' + n;
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

  async function fileExistsInDir(dir, name) {
    try {
      await dir.getFileHandle(name, { create: false });
      return true;
    } catch (e) {
      if (e && e.name === 'NotFoundError') return false;
      throw e;
    }
  }

  async function uniqueImageName(dir, prefix, ext, sharedPool) {
    if (!sharedPool) return prefix + ext;
    for (var n = 0; ; n++) {
      var candidate = n === 0 ? prefix + ext : prefix + '-' + n + ext;
      var exists = await fileExistsInDir(dir, candidate);
      if (!exists) return candidate;
    }
  }

  async function markdownRelFromArticleRoot(articleRoot, fileHandle) {
    if (!articleRoot || typeof articleRoot.resolve !== 'function') {
      return null;
    }
    var segments = await articleRoot.resolve(fileHandle);
    if (segments == null) {
      return null;
    }
    return './' + segments.join('/');
  }

  /** 从「含 md 的目录」到目标文件，用 vault 内路径段算相对链接（如 ../assets/x.png）。 */
  function relativeLinkFromDirToFile(fromDirSegs, toFileSegs) {
    var i = 0;
    var fl = fromDirSegs.length;
    var tl = toFileSegs.length;
    while (i < fl && i < tl && fromDirSegs[i] === toFileSegs[i]) {
      i++;
    }
    var ups = fl - i;
    var rest = toFileSegs.slice(i);
    var parts = [];
    for (var u = 0; u < ups; u++) {
      parts.push('..');
    }
    for (var r = 0; r < rest.length; r++) {
      parts.push(rest[r]);
    }
    if (!parts.length) return './';
    if (parts[0] === '..') return parts.join('/');
    return './' + parts.join('/');
  }

  async function markdownRelViaVault(vault, mdFileHandle, imageFileHandle) {
    if (!vault || typeof vault.resolve !== 'function') return null;
    var mdSeg = await vault.resolve(mdFileHandle);
    var imgSeg = await vault.resolve(imageFileHandle);
    if (mdSeg === null || imgSeg === null) return null;
    var fromDir = mdSeg.slice(0, -1);
    return relativeLinkFromDirToFile(fromDir, imgSeg);
  }

  /**
   * 决定图片写到哪里、Markdown 里用什么相对路径。
   * 优先级：① 库根+图片句柄（与文章解耦）② 仅图片句柄且在文章根下 ③ storage 相对路径 ④ 每篇 _assets
   */
  async function buildImageWriteContext(articleDir, base, opts) {
    var vault = opts.vaultDirHandle || null;
    var imageIDB = opts.imageDirHandle || null;
    var clipMode = normalizeClipMode(opts.clipImageMode);
    var relPath = normalizeRelPath(opts.clipImageRelPath);
    if (clipMode === 'relative' && !relPath) {
      clipMode = 'perArticle';
    }

    async function relFromArticle(_mdFh, fh) {
      return await markdownRelFromArticleRoot(articleDir, fh);
    }

    if (vault && imageIDB) {
      var arInVault = await vault.resolve(articleDir);
      var imInVault = await vault.resolve(imageIDB);
      if (arInVault !== null && imInVault !== null) {
        return {
          imagesDirHandle: imageIDB,
          sharedPool: true,
          imagesLabel: 'vault↦' + imInVault.join('/'),
          imageLinkKind: 'vault',
          fallbackNote: '',
          resolveLink: async function (mdFh, fh) {
            return await markdownRelViaVault(vault, mdFh, fh);
          },
        };
      }
      imageIDB = null;
    }

    if (imageIDB && !vault) {
      var underA = await articleDir.resolve(imageIDB);
      if (underA !== null) {
        return {
          imagesDirHandle: imageIDB,
          sharedPool: true,
          imagesLabel: underA.length ? underA.join('/') : '(文章子目录)',
          imageLinkKind: 'underArticle',
          fallbackNote: '',
          resolveLink: relFromArticle,
        };
      }
    }

    try {
      if (clipMode === 'relative' && relPath) {
        var nested = await getOrCreateNestedDir(articleDir, relPath);
        return {
          imagesDirHandle: nested,
          sharedPool: true,
          imagesLabel: relPath,
          imageLinkKind: 'nested',
          fallbackNote: '',
          resolveLink: relFromArticle,
        };
      }
      if (clipMode === 'articleRoot') {
        return {
          imagesDirHandle: articleDir,
          sharedPool: true,
          imagesLabel: '（与文章目录相同）',
          imageLinkKind: 'articleRoot',
          fallbackNote: '',
          resolveLink: relFromArticle,
        };
      }
    } catch (e) {
      var ih0 = await articleDir.getDirectoryHandle(base + '_assets', { create: true });
      return {
        imagesDirHandle: ih0,
        sharedPool: false,
        imagesLabel: base + '_assets/',
        imageLinkKind: 'perArticle',
        fallbackNote:
          '（图片目录回退：' + ((e && e.message) || String(e)).slice(0, 120) + '）',
        resolveLink: relFromArticle,
      };
    }

    var per = await articleDir.getDirectoryHandle(base + '_assets', { create: true });
    return {
      imagesDirHandle: per,
      sharedPool: false,
      imagesLabel: base + '_assets/',
      imageLinkKind: 'perArticle',
      fallbackNote: '',
      resolveLink: relFromArticle,
    };
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
      headers: { Referer: 'https://mp.weixin.qq.com/' },
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    var blob = await res.blob();
    return { blob: blob, mime: res.headers.get('content-type') || blob.type || '' };
  }

  function buildTurndown() {
    var td = new TurndownService({
      headingStyle: 'atx',
      codeBlockStyle: 'fenced',
      bulletListMarker: '-',
      emDelimiter: '_',
    });
    td.addRule('weixin-section', {
      filter: ['section'],
      replacement: function (content) {
        var t = content.trim();
        return t ? '\n\n' + t + '\n\n' : '';
      },
    });
    return td;
  }

  async function writeMarkdownFile(dirHandle, mdPath, fullText) {
    var mdHandle = await dirHandle.getFileHandle(mdPath, { create: true });
    var mw = await mdHandle.createWritable();
    await mw.write(fullText);
    await mw.close();
  }

  function buildFrontmatterLines(title, pageUrl, payload, date, failed) {
    var fmLines = ['---'];
    fmLines.push('title: ' + yamlScalar(title));
    fmLines.push('source: ' + yamlScalar(pageUrl));
    fmLines.push('author:');
    if (payload.author) {
      fmLines.push('  - "[[' + String(payload.author).replace(/]]/g, ']') + ']]"');
    }
    fmLines.push('published: ' + (payload.published ? yamlScalar(payload.published) : ''));
    fmLines.push('created: ' + date);
    fmLines.push('description: ' + yamlScalar(payload.description || ''));
    fmLines.push('tags:');
    fmLines.push('  - "参考文档"');
    if (failed.length) {
      fmLines.push('failed_assets:');
      for (var j = 0; j < failed.length; j++) {
        fmLines.push('  - url: ' + yamlScalar(failed[j].url));
        fmLines.push('    reason: ' + yamlScalar(failed[j].reason));
      }
    }
    fmLines.push('---', '');
    return fmLines;
  }

  /**
   * options:
   *   clipImageMode / clipImageRelPath: 未绑「库根」时，图片须在文章根下（storage 相对路径）
   *   vaultDirHandle: 可选，Obsidian 库根；与 imageDirHandle 同时存在且二者均在库根下时，文章与图片可完全解耦
   *   imageDirHandle: 可选 IndexedDB 图片根（解耦模式或文章子目录模式）
   */
  async function clipArticle(dirHandle, payload, options) {
    if (!payload.ok) {
      throw new Error(payload.error || '提取失败');
    }
    var opts = options || {};
    var clipMode = normalizeClipMode(opts.clipImageMode);
    var relPath = normalizeRelPath(opts.clipImageRelPath);
    if (clipMode === 'relative' && !relPath) {
      clipMode = 'perArticle';
    }

    var title = payload.title || 'weixin-article';
    var pageUrl = payload.pageUrl || '';
    var nameSeg = sanitizeFileBaseForMd(title, pageUrl);
    var date = todayYmd();
    var base = await resolveUniqueBase(dirHandle, date, nameSeg);
    var mdPath = base + '.md';

    var ctx = await buildImageWriteContext(dirHandle, base, opts);
    var imagesDirHandle = ctx.imagesDirHandle;
    var sharedPool = ctx.sharedPool;
    var imagesLabel = ctx.imagesLabel;
    var imageDirFallbackNote = ctx.fallbackNote || '';
    var imageLinkKind = ctx.imageLinkKind;

    var parser = new DOMParser();
    var doc = parser.parseFromString(payload.html, 'text/html');
    var root = doc.querySelector('#js_content') || (doc.body && doc.body.firstElementChild);
    if (!root) {
      throw new Error('无法解析正文 HTML');
    }

    /** 先转 Markdown（此时图片多为 https，不依赖本地下载） */
    var bodyMd = buildTurndown().turndown(root);
    bodyMd = bodyMd.replace(/\n{3,}/g, '\n\n').trim() + '\n';

    var failed = [];
    var fmDraft = buildFrontmatterLines(title, pageUrl, payload, date, []);
    if (imageDirFallbackNote) {
      fmDraft.splice(
        fmDraft.length - 2,
        0,
        'clip_image_note: ' + yamlScalar(imageDirFallbackNote.trim())
      );
    }
    await writeMarkdownFile(dirHandle, mdPath, fmDraft.join('\n') + bodyMd);

    var imgNodes = root.querySelectorAll('img');
    var seq = 0;
    var seen = Object.create(null);
    var bodyFixed = bodyMd;
    var mdFhForLinks = await dirHandle.getFileHandle(mdPath, { create: false });

    for (var i = 0; i < imgNodes.length; i++) {
      var img = imgNodes[i];
      var src = (img.getAttribute('src') || '').trim();
      if (!src || src.indexOf('data:') === 0) {
        continue;
      }
      if (seen[src]) {
        bodyFixed = splitJoinAll(bodyFixed, src, seen[src]);
        continue;
      }
      seen[src] = src;
      seq += 1;
      var prefix = sharedPool
        ? base + '-img-' + String(seq).padStart(4, '0')
        : 'img-' + String(seq).padStart(4, '0');
      try {
        var got = await fetchImageBlob(src);
        var ext = extFromMime(got.mime, src);
        var fileName = await uniqueImageName(imagesDirHandle, prefix, ext, sharedPool);
        var fh = await imagesDirHandle.getFileHandle(fileName, { create: true });
        var w = await fh.createWritable();
        await w.write(got.blob);
        await w.close();
        var rel = await ctx.resolveLink(mdFhForLinks, fh);
        if (!rel) {
          throw new Error('resolve 相对路径为 null（' + imageLinkKind + '）');
        }
        seen[src] = rel;
        bodyFixed = splitJoinAll(bodyFixed, src, rel);
      } catch (err) {
        failed.push({ url: src, reason: (err && err.message) || String(err) });
      }
    }

    var fmFinal = buildFrontmatterLines(title, pageUrl, payload, date, failed);
    if (imageDirFallbackNote) {
      fmFinal.splice(
        fmFinal.length - 2,
        0,
        'clip_image_note: ' + yamlScalar(imageDirFallbackNote.trim())
      );
    }
    await writeMarkdownFile(dirHandle, mdPath, fmFinal.join('\n') + bodyFixed);

    return {
      mdPath: mdPath,
      imagesLocation: imagesLabel,
      sharedImages: sharedPool,
      failedCount: failed.length,
      clipModeUsed: clipMode,
      imageRelUsed: relPath || '',
      imageLinkKind: imageLinkKind,
    };
  }

  function splitJoinAll(haystack, from, to) {
    if (!from || from === to) return haystack;
    return haystack.split(from).join(to);
  }

  global.WeixinClipCore = {
    clipArticle: clipArticle,
  };
})(typeof self !== 'undefined' ? self : this);
