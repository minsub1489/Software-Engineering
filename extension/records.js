(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ContributionRecords = api;
})(globalThis, function () {
  'use strict';
  const LIMIT = 100;
  function cleanUrl(raw) {
    const url = new URL(raw);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('일반 HTTP(S) 웹페이지에서 사용하세요. Chrome 설정·웹스토어·로컬 파일에서는 수집할 수 없습니다.');
    url.search = ''; url.hash = '';
    if (url.href.length > 2000) throw new Error('페이지 주소가 너무 깁니다.');
    return url.href;
  }
  function normalize(input) {
    if (!input || typeof input.note !== 'string' || !input.note.trim() || input.note.length > 2000 ||
      !['AI', 'HUMAN'].includes(input.actorType) || !['idea', 'draft', 'verification', 'revision'].includes(input.stage) ||
      typeof input.pageTitle !== 'string' || input.pageTitle.length > 300 || typeof input.selectedText !== 'string' || input.selectedText.length > 5000 ||
      typeof input.id !== 'string' || !/^[\w-]{1,100}$/.test(input.id) || typeof input.createdAt !== 'string' || input.createdAt.length > 32 || !Number.isFinite(Date.parse(input.createdAt)))
      throw new Error('기록 형식과 필수 입력을 확인하세요. 설명 2,000자, 선택 텍스트 5,000자까지 저장할 수 있습니다.');
    return { id: input.id, actorType: input.actorType, stage: input.stage, note: input.note.trim(), sourceUrl: input.sourceUrl ? cleanUrl(input.sourceUrl) : '',
      selectedText: input.selectedText, pageTitle: input.pageTitle, createdAt: input.createdAt };
  }
  function append(records, record) {
    if (!Array.isArray(records) || records.length > LIMIT) throw new Error('저장된 기록 형식이 올바르지 않습니다.');
    const normalized = normalize(record);
    if (records.some(item => item.id === normalized.id)) return records;
    if (records.length >= LIMIT) throw new Error('최대 100개입니다. JSON을 내보낸 뒤 기존 기록을 삭제하세요.');
    return [...records.map(normalize), normalized];
  }
  return { LIMIT, cleanUrl, normalize, append };
});
