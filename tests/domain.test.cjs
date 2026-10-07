const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const domain = require('../prototype/dist/domain.js');
const extension = require('../extension/records.js');
const clone = structuredClone;
const at = '2026-10-07T00:00:00.000Z';
const bytes = new TextEncoder().encode('%PDF-1.4\nfixture\n%%EOF');
const decode = value => new Uint8Array(Buffer.from(value, 'base64'));
function gates() { return [0, 1, 2].map(() => ({ answer: '버전과 바이트의 역할을 설명했습니다.', confidence: 80, submitted: true, evaluation: { score: 2, reason: '근거를 확인했습니다.', critical: false } })); }
async function fixture(approved = false) {
  const version = { id: 'ver-1', n: 1, fileName: 'sample.pdf', size: bytes.length, fileData: Buffer.from(bytes).toString('base64'), hash: await domain.digest(bytes), tool: 'ChatGPT', scope: '초안', risk: [3, 3, 1, 1],
    policy: { ...domain.POLICY }, gates: gates(), checks: [true, true, true, true], memo: '파일과 근거 확인', reason: '최초 등록', createdAt: at, returned: false, contributions: [], reviewRounds: [] };
  const data = { schema: 2, workId: 'work-1', title: '설계 보고서', versions: [version], approvals: [], events: [] };
  if (approved) {
    const approval = { id: 'receipt-1', serial: 'HP-2026-0001', title: data.title, versionId: version.id, n: 1, fileName: version.fileName, fileHash: version.hash,
      approvedAt: at, reviewer: '검토자 B', score: 6, memo: version.memo, aiDisclosureHash: await domain.digestText(domain.canonical({ tool: version.tool, scope: version.scope })),
      checks: [...version.checks], evaluations: version.gates.map(gate => ({ ...gate.evaluation })), revokedAt: null,
      reviewDigest: await domain.digestText(domain.canonical(domain.reviewSnapshot(version))) };
    approval.payload = clone(approval); approval.payloadHash = await domain.digestText(domain.canonical(approval.payload)); data.approvals.push(approval);
  }
  return data;
}
const record = () => ({ id: 'contrib-1', actorType: 'HUMAN', stage: 'verification', note: '출처와 근거 확인', sourceUrl: 'https://example.org/report', selectedText: '', pageTitle: '자료', createdAt: at });

