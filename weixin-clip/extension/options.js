(function () {
  var statusEl = document.getElementById('status');
  var lastClipEl = document.getElementById('last-clip');
  var pickBtn = document.getElementById('pick');
  var clearBtn = document.getElementById('clear');

  function setStatus(text) {
    statusEl.textContent = text;
  }

  async function refreshLastClip() {
    if (!lastClipEl) return;
    try {
      var data = await chrome.storage.local.get('lastClipResult');
      var r = data.lastClipResult;
      if (!r) {
        lastClipEl.textContent = '尚无记录。剪藏一次后这里会显示结果与时间。';
        return;
      }
      var lines = [
        '时间: ' + new Date(r.at).toLocaleString(),
        '结果: ' + (r.ok ? '成功' : '失败'),
        '说明: ' + (r.message || '(无)'),
      ];
      if (r.mdPath) lines.push('文件: ' + r.mdPath);
      if (typeof r.failedCount === 'number') lines.push('失败图片数: ' + r.failedCount);
      if (r.errorName) lines.push('错误类型: ' + r.errorName);
      lastClipEl.textContent = lines.join('\n');
    } catch (e) {
      lastClipEl.textContent = '读取剪藏记录失败：' + ((e && e.message) || String(e));
    }
  }

  async function refreshStatus() {
    try {
      var h = await WeixinClipIdb.getRootDirHandle();
      if (h && h.name) {
        setStatus('当前已绑定目录名：「' + h.name + '」\n（Chrome 不暴露完整磁盘路径）');
      } else {
        setStatus('尚未绑定目录。请点击「选择目录…」。');
      }
    } catch (e) {
      setStatus('读取状态失败：' + ((e && e.message) || String(e)));
    }
  }

  pickBtn.addEventListener('click', async function () {
    try {
      if (!window.showDirectoryPicker) {
        setStatus('当前浏览器不支持 showDirectoryPicker（请使用桌面版 Chrome）。');
        return;
      }
      var dir = await window.showDirectoryPicker();
      await WeixinClipIdb.setRootDirHandle(dir);
      setStatus('已绑定：「' + dir.name + '」。可在公众号文章页右键「剪藏到 Obsidian」。');
      try {
        await chrome.storage.local.set({ lastDirName: dir.name });
      } catch (e2) {}
    } catch (e) {
      if (e && e.name === 'AbortError') {
        setStatus('已取消选择。');
        return;
      }
      setStatus('绑定失败：' + ((e && e.message) || String(e)));
    }
  });

  clearBtn.addEventListener('click', async function () {
    try {
      await WeixinClipIdb.clearRootDirHandle();
      await chrome.storage.local.remove('lastDirName');
      setStatus('已清除绑定。下次剪藏前请重新选择目录。');
    } catch (e) {
      setStatus('清除失败：' + ((e && e.message) || String(e)));
    }
  });

  chrome.storage.onChanged.addListener(function (changes, area) {
    if (area === 'local' && changes.lastClipResult) {
      refreshLastClip();
    }
  });

  refreshStatus();
  refreshLastClip();
})();
