/**
 * Shared IndexedDB helpers for persisting FileSystemDirectoryHandle (Chrome).
 * Same DB name/version from extension pages and the service worker.
 */
(function (global) {
  var DB_NAME = 'weixin-clip';
  var DB_VERSION = 1;
  var STORE = 'handles';

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

  global.WeixinClipIdb = {
    getRootDirHandle: getRootDirHandle,
    setRootDirHandle: setRootDirHandle,
    clearRootDirHandle: clearRootDirHandle,
  };
})(typeof self !== 'undefined' ? self : this);