test('5/6 passes; 4/6, critical error and missing rationale block approval', () => {
  const version = { gates: gates(), returned: false };
  version.gates[0].evaluation.score = 1; assert.equal(domain.gatesPassed(version), true);
  version.gates[1].evaluation.score = 1; assert.equal(domain.gatesPassed(version), false);
  version.gates[1].evaluation.score = 2; version.gates[1].evaluation.critical = true; assert.equal(domain.gatesPassed(version), false);
  version.gates[1].evaluation.critical = false; version.gates[1].evaluation.reason = ' '; assert.equal(domain.gatesPassed(version), false);
});
test('invalid scores and returned/unsubmitted gates cannot pass', () => {
  for (const score of [NaN, 3, -1, 1.5, '2']) { const version = { gates: gates() }; version.gates[0].evaluation.score = score; assert.equal(domain.gatesPassed(version), false); }
  assert.equal(domain.gatesPassed({ gates: gates(), returned: true }), false);
  const version = { gates: gates() }; version.gates[0].submitted = false; assert.equal(domain.gatesPassed(version), false);
});
test('revocation and superseded version have independent status', async () => {
  const data = await fixture(true), version = data.versions[0], approval = data.approvals[0];
  assert.equal(domain.status(version, approval, 'ver-2')[0], '후속 버전 있음');
  approval.revokedAt = at; assert.equal(domain.status(version, approval, 'ver-2')[0], '승인 철회');
});
test('valid database and receipt hashes verify', async () => { await domain.verifyIntegrity(await fixture(true), decode); });
test('one-byte PDF tampering is detected', async () => {
  const data = await fixture(); data.versions[0].fileData = Buffer.from('%PDF-different').toString('base64');
  await assert.rejects(domain.verifyIntegrity(data, decode), /PDF/);
});
test('tampered approval payload is detected', async () => {
  const data = await fixture(true); data.approvals[0].payload.memo = '변조'; await assert.rejects(domain.verifyIntegrity(data, decode));
});
test('modified approved answer is detected by review digest', async () => {
  const data = await fixture(true); data.versions[0].gates[0].answer = '변경된 답변'; await assert.rejects(domain.verifyIntegrity(data, decode), /검토 범위/);
});
test('approval targets cannot be changed; revocation is terminal', async () => {
  const before = await fixture(true), next = clone(before); next.versions[0].scope = '신고 수정';
  assert.throws(() => domain.validateTransition(before, next), /새 버전/);
  const revoked = clone(before); revoked.approvals[0].revokedAt = at; revoked.approvals[0].revocationReason = '근거 오류'; domain.validateTransition(before, revoked);
  assert.throws(() => domain.validateTransition(revoked, before), /철회/);
});
test('approved review/checklist and duplicate receipts cannot change', async () => {
  const data = await fixture(true), next = clone(data); next.versions[0].gates[0].confidence = 60;
  assert.throws(() => domain.validateTransition(data, next), /검토 범위/);
  data.approvals.push(clone(data.approvals[0])); assert.throws(() => domain.validateDatabase(data));
});
test('new version does not inherit approval', async () => {
  const data = await fixture(true), next = clone(data), version = clone(data.versions[0]);
  version.id = 'ver-2'; version.n = 2; version.gates.forEach(gate => { gate.submitted = false; gate.evaluation = null; }); version.checks.fill(false); version.memo = '';
  next.versions.push(version); domain.validateTransition(data, next); assert.equal(domain.status(version, undefined, version.id)[0], '이해 과제 대기');
});
test('audit event modification, deletion and duplicate IDs break chain', async () => {
  const body = { id: 'evt-1', action: '등록', actor: 'A', note: '근거', target: 'ver-1', time: at };
  const first = { ...body, prevHash: '0'.repeat(64), eventHash: await domain.digestText('0'.repeat(64) + domain.canonical(body)) };
  const body2 = { ...body, id: 'evt-2' }, second = { ...body2, prevHash: first.eventHash, eventHash: await domain.digestText(first.eventHash + domain.canonical(body2)) };
  assert.equal(await domain.verifyChain([first, second]), true);
  assert.equal(await domain.verifyChain([{ ...first, note: '변조' }, second]), false);
  assert.equal(await domain.verifyChain([second]), false);
  assert.equal(await domain.verifyChain([first, first]), false);
});
test('public summary is whitelisted; malformed dates/names/hashes rejected', async () => {
  const approval = (await fixture(true)).approvals[0], summary = domain.publicRecord(approval);
  assert.equal('memo' in summary, false); assert.equal('evaluations' in summary, false);
  for (const edit of [{ revokedAt: 'invalid' }, { fileName: {} }, { serial: undefined }, { n: -1 }, { title: 'a'.repeat(101) }, { fileHash: 'fake' }]) assert.throws(() => domain.publicRecord({ ...approval, ...edit }));
});
test('extension URL strips query/hash and rejects dangerous schemes/credentials', () => {
  assert.equal(extension.cleanUrl('https://example.org/report?token=secret#private'), 'https://example.org/report');
  for (const url of ['chrome://settings', 'file:///private', 'javascript:alert(1)', 'https://user:pass@example.org/']) assert.throws(() => extension.cleanUrl(url));
});
test('extension duplicate ID is idempotent; capacity is enforced', () => {
  const normalized = extension.normalize(record()); assert.deepEqual(extension.append([normalized], normalized), [normalized]);
  const full = Array.from({ length: 100 }, (_, i) => ({ ...record(), id: 'contrib-' + i }));
  assert.throws(() => extension.append(full, { ...record(), id: 'new-id' }), /100/);
});
test('import accepts extension output and discards injected command fields', () => {
  const records = domain.parseContributionExport({ format: 'humanproof-contributions', schema: 1, records: [{ ...record(), approval: true, command: 'approve' }] });
  assert.equal(records[0].command, undefined); assert.equal(records[0].approval, undefined);
});
test('malformed, oversized and token-containing imports are rejected', () => {
  for (const edit of [{ sourceUrl: 'https://example.org/?token=secret' }, { sourceUrl: 'javascript:alert(1)' }, { note: ' ' }, { note: 'a'.repeat(2001) }, { actorType: 'ADMIN' }])
    assert.throws(() => domain.parseContributionExport({ format: 'humanproof-contributions', schema: 1, records: [{ ...record(), ...edit }] }));
  assert.throws(() => domain.parseContributionExport({ format: 'humanproof-contributions', schema: 1, records: Array(101).fill(record()) }));
});
test('manifest grants only user-triggered capture/storage and forbids external code', () => {
  const manifest = JSON.parse(fs.readFileSync('extension/manifest.json', 'utf8'));
  assert.equal(manifest.manifest_version, 3); assert.deepEqual(manifest.permissions.sort(), ['activeTab', 'scripting', 'storage']);
  assert.equal(manifest.host_permissions, undefined); assert.equal(manifest.content_scripts, undefined); assert.equal(manifest.externally_connectable, undefined);
  assert.equal(manifest.content_security_policy.extension_pages, "script-src 'self'; object-src 'none'");
});
