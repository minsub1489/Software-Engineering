(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.HumanProof = api;
})(globalThis, function () {
  'use strict';
  const MAX_PDF_BYTES = 20 * 1024 * 1024;
  const POLICY = Object.freeze({ version: 'demo-1.0', minimumScore: 5, gateCount: 3 });
  const canonical = value => JSON.stringify(value, (_, item) =>
    item && typeof item === 'object' && !Array.isArray(item)
      ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item);
  const digest = async bytes => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)),
    byte => byte.toString(16).padStart(2, '0')).join('');
  const digestText = text => digest(new TextEncoder().encode(text));
  const text = (value, max, required = true) => typeof value === 'string' && value.length <= max && (!required || value.trim().length > 0);
  const date = value => typeof value === 'string' && value.length <= 32 && Number.isFinite(Date.parse(value));
  const hash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
  const id = value => text(value, 100) && /^[\w-]+$/.test(value);
  function requireValue(valid, message) { if (!valid) throw new Error(message); }

  function gatesPassed(version) {
    return version.gates.length === POLICY.gateCount && !version.returned && version.gates.every(gate =>
      gate.submitted && gate.evaluation && Number.isInteger(gate.evaluation.score) && gate.evaluation.score >= 0 && gate.evaluation.score <= 2 &&
      text(gate.evaluation.reason, 5000) && !gate.evaluation.critical) &&
      version.gates.reduce((sum, gate) => sum + gate.evaluation.score, 0) >= POLICY.minimumScore;
  }
  function status(version, approval, latestId) {
    if (approval?.revokedAt) return ['승인 철회', 'red'];
    if (approval && latestId && version.id !== latestId) return ['후속 버전 있음', 'orange'];
    if (approval) return ['승인 완료', 'green'];
    if (version.returned || version.gates.some(gate => gate.evaluation?.critical)) return ['수정 요청', 'orange'];
    if (gatesPassed(version)) return ['검토 완료', 'purple'];
    if (version.gates.every(gate => gate.submitted)) return ['검토 대기', 'purple'];
    return ['이해 과제 대기', 'purple'];
  }
  function publicRecord(value) {
    requireValue(value && id(value.id) && text(value.title, 100) && text(value.fileName, 255) && hash(value.fileHash) &&
      Number.isInteger(value.n) && value.n > 0 && value.n <= 10000 && date(value.approvedAt) && text(value.serial, 100) &&
      (!value.revokedAt || date(value.revokedAt)) && text(value.revocationReason || '', 2000, false), '검증 링크의 승인 요약이 올바르지 않습니다.');
    return { id: value.id, title: value.title, n: value.n, fileName: value.fileName, fileHash: value.fileHash,
      approvedAt: value.approvedAt, serial: value.serial, revokedAt: value.revokedAt || null, revocationReason: value.revocationReason || '' };
  }
  function validateDatabase(data) {
    requireValue(data?.schema === 2 && id(data.workId) && text(data.title, 100) && Array.isArray(data.versions) &&
      data.versions.length > 0 && data.versions.length <= 10000 && Array.isArray(data.approvals) && Array.isArray(data.events), '저장된 작업 구조가 올바르지 않습니다.');
    const ids = new Set();
    data.versions.forEach((version, index) => {
      requireValue(id(version.id) && !ids.has(version.id) && version.n === index + 1 && text(version.fileName, 255) &&
        hash(version.hash) && Number.isInteger(version.size) && version.size > 0 && version.size <= MAX_PDF_BYTES &&
        typeof version.fileData === 'string' && version.fileData.length <= Math.ceil(MAX_PDF_BYTES / 3) * 4 &&
        text(version.tool, 100) && text(version.scope, 5000) && text(version.reason, 2000) && date(version.createdAt) &&
        Array.isArray(version.risk) && version.risk.length === 4 && version.risk.every((n, i) => Number.isInteger(n) && n >= 0 && n <= [3, 3, 2, 2][i]) &&
        Array.isArray(version.gates) && version.gates.length === 3 && Array.isArray(version.checks) && version.checks.length === 4 &&
        version.checks.every(n => typeof n === 'boolean') && text(version.memo, 5000, false) && typeof version.returned === 'boolean', '저장된 파일 버전이 올바르지 않습니다.');
      ids.add(version.id);
      for (const gate of version.gates) {
        requireValue(text(gate.answer, 10000, false) && typeof gate.submitted === 'boolean' && (!gate.submitted || gate.answer.trim()) &&
          Number.isFinite(gate.confidence) && gate.confidence >= 0 && gate.confidence <= 100, '저장된 과제 답변이 올바르지 않습니다.');
        if (gate.evaluation) requireValue(Number.isInteger(gate.evaluation.score) && gate.evaluation.score >= 0 && gate.evaluation.score <= 2 &&
          text(gate.evaluation.reason, 5000, false) && typeof gate.evaluation.critical === 'boolean', '저장된 평가가 올바르지 않습니다.');
      }
      if (version.policy) requireValue(canonical(version.policy) === canonical(POLICY), '지원하지 않는 시연 평가 정책입니다.');
      if (version.contributions) {
        requireValue(Array.isArray(version.contributions) && version.contributions.length <= 100 &&
          new Set(version.contributions.map(item => item?.id)).size === version.contributions.length, '기여 기록 개수 또는 ID가 올바르지 않습니다.');
        version.contributions.forEach(validateContribution);
      }
      if (version.reviewRounds) {
        requireValue(Array.isArray(version.reviewRounds) && version.reviewRounds.length <= 1000, '검토 회차 기록이 올바르지 않습니다.');
        for (const round of version.reviewRounds) requireValue(date(round.at) && text(round.reason, 2000) && text(round.memo, 5000, false) &&
          Array.isArray(round.gates) && round.gates.length === 3 && round.gates.every(gate => text(gate.answer, 10000, false) &&
            Number.isFinite(gate.confidence) && gate.confidence >= 0 && gate.confidence <= 100 && (!gate.evaluation ||
              (Number.isInteger(gate.evaluation.score) && gate.evaluation.score >= 0 && gate.evaluation.score <= 2 && text(gate.evaluation.reason, 5000, false)))), '이전 검토 회차가 올바르지 않습니다.');
      }
    });
    const approved = new Set(), receiptIds = new Set();
    for (const approval of data.approvals) {
      publicRecord(approval);
      const version = data.versions.find(item => item.id === approval.versionId);
      requireValue(version && !approved.has(version.id) && !receiptIds.has(approval.id) && approval.fileHash === version.hash && approval.n === version.n &&
        approval.fileName === version.fileName && approval.title === data.title && approval.payload && hash(approval.payloadHash) &&
        approval.payload.versionId === version.id && approval.payload.fileHash === version.hash && approval.payload.id === approval.id &&
        text(approval.memo, 5000) && Number.isInteger(approval.score) && approval.score >= 5 && approval.score <= 6 &&
        approval.payload.approvedAt === approval.approvedAt && approval.payload.memo === approval.memo && approval.payload.score === approval.score &&
        gatesPassed(version) && version.checks.every(Boolean) && version.memo === approval.memo &&
        canonical(approval.evaluations) === canonical(version.gates.map(gate => gate.evaluation)) &&
        canonical(approval.checks) === canonical(version.checks), '승인 기록과 대상 버전이 일치하지 않습니다.');
      approved.add(version.id); receiptIds.add(approval.id);
    }
    for (const event of data.events) requireValue(id(event.id) && text(event.action, 200) && text(event.actor, 100) &&
      text(event.note, 10000, false) && ids.has(event.target) && date(event.time) && hash(event.prevHash) && hash(event.eventHash), '감사 기록 구조가 올바르지 않습니다.');
    return data;
  }
  async function verifyIntegrity(data, decode) {
    validateDatabase(data);
    for (const version of data.versions) {
      const bytes = decode(version.fileData);
      requireValue(bytes.length === version.size && await digest(bytes) === version.hash, '저장된 PDF의 해시가 일치하지 않습니다.');
    }
    for (const approval of data.approvals) {
      const version = data.versions.find(item => item.id === approval.versionId);
      requireValue(await digestText(canonical(approval.payload)) === approval.payloadHash &&
        await digestText(canonical({ tool: version.tool, scope: version.scope })) === approval.aiDisclosureHash &&
        approval.payload.aiDisclosureHash === approval.aiDisclosureHash, '승인 영수증의 내용 해시가 일치하지 않습니다.');
      if (approval.reviewDigest) requireValue(await digestText(canonical(reviewSnapshot(version))) === approval.reviewDigest &&
        approval.payload.reviewDigest === approval.reviewDigest, '승인된 답변·검토 범위가 변경되었습니다.');
    }
    requireValue(await verifyChain(data.events), '감사 해시 체인이 일치하지 않습니다.');
    return data;
  }
  async function verifyChain(events) {
    let previous = '0'.repeat(64);
    const seen = new Set();
    for (const event of events) {
      const body = { id: event.id, action: event.action, actor: event.actor, note: event.note, target: event.target, time: event.time };
      if (seen.has(event.id) || event.prevHash !== previous || event.eventHash !== await digestText(previous + canonical(body))) return false;
      seen.add(event.id); previous = event.eventHash;
    }
    return true;
  }
  function reviewSnapshot(version) {
    return { policy: version.policy || POLICY, gates: version.gates, checks: version.checks, memo: version.memo, contributions: version.contributions || [] };
  }
  function validateTransition(before, after) {
    validateDatabase(after);
    if (before.workId !== after.workId) return; // Explicit new-work/reset action creates another aggregate.
    requireValue(after.versions.length >= before.versions.length && after.events.length >= before.events.length && after.approvals.length >= before.approvals.length,
      '기존 버전·승인·감사 기록을 삭제할 수 없습니다.');
    requireValue(canonical(after.events.slice(0, before.events.length)) === canonical(before.events), '기존 감사 기록을 수정할 수 없습니다.');
    before.versions.forEach((version, index) => {
      const next = after.versions[index];
      for (const key of ['id', 'n', 'fileData', 'hash', 'tool', 'scope', 'fileName', 'size', 'risk', 'reason', 'createdAt'])
        requireValue(canonical(version[key]) === canonical(next[key]), '파일·AI 신고·위험도 변경은 새 버전으로 등록하세요.');
      if (before.approvals.some(item => item.versionId === version.id)) requireValue(canonical(version) === canonical(next), '승인된 검토 범위는 변경할 수 없습니다.');
    });
    before.approvals.forEach((approval, index) => {
      const next = after.approvals[index];
      const immutable = item => Object.fromEntries(Object.entries(item).filter(([key]) => !['revokedAt', 'revocationReason'].includes(key)));
      requireValue(canonical(immutable(approval)) === canonical(immutable(next)) &&
        (!approval.revokedAt || (approval.revokedAt === next.revokedAt && approval.revocationReason === next.revocationReason)), '기존 승인이나 철회 기록을 수정할 수 없습니다.');
    });
  }
  function validateContribution(item) {
    requireValue(item && id(item.id) && ['AI', 'HUMAN'].includes(item.actorType) &&
      ['idea', 'draft', 'verification', 'revision'].includes(item.stage) && text(item.note, 2000) &&
      text(item.selectedText || '', 5000, false) && text(item.pageTitle || '', 300, false) && date(item.createdAt), '기여 기록이 올바르지 않습니다.');
    if (item.sourceUrl) {
      const url = new URL(item.sourceUrl);
      requireValue(['https:', 'http:'].includes(url.protocol) && !url.username && !url.password && !url.search && !url.hash && item.sourceUrl.length <= 2000,
        '근거 URL은 HTTP(S) 주소만 허용하며 검색어·토큰·비밀번호를 포함할 수 없습니다.');
    }
    return item;
  }
  function parseContributionExport(input) {
    requireValue(input?.format === 'humanproof-contributions' && input.schema === 1 && Array.isArray(input.records) &&
      input.records.length > 0 && input.records.length <= 100, 'HumanProof 확장 프로그램 JSON 파일을 선택하세요. 최대 100개 기록을 가져올 수 있습니다.');
    return input.records.map(record => {
      // Copy only known fields. Extension data is self-reported evidence, never an approval command.
      const item = { id: record.id, actorType: record.actorType, stage: record.stage, note: record.note, sourceUrl: record.sourceUrl || '',
        selectedText: record.selectedText || '', pageTitle: record.pageTitle || '', createdAt: record.createdAt };
      return validateContribution(item);
    });
  }
  return { MAX_PDF_BYTES, POLICY, canonical, digest, digestText, gatesPassed, status, publicRecord, validateDatabase,
    verifyIntegrity, verifyChain, validateTransition, reviewSnapshot, validateContribution, parseContributionExport };
});
