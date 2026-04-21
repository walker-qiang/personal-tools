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
        var r = st.delete('root');
        r.onsuccess = function () {
          resolve();
        };
        r.onerror = function () {
          reject(r.error);
        };
      });
    });
  }

  function setPendingClipPayload(payload) {
    return openDb().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(PENDING, 'readwrite');
        var st = tx.objectStore(PENDING);
        var r = st.put(payload, 'clip');
        r.onsuccess = function () {
          resolve();
        };
        r.onerror = function () {
          reject(r.error);
        };
      });
    });
  }

  function getPendingClipPayload() {
    return openDb().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(PENDING, 'readonly');
        var st = tx.objectStore(PENDING);
        var r = st.get('clip');
        r.onsuccess = function () {
          resolve(r.result != null ? r.result : null);
        };
        r.onerror = function () {
          reject(r.error);
        };
      });
    });
  }

  function clearPendingClipPayload() {
    return openDb().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(PENDING, 'readwrite');
        var st = tx.objectStore(PENDING);
        var r = st.delete('clip');
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
    setPendingClipPayload: setPendingClipPayload,
    getPendingClipPayload: getPendingClipPayload,
    clearPendingClipPayload: clearPendingClipPayload,
  };
})(typeof self !== 'undefined' ? self : this);
