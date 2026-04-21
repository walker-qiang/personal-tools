/* global WeixinClipIdb, WeixinClipCore */
(function () {
  var statusEl = document.getElementById('status');

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

  (async function () {
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

      if (typeof dir.requestPermission === 'function') {
        var perm = await dir.requestPermission({ mode: 'readwrite' });
        if (perm !== 'granted') {
          throw new Error('目录读写权限未授予（请在提示中允许，或到扩展选项重新选择目录）。');
        }
      }

      setStatus('正在下载图片并写入 Markdown…');
      var result = await WeixinClipCore.clipArticle(dir, payload);
      await WeixinClipIdb.clearPendingClipPayload();

      var msg =
        '已保存 ' +
        result.mdPath +
        (result.failedCount ? '（' + result.failedCount + ' 张图失败，见 frontmatter）' : '');
      await recordClipResult({
        ok: true,
        message: msg,
        mdPath: result.mdPath,
        failedCount: result.failedCount,
      });
      await setClipBadge(true);
      await notifySafe('weixin-clip', msg);
      setStatus('完成。\n' + msg + '\n\n本窗口将自动关闭。');
      await closeSelfSoon(900);
    } catch (e) {
      var text = (e && e.message) || String(e);
      var name = e && e.name;
      if (name === 'NotAllowedError' || /not allowed|permission|denied/i.test(text)) {
        text =
          '无写盘权限或目录授权失效，请到扩展「选项」重新选择目录。详情：' + text;
      }
      await recordClipResult({ ok: false, message: text, errorName: name });
      await setClipBadge(false);
      await notifySafe('weixin-clip', '剪藏失败：' + text);
      setStatus('失败：\n' + text);
      console.error('weixin-clip writer', e);
      try {
        await WeixinClipIdb.clearPendingClipPayload();
      } catch (e2) {}
      await closeSelfSoon(4000);
    }
  })();
})();
