/**
 * Shared IndexedDB helpers for persisting FileSystemDirectoryHandle (Chrome).
 * Same DB name/version from extension pages and the service worker.
 * pending 库：供 SW 写入、writer 页面读取的剪藏 payload（不可存 FileSystemHandle）。
 */
(function (global) {
  var DB_NAME = 'weixin-clip';
  var DB_VERSION = 2;
  var STORE = 'handles';
  var PENDING = 'pending';

  function openDb() {
    return new Promise(function (resolve, reject) {
      var req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onerror = function () {
        reject(req.error);
      };
      req.onsuccess = function () {
        resolve(req.result);
      };
      req.onupgradeneeded = function (e) {
        var db = e.target.result;
        if (!db.objectStoreNames.contains(STORE)) {
          db.createObjectStore(STORE);
        }
        if (!db.objectStoreNames.contains(PENDING)) {
          db.createObjectStore(PENDING);
        }
      };
    });
  }

  function pendingKey(jobId) {
    var id = String(jobId || '').trim();
    if (!id) {
      throw new Error('pending clip jobId is required');
    }
    return 'clip:' + id;
  }

  function getRootDirHandle() {
    return openDb().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(STORE, 'readonly');
        var st = tx.objectStore(STORE);
        var r = st.get('root');
        r.onsuccess = function () {
          resolve(r.result || null);
        };
        r.onerror = function () {
          reject(r.error);
        };
      });
    });
  }

  function setRootDirHandle(handle) {
    return openDb().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(STORE, 'readwrite');
        var st = tx.objectStore(STORE);
        var r = st.put(handle, 'root');
        r.onsuccess = function () {
          resolve();
        };
        r.onerror = function () {
          reject(r.error);
        };
      });
    });
  }

  function clearRootDirHandle() {
    return openDb().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(STORE, 'readwrite');
        var st = tx.objectStore(STORE);
        st.delete('root');
        tx.oncomplete = function () {
          resolve();
        };
        tx.onerror = function () {
          reject(tx.error);
        };
      });
    });
  }

  function getVaultDirHandle() {
    return openDb().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(STORE, 'readonly');
        var st = tx.objectStore(STORE);
        var r = st.get('vault');
        r.onsuccess = function () {
          resolve(r.result || null);
        };
        r.onerror = function () {
          reject(r.error);
        };
      });
    });
  }

  function setVaultDirHandle(handle) {
    return openDb().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(STORE, 'readwrite');
        var st = tx.objectStore(STORE);
        var r = st.put(handle, 'vault');
        r.onsuccess = function () {
          resolve();
        };
        r.onerror = function () {
          reject(r.error);
        };
      });
    });
  }

  function clearVaultDirHandle() {
    return openDb().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(STORE, 'readwrite');
        var st = tx.objectStore(STORE);
        var r = st.delete('vault');
        r.onsuccess = function () {
          resolve();
        };
        r.onerror = function () {
          reject(r.error);
        };
      });
    });
  }

  function getImagesRootDirHandle() {
    return openDb().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(STORE, 'readonly');
        var st = tx.objectStore(STORE);
        var r = st.get('images');
        r.onsuccess = function () {
          resolve(r.result || null);
        };
        r.onerror = function () {
          reject(r.error);
        };
      });
    });
  }

  function setImagesRootDirHandle(handle) {
    return openDb().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(STORE, 'readwrite');
        var st = tx.objectStore(STORE);
        var r = st.put(handle, 'images');
        r.onsuccess = function () {
          resolve();
        };
        r.onerror = function () {
          reject(r.error);
        };
      });
    });
  }

  /** 清除 IndexedDB 中的「图片根」句柄（与 chrome.storage 相对路径二选一）。 */
  function clearImagesRootDirHandle() {
    return openDb().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(STORE, 'readwrite');
        var st = tx.objectStore(STORE);
        var r = st.delete('images');
        r.onsuccess = function () {
          resolve();
        };
        r.onerror = function () {
          reject(r.error);
        };
      });
    });
  }

  function setPendingClipPayload(jobId, payload) {
    return openDb().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(PENDING, 'readwrite');
        var st = tx.objectStore(PENDING);
        var r = st.put(payload, pendingKey(jobId));
        r.onsuccess = function () {
          resolve();
        };
        r.onerror = function () {
          reject(r.error);
        };
      });
    });
  }

  function getPendingClipPayload(jobId) {
    return openDb().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(PENDING, 'readonly');
        var st = tx.objectStore(PENDING);
        var r = st.get(pendingKey(jobId));
        r.onsuccess = function () {
          resolve(r.result != null ? r.result : null);
        };
        r.onerror = function () {
          reject(r.error);
        };
      });
    });
  }

  function clearPendingClipPayload(jobId) {
    return openDb().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(PENDING, 'readwrite');
        var st = tx.objectStore(PENDING);
        var r = st.delete(pendingKey(jobId));
        r.onsuccess = function () {
          resolve();
        };
        r.onerror = function () {
          reject(r.error);
        };
      });
    });
  }

  global.WeixinClipIdb = {
    getRootDirHandle: getRootDirHandle,
    setRootDirHandle: setRootDirHandle,
    clearRootDirHandle: clearRootDirHandle,
    getVaultDirHandle: getVaultDirHandle,
    setVaultDirHandle: setVaultDirHandle,
    clearVaultDirHandle: clearVaultDirHandle,
    getImagesRootDirHandle: getImagesRootDirHandle,
    setImagesRootDirHandle: setImagesRootDirHandle,
    clearImagesRootDirHandle: clearImagesRootDirHandle,
    setPendingClipPayload: setPendingClipPayload,
    getPendingClipPayload: getPendingClipPayload,
    clearPendingClipPayload: clearPendingClipPayload,
  };
})(typeof self !== 'undefined' ? self : this);
