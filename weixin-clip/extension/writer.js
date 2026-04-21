/* global WeixinClipIdb, WeixinClipCore */
(function () {
  var statusEl = document.getElementById('status');
  var startBtn = document.getElementById('startBtn');

  function setStatus(t) {
    statusEl.textContent = t;
  }

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

  async function closeSelfSoon(ms) {
    var w = await chrome.windows.getCurrent();
    setTimeout(function () {
      chrome.windows.remove(w.id).catch(function () {});
    }, ms || 800);
  }

  async function requestDirWriteIfSupported(dir, label) {
    if (!dir || typeof dir.requestPermission !== 'function') return;
    var perm = await dir.requestPermission({ mode: 'readwrite' });
    if (perm !== 'granted') {
      throw new Error(
        (label || '目录') + ' 读写权限未授予（请在本窗口权限提示中选「允许」）。'
      );
    }
  }

  async function runSaveAfterUserClick(payload) {
    try {
      var dir = await WeixinClipIdb.getRootDirHandle();
      if (!dir) {
        throw new Error('未绑定保存目录');
      }
      await requestDirWriteIfSupported(dir, '文章保存目录');

      var vault = await WeixinClipIdb.getVaultDirHandle();
      var imgRoot = await WeixinClipIdb.getImagesRootDirHandle();
      if (vault) {
        await requestDirWriteIfSupported(vault, 'Obsidian 库根');
      }
      if (imgRoot) {
        await requestDirWriteIfSupported(imgRoot, '图片保存目录');
      }

      setStatus('正在下载图片并写入 Markdown…');
      var imgCfg = await chrome.storage.local.get(['clipImageMode', 'clipImageRelPath']);
      var modeIn =
        typeof imgCfg.clipImageMode === 'string' ? imgCfg.clipImageMode : 'perArticle';
      var relIn =
        typeof imgCfg.clipImageRelPath === 'string' ? imgCfg.clipImageRelPath : '';
      var result = await WeixinClipCore.clipArticle(dir, payload, {
        clipImageMode: modeIn,
        clipImageRelPath: relIn,
        vaultDirHandle: vault || null,
        imageDirHandle: imgRoot || null,
      });
      await WeixinClipIdb.clearPendingClipPayload();

      var msg =
        '已保存 ' +
        result.mdPath +
        '（图片：' +
        result.imagesLocation +
        (result.sharedImages ? '，统一目录' : '，本篇目录') +
        (result.imageLinkKind ? '，链接:' + result.imageLinkKind : '') +
        '）' +
        (result.failedCount ? '；' + result.failedCount + ' 张图失败，见 frontmatter' : '');
      await recordClipResult({
        ok: true,
        message: msg,
        mdPath: result.mdPath,
        failedCount: result.failedCount,
        clipModeUsed: result.clipModeUsed,
        imageRelUsed: result.imageRelUsed,
        imagesLocation: result.imagesLocation,
        imageLinkKind: result.imageLinkKind,
      });
      await setClipBadge(true);
      await notifySafe('weixin-clip', msg);
      setStatus('完成。\n' + msg + '\n\n本窗口将自动关闭。');
      await closeSelfSoon(900);
    } catch (e) {
      var name = e && e.name;
      var text = (e && e.message) || String(e);
      if (name === 'NotAllowedError' || /not allowed|permission|denied/i.test(text)) {
        text =
          '写盘仍被拒绝：请到扩展「选项」重新绑定目录，再重试剪藏。详情：' + text;
      }
      await recordClipResult({ ok: false, message: text, errorName: name });
      await setClipBadge(false);
      await notifySafe('weixin-clip', '剪藏失败：' + text);
      setStatus('失败：\n' + text);
      console.error('weixin-clip writer', name || '(no name)', text, e);
      try {
        await WeixinClipIdb.clearPendingClipPayload();
      } catch (e2) {}
      startBtn.disabled = false;
      await closeSelfSoon(5000);
    }
  }

  (async function init() {
    try {
      var payload = await WeixinClipIdb.getPendingClipPayload();
      if (!payload) {
        setStatus('没有待处理的剪藏任务（可关闭此窗口）。');
        await closeSelfSoon(1200);
        return;
      }
      if (!payload.ok) {
        var errMsg = payload.error || '提取失败';
        await recordClipResult({ ok: false, message: errMsg });
        await setClipBadge(false);
        await notifySafe('weixin-clip', '剪藏失败：' + errMsg);
        setStatus(errMsg);
        await WeixinClipIdb.clearPendingClipPayload();
        await closeSelfSoon(2500);
        return;
      }

      var dir = await WeixinClipIdb.getRootDirHandle();
      if (!dir) {
        await recordClipResult({ ok: false, message: '未绑定保存目录' });
        await setClipBadge(false);
        setStatus('未绑定目录，请打开扩展选项选择文件夹。');
        await notifySafe('weixin-clip', '未绑定保存目录。');
        await WeixinClipIdb.clearPendingClipPayload();
        await closeSelfSoon(2500);
        return;
      }

      setStatus(
        '正文已取回。按 Chrome 规则：需要你在**本窗口**内再点一次按钮，\n' +
          '才会把文件写入你已选定的目录（从公众号右键到这里的链路不算「直接手势」）。\n\n' +
          '请点击「开始保存」。'
      );
      startBtn.hidden = false;
      startBtn.onclick = function () {
        startBtn.disabled = true;
        runSaveAfterUserClick(payload);
      };
    } catch (e) {
      var name = e && e.name;
      var text = (e && e.message) || String(e);
      await recordClipResult({ ok: false, message: text, errorName: name });
      await setClipBadge(false);
      await notifySafe('weixin-clip', '剪藏失败：' + text);
      setStatus('失败：\n' + text);
      console.error('weixin-clip writer init', name || '(no name)', text, e);
      try {
        await WeixinClipIdb.clearPendingClipPayload();
      } catch (e2) {}
      await closeSelfSoon(4000);
    }
  })();
})();
