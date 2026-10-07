(function (root) {
  'use strict';
  class ConflictError extends Error {
    constructor() { super('다른 탭에서 작업이 변경되었습니다. 최신 기록을 불러왔습니다. 내용을 확인한 뒤 다시 진행하세요.'); this.name = 'ConflictError'; }
  }
  class Repository {
    constructor(indexedDB = root.indexedDB) { this.indexedDB = indexedDB; }
    async open() {
      if (!this.indexedDB) throw new Error('브라우저에서 IndexedDB 저장소를 사용할 수 없습니다. Chrome의 일반 창에서 다시 열어 주세요.');
      this.connection = await new Promise((resolve, reject) => {
        const request = this.indexedDB.open('humanproof-demo', 1);
        request.onupgradeneeded = () => request.result.createObjectStore('workspace');
        request.onerror = () => reject(request.error);
        request.onblocked = () => reject(new Error('다른 창이 저장소 업그레이드를 막고 있습니다. 기존 HumanProof 창을 닫아 주세요.'));
        request.onsuccess = () => resolve(request.result);
      });
      this.connection.onversionchange = () => this.connection.close();
      return this;
    }
    load() {
      return new Promise((resolve, reject) => {
        const transaction = this.connection.transaction('workspace', 'readonly');
        const request = transaction.objectStore('workspace').get('current');
        transaction.oncomplete = () => resolve(request.result || null);
        transaction.onabort = () => reject(transaction.error || new Error('저장된 작업을 읽을 수 없습니다.'));
      });
    }
    commit(data, expectedRevision) {
      const snapshot = structuredClone(data);
      return new Promise((resolve, reject) => {
        const transaction = this.connection.transaction('workspace', 'readwrite');
        const store = transaction.objectStore('workspace');
        let conflict = false;
        const request = store.get('current');
        request.onsuccess = () => {
          if ((request.result?.revision || 0) !== expectedRevision) { conflict = true; transaction.abort(); return; }
          store.put({ revision: expectedRevision + 1, data: snapshot }, 'current');
        };
        transaction.oncomplete = () => resolve(expectedRevision + 1);
        transaction.onabort = () => reject(conflict ? new ConflictError() : transaction.error || new Error('브라우저 저장에 실패했습니다.'));
      });
    }
  }
  const api = { Repository, ConflictError };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.HumanProofStorage = api;
})(globalThis);
