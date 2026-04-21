(function () {
  var statusEl = document.getElementById('status');
  var lastClipEl = document.getElementById('last-clip');
  var pickBtn = document.getElementById('pick');
  var clearBtn = document.getElementById('clear');
  var pickVaultBtn = document.getElementById('pickVault');
  var clearVaultBtn = document.getElementById('clearVault');
  var vaultStatusEl = document.getElementById('vaultStatus');

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
      if (r.imageLinkKind) lines.push('图片链接模式: ' + r.imageLinkKind);
      if (r.clipModeUsed) lines.push('storage 图片模式: ' + r.clipModeUsed + (r.imageRelUsed ? ' @ ' + r.imageRelUsed : ''));
      if (r.imagesLocation) lines.push('图片位置: ' + r.imagesLocation);
      if (r.errorName) lines.push('错误类型: ' + r.errorName);
      lastClipEl.textContent = lines.join('\n');
    } catch (e) {
      lastClipEl.textContent = '读取剪藏记录失败：' + ((e && e.message) || String(e));
    }
  }

  async function verifyImageRelUnderArticle(article, relPath) {
    var clean = String(relPath || '').trim().replace(/^\/+|\/+$/g, '');
    if (!clean) return true;
    var parts = clean.split('/').filter(Boolean);
    var cur = article;
    for (var i = 0; i < parts.length; i++) {
      try {
        cur = await cur.getDirectoryHandle(parts[i], { create: false });
      } catch (e) {
        return false;
      }
    }
    return true;
  }

  async function refreshVaultStatus() {
    if (!vaultStatusEl) return;
    try {
      var v = await WeixinClipIdb.getVaultDirHandle();
      if (v && v.name) {
        vaultStatusEl.textContent =
          '已绑定库根：「' + v.name + '」\n文章目录、图片目录均须位于此库根之下，扩展才能算出 ../ 相对链接。';
      } else {
        vaultStatusEl.textContent =
          '未绑定库根。若希望「文章保存目录」与「图片目录」互不包含（解耦），请先绑定 Obsidian 库根。';
      }
    } catch (e) {
      vaultStatusEl.textContent = '读取库根状态失败：' + ((e && e.message) || String(e));
    }
  }

  async function refreshStatus() {
    try {
      var h = await WeixinClipIdb.getRootDirHandle();
      if (h && h.name) {
        setStatus('当前已绑定文章目录名：「' + h.name + '」\n（Chrome 不暴露完整磁盘路径）');
      } else {
        setStatus('尚未绑定文章目录。请点击「选择文章目录…」。');
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
      var msg = '已绑定文章目录：「' + dir.name + '」。可在公众号文章页右键「剪藏到 Obsidian」。';
      try {
        var v = await WeixinClipIdb.getVaultDirHandle();
        if (v) {
          var okv = await v.resolve(dir);
          if (okv === null) {
            await WeixinClipIdb.clearVaultDirHandle();
            await WeixinClipIdb.clearImagesRootDirHandle();
            await chrome.storage.local.remove(['clipImageMode', 'clipImageRelPath']);
            msg +=
              '\n\n新文章目录不在已绑定的「库根」之下，已清除库根与单独图片目录；若要解耦请重新绑定库根与图片。';
          }
        }
        var cfg = await chrome.storage.local.get(['clipImageMode', 'clipImageRelPath']);
        if (cfg.clipImageMode === 'relative' && cfg.clipImageRelPath) {
          var ok = await verifyImageRelUnderArticle(dir, String(cfg.clipImageRelPath).trim());
          if (!ok) {
            await chrome.storage.local.remove(['clipImageMode', 'clipImageRelPath']);
            msg += '\n\n原「统一图片相对路径」在新文章根下不存在，已清除。';
          }
        }
      } catch (e3) {}
      setStatus(msg);
      try {
        await chrome.storage.local.set({ lastDirName: dir.name });
      } catch (e2) {}
      refreshImageDirStatus();
      refreshVaultStatus();
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
      try {
        await WeixinClipIdb.clearImagesRootDirHandle();
      } catch (e0) {}
      await chrome.storage.local.remove(['lastDirName', 'clipImageMode', 'clipImageRelPath']);
      setStatus('已清除文章目录与图片相关设置（库根未清除）。');
      refreshImageDirStatus();
      refreshVaultStatus();
    } catch (e) {
      setStatus('清除失败：' + ((e && e.message) || String(e)));
    }
  });

  if (pickVaultBtn) {
    pickVaultBtn.addEventListener('click', async function () {
      try {
        if (!window.showDirectoryPicker) {
          if (vaultStatusEl) vaultStatusEl.textContent = '当前浏览器不支持 showDirectoryPicker。';
          return;
        }
        var art = await WeixinClipIdb.getRootDirHandle();
        if (!art) {
          if (vaultStatusEl) {
            vaultStatusEl.textContent =
              '请先绑定「文章保存目录」，再绑定库根（用于校验文章是否在库内）。';
          }
          return;
        }
        var vault = await window.showDirectoryPicker();
        var seg = await vault.resolve(art);
        if (seg === null) {
          if (vaultStatusEl) {
            vaultStatusEl.textContent =
              '所选文件夹不是当前「文章保存目录」的祖先：请选 Obsidian 库根（例如包含 raw/ 或整个 vault 的根）。';
          }
          return;
        }
        await WeixinClipIdb.setVaultDirHandle(vault);
        if (vaultStatusEl) {
          vaultStatusEl.textContent =
            '已绑定库根：「' + vault.name + '」（文章在库内相对：' + seg.join('/') + '）';
        }
        refreshImageDirStatus();
      } catch (e) {
        if (e && e.name === 'AbortError') {
          if (vaultStatusEl) vaultStatusEl.textContent = '已取消。';
          return;
        }
        if (vaultStatusEl) {
          vaultStatusEl.textContent = '绑定失败：' + ((e && e.message) || String(e));
        }
      }
    });
  }

  if (clearVaultBtn) {
    clearVaultBtn.addEventListener('click', async function () {
      try {
        await WeixinClipIdb.clearVaultDirHandle();
        await WeixinClipIdb.clearImagesRootDirHandle();
        await chrome.storage.local.remove(['clipImageMode', 'clipImageRelPath']);
        if (vaultStatusEl) {
          vaultStatusEl.textContent = '已清除库根与单独图片目录（storage 相对路径一并清除）。';
        }
        refreshImageDirStatus();
        refreshVaultStatus();
      } catch (e) {
        if (vaultStatusEl) {
          vaultStatusEl.textContent = '清除失败：' + ((e && e.message) || String(e));
        }
      }
    });
  }

  var pickImagesBtn = document.getElementById('pickImages');
  var clearImagesBtn = document.getElementById('clearImages');
  var imageDirStatusEl = document.getElementById('imageDirStatus');

  function setImageDirStatus(t) {
    if (imageDirStatusEl) imageDirStatusEl.textContent = t;
  }

  async function refreshImageDirStatus() {
    if (!imageDirStatusEl) return;
    try {
      var vault = await WeixinClipIdb.getVaultDirHandle();
      var img = await WeixinClipIdb.getImagesRootDirHandle();
      var art = await WeixinClipIdb.getRootDirHandle();
      if (img && vault && art) {
        var imSeg = await vault.resolve(img);
        if (imSeg !== null) {
          setImageDirStatus(
            '单独图片目录（相对库根）：' +
              imSeg.join('/') +
              '\n解耦模式：图片可与文章不在同一条文件夹链上。'
          );
          return;
        }
      }
      if (img && art && !vault) {
        var u = await art.resolve(img);
        if (u !== null) {
          setImageDirStatus(
            '单独图片目录（相对文章根）：' + (u.length ? u.join('/') : '与文章同目录') +
              '\n未绑库根时，图片必须在文章目录之下。'
          );
          return;
        }
      }
      var data = await chrome.storage.local.get(['clipImageMode', 'clipImageRelPath']);
      var mode = data.clipImageMode;
      if (!mode || mode === 'perArticle') {
        setImageDirStatus('未配置统一图片（每篇 <base>_assets/）；或未单独绑定图片目录。');
        return;
      }
      if (mode === 'articleRoot') {
        setImageDirStatus('当前（无单独句柄）：图片与 .md 同文章目录。');
        return;
      }
      if (mode === 'relative' && data.clipImageRelPath) {
        setImageDirStatus('当前（无单独句柄）：统一图片相对文章根 → ' + data.clipImageRelPath);
        return;
      }
      setImageDirStatus('图片配置不完整，可「清除图片目录」后重选。');
    } catch (e) {
      setImageDirStatus('读取图片设置失败：' + ((e && e.message) || String(e)));
    }
  }

  if (pickImagesBtn) {
    pickImagesBtn.addEventListener('click', async function () {
      try {
        if (!window.showDirectoryPicker) {
          setImageDirStatus('当前浏览器不支持 showDirectoryPicker。');
          return;
        }
        var article = await WeixinClipIdb.getRootDirHandle();
        if (!article) {
          setImageDirStatus('请先绑定「文章保存目录」。');
          return;
        }
        var vault = await WeixinClipIdb.getVaultDirHandle();
        var picked;
        var seg;
        if (vault) {
          picked = await window.showDirectoryPicker({ startIn: vault });
          seg = await vault.resolve(picked);
          if (seg === null) {
            setImageDirStatus('所选目录不在「库根」之内。请从弹窗进入库内再选（可与文章目录为兄弟）。');
            return;
          }
          await WeixinClipIdb.setImagesRootDirHandle(picked);
          await chrome.storage.local.remove(['clipImageMode', 'clipImageRelPath']);
          setImageDirStatus('已绑定单独图片目录（相对库根）：' + seg.join('/'));
        } else {
          picked = await window.showDirectoryPicker({ startIn: article });
          seg = await article.resolve(picked);
          if (seg === null) {
            setImageDirStatus(
              '未绑库根时：所选目录须在文章保存目录之内。若要与文章解耦，请先绑定「Obsidian 库根」。'
            );
            return;
          }
          try {
            await WeixinClipIdb.clearImagesRootDirHandle();
          } catch (e0) {}
          if (seg.length === 0) {
            await chrome.storage.local.set({ clipImageMode: 'articleRoot', clipImageRelPath: '' });
            setImageDirStatus('已设置：图片与文章保存在同一文件夹（相对文章根）。');
          } else {
            var rel = seg
              .filter(function (p) {
                return p && p !== '.' && p !== '..';
              })
              .join('/');
            await chrome.storage.local.set({
              clipImageMode: 'relative',
              clipImageRelPath: rel,
            });
            setImageDirStatus('已设置统一图片目录（相对文章根）：' + rel);
          }
        }
      } catch (e) {
        if (e && e.name === 'AbortError') {
          setImageDirStatus('已取消选择。');
          return;
        }
        setImageDirStatus('绑定失败：' + ((e && e.message) || String(e)));
      }
    });
  }

  if (clearImagesBtn) {
    clearImagesBtn.addEventListener('click', async function () {
      try {
        await chrome.storage.local.remove(['clipImageMode', 'clipImageRelPath']);
        try {
          await WeixinClipIdb.clearImagesRootDirHandle();
        } catch (e0) {}
        setImageDirStatus('已清除单独图片目录与 storage 相对路径。');
      } catch (e) {
        setImageDirStatus('清除失败：' + ((e && e.message) || String(e)));
      }
    });
  }

  chrome.storage.onChanged.addListener(function (changes, area) {
    if (area !== 'local') return;
    if (changes.lastClipResult) refreshLastClip();
    if (changes.clipImageMode || changes.clipImageRelPath) refreshImageDirStatus();
  });

  try {
    chrome.storage.local.remove('imageFolder');
  } catch (e0) {}

  refreshStatus();
  refreshVaultStatus();
  refreshLastClip();
  refreshImageDirStatus();
})();
