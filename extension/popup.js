'use strict';
const KEY = 'humanproof-contributions-v1';
const $ = selector => document.querySelector(selector);
let records = [], ready = false, busy = false;
const status = message => { $('#status').textContent = message; };
const read = async () => {
  const value = (await chrome.storage.local.get(KEY))[KEY] || [];
  if (!Array.isArray(value) || value.length > ContributionRecords.LIMIT) throw new Error('저장 데이터가 손상되었습니다. 기존 기록은 덮어쓰지 않습니다.');
  return value.map(ContributionRecords.normalize);
};
async function run(action) {
  if (!ready || busy) return;
  busy = true;
  try { await action(); } catch (error) { status(error.message || '처리하지 못했습니다. 다시 시도하세요.'); }
  finally { busy = false; }
}
async function update(change) {
  // Serialize popup instances across windows. A storage write must finish before reporting success.
  await navigator.locks.request(KEY, async () => {
    const next = change(await read());
    await chrome.storage.local.set({ [KEY]: next });
    records = next;
  });
  render();
}
function render() {
  $('#count').textContent = records.length;
  $('#export').disabled = !records.length;
  $('#clear').disabled = !records.length || !$('#confirmDelete').checked;
  const list = $('#records'); list.replaceChildren();
  for (const record of [...records].reverse()) {
    const article = document.createElement('article'), title = document.createElement('b'), note = document.createElement('p'), remove = document.createElement('button');
    title.textContent = `${record.actorType} · ${record.stage}`;
    note.textContent = record.note;
    remove.type = 'button'; remove.textContent = '이 기록 삭제';
    remove.addEventListener('click', () => run(async () => { await update(items => items.filter(item => item.id !== record.id)); status('기록을 삭제했습니다.'); }));
    article.append(title, note, remove); list.append(article);
  }
}
$('#capture').addEventListener('click', () => run(async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id || !tab.url) throw new Error('활성 웹페이지를 찾을 수 없습니다. 확장 아이콘을 다시 눌러 주세요.');
  const sourceUrl = ContributionRecords.cleanUrl(tab.url);
  if (new URL(sourceUrl).hostname === 'chromewebstore.google.com' || sourceUrl.startsWith('https://chrome.google.com/webstore')) throw new Error('Chrome 웹스토어는 페이지 수집을 허용하지 않습니다.');
  const includeSelection = $('#includeSelection').checked;
  let results;
  try {
    results = await chrome.scripting.executeScript({ target: { tabId: tab.id }, args: [includeSelection], func: selection => ({
      title: document.title.slice(0, 300), url: location.href,
      selectedText: selection ? String(window.getSelection() || '').slice(0, 5001) : ''
    }) });
  } catch { throw new Error('이 페이지는 접근을 허용하지 않습니다. 일반 웹페이지에서 확장 아이콘을 다시 눌러 주세요.'); }
  const result = results?.[0]?.result;
  if (!result || result.selectedText.length > 5000) throw new Error('선택 텍스트를 5,000자 이하로 줄여 주세요.');
  if (ContributionRecords.cleanUrl(result.url) !== sourceUrl) throw new Error('페이지가 이동했습니다. 다시 가져오세요.');
  $('#sourceUrl').value = sourceUrl; $('#pageTitle').value = result.title; $('#selectedText').value = result.selectedText;
  status('가져온 내용과 개인정보를 확인한 뒤 저장하세요.');
}));
$('#recordForm').addEventListener('submit', event => {
  event.preventDefault();
  run(async () => {
    const record = ContributionRecords.normalize({ id: 'contrib-' + crypto.randomUUID(), actorType: $('#actorType').value, stage: $('#stage').value,
      note: $('#note').value, pageTitle: $('#pageTitle').value, sourceUrl: $('#sourceUrl').value, selectedText: $('#selectedText').value, createdAt: new Date().toISOString() });
    await update(items => ContributionRecords.append(items, record));
    $('#recordForm').reset(); status('이 브라우저에 저장했습니다. JSON을 내보내 HumanProof에서 가져오세요.');
  });
});
$('#export').addEventListener('click', () => run(async () => {
  records = await read(); render();
  if (!records.length) throw new Error('내보낼 기록이 없습니다.');
  const output = { format: 'humanproof-contributions', schema: 1, exportedAt: new Date().toISOString(), records };
  const url = URL.createObjectURL(new Blob([JSON.stringify(output, null, 2)], { type: 'application/json' }));
  const link = document.createElement('a'); link.href = url; link.download = 'humanproof-contributions.json'; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
  status('내보내기를 요청했습니다. 다운로드 파일을 확인하세요.');
}));
$('#confirmDelete').addEventListener('change', render);
$('#clear').addEventListener('click', () => run(async () => {
  if (!$('#confirmDelete').checked) return;
  await update(() => []); $('#confirmDelete').checked = false; render(); status('전체 기록을 삭제했습니다.');
}));
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes[KEY] && !busy) read().then(items => { records = items; render(); }).catch(error => status(error.message));
});
(async () => {
  try {
    await chrome.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });
    records = await read(); ready = true; render();
  } catch (error) { status('저장소를 열 수 없습니다: ' + error.message); document.querySelectorAll('button').forEach(button => button.disabled = true); }
})();
