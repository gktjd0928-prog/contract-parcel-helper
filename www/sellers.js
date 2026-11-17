// 업체 찾기: 사용자가 내려받은 통신판매사업자 공개 CSV를 불러와 검색
(() => {
  'use strict';
  const $ = (s) => document.querySelector(s);
  const KEY = 'sellers';
  const META = 'sellers_meta';
  const PAGE = 50;

  let rows = null;      // 메모리 캐시
  let meta = null;
  let shown = PAGE;
  let loading = null;

  // 헤더 이름 → 필드 (앞쪽 후보가 우선)
  const FIELDS = {
    name:   ['상호', '상호명', '업체명', '스토어명'],
    ceo:    ['대표자명', '대표자'],
    tel:    ['전화번호', '대표전화', '연락처'],
    email:  ['전자우편', '이메일', 'email'],
    addr:   ['사업장소재지(도로명)', '도로명', '사업장소재지', '소재지', '주소'],
    status: ['업소상태', '영업상태', '상태'],
    items:  ['취급품목', '품목'],
    method: ['판매방식'],
    bizno:  ['사업자등록번호'],
    regno:  ['통신판매번호', '신고번호'],
    domain: ['인터넷도메인', '도메인', 'url']
  };

  const REGIONS = [
    ['서울', '서울'], ['부산', '부산'], ['대구', '대구'], ['인천', '인천'], ['광주', '광주'],
    ['대전', '대전'], ['울산', '울산'], ['세종', '세종'], ['경기', '경기'], ['강원', '강원'],
    ['충청북', '충북'], ['충북', '충북'], ['충청남', '충남'], ['충남', '충남'],
    ['전라북', '전북'], ['전북', '전북'], ['전라남', '전남'], ['전남', '전남'],
    ['경상북', '경북'], ['경북', '경북'], ['경상남', '경남'], ['경남', '경남'], ['제주', '제주']
  ];
  function regionOf(addr) {
    const first = String(addr || '').trim().split(/\s+/)[0] || '';
    const hit = REGIONS.find(([k]) => first.startsWith(k));
    return hit ? hit[1] : '';
  }

  // 인코딩 자동 판별 (UTF-8 → EUC-KR)
  function decode(buf) {
    try { return new TextDecoder('utf-8', { fatal: true }).decode(buf).replace(/^﻿/, ''); }
    catch (e) { return new TextDecoder('euc-kr').decode(buf); }
  }

  // RFC 4180 CSV 파서
  function parseCsv(text) {
    const out = [];
    let row = [], field = '', q = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (q) {
        if (c === '"') {
          if (text[i + 1] === '"') { field += '"'; i++; } else q = false;
        } else field += c;
      } else if (c === '"') q = true;
      else if (c === ',') { row.push(field); field = ''; }
      else if (c === '\n') { row.push(field); out.push(row); row = []; field = ''; }
      else if (c !== '\r') field += c;
    }
    if (field || row.length) { row.push(field); out.push(row); }
    return out.filter((r) => r.some((v) => v.trim() !== ''));
  }

  function mapHeader(header) {
    const h = header.map((x) => x.trim().toLowerCase());
    const idx = {};
    for (const [field, cands] of Object.entries(FIELDS)) {
      for (const c of cands) {
        const i = h.findIndex((x) => x === c.toLowerCase());
        if (i >= 0) { idx[field] = i; break; }
      }
      if (idx[field] == null) {
        for (const c of cands) {
          const i = h.findIndex((x) => x.includes(c.toLowerCase()));
          if (i >= 0) { idx[field] = i; break; }
        }
      }
    }
    return idx;
  }

  function toRecords(table) {
    // 첫 10줄 안에서 '상호'가 들어간 줄을 헤더로 사용
    const hi = table.slice(0, 10).findIndex((r) => r.some((v) => /상호|업체명|스토어명/.test(v)));
    if (hi < 0) throw new Error('헤더(상호 열)를 찾지 못했습니다');
    const idx = mapHeader(table[hi]);
    const get = (r, f) => (idx[f] != null ? String(r[idx[f]] ?? '').trim() : '');
    return table.slice(hi + 1).map((r) => {
      const rec = {
        name: get(r, 'name'), ceo: get(r, 'ceo'), tel: get(r, 'tel'), email: get(r, 'email'),
        addr: get(r, 'addr'), status: get(r, 'status'), items: get(r, 'items'),
        method: get(r, 'method'), bizno: get(r, 'bizno'), regno: get(r, 'regno'), domain: get(r, 'domain')
      };
      rec.region = regionOf(rec.addr);
      rec.key = rec.regno || `${rec.bizno}|${rec.name}`;
      return rec;
    }).filter((r) => r.name);
  }

  async function ensureLoaded() {
    if (rows) return;
    if (!loading) {
      loading = Promise.all([idb.get(KEY), idb.get(META)]).then(([r, m]) => {
        rows = r || [];
        meta = m || null;
      }).catch(() => { rows = []; meta = null; });
    }
    await loading;
  }

  async function importFiles(files) {
    await ensureLoaded();
    const byKey = new Map(rows.map((r) => [r.key, r]));
    let added = 0, updated = 0;
    const names = [];
    for (const f of files) {
      const recs = toRecords(parseCsv(decode(await f.arrayBuffer())));
      recs.forEach((r) => { if (byKey.has(r.key)) updated++; else added++; byKey.set(r.key, r); });
      names.push(f.name);
    }
    rows = Array.from(byKey.values());
    meta = {
      count: rows.length,
      files: Array.from(new Set([...(meta?.files || []), ...names])).slice(-50),
      importedAt: new Date().toISOString()
    };
    await idb.set(KEY, rows);
    await idb.set(META, meta);
    return { added, updated };
  }

  const isActive = (r) => !r.status || /정상|영업중|계속/.test(r.status);

  function filtered() {
    const q = $('#seller-search').value.trim().toLowerCase();
    const region = $('#seller-region').value;
    const active = $('#seller-active').checked;
    const phone = $('#seller-phone').checked;
    return rows.filter((r) =>
      (!region || r.region === region) &&
      (!active || isActive(r)) &&
      (!phone || r.tel) &&
      (!q || `${r.name} ${r.ceo} ${r.items} ${r.addr} ${r.domain}`.toLowerCase().includes(q))
    );
  }

  function renderList() {
    const { esc, hasClientFrom } = window.cph;
    const list = filtered();
    $('#seller-count').textContent = `${list.length.toLocaleString('ko-KR')}곳 (전체 ${rows.length.toLocaleString('ko-KR')}곳)`;
    $('#seller-list').innerHTML = list.slice(0, shown).map((r) => {
      const tel = (r.tel || '').replace(/[^0-9+]/g, '');
      const added = hasClientFrom(r.key);
      return `<div class="item">
        <div class="main">
          <div class="title">${esc(r.name)}${r.status ? `<span class="badge ${isActive(r) ? '' : 'due'}">${esc(r.status)}</span>` : ''}</div>
          <div class="sub">${esc([r.ceo, r.items, r.method].filter(Boolean).join(' · ')) || '&nbsp;'}</div>
          <div class="sub">${esc(r.addr)}</div>
        </div>
        <div class="side">
          ${tel ? `<a href="tel:${tel}" aria-label="전화">${ICON.phone}</a>` : ''}
          ${r.email ? `<a href="mailto:${esc(r.email)}" aria-label="메일">${ICON.mail}</a>` : ''}
          <button data-add-seller="${esc(r.key)}" aria-label="내 고객에 담기" ${added ? 'disabled' : ''}>${added ? ICON.check : ICON.plus}</button>
        </div>
      </div>`;
    }).join('') || '<div class="empty">조건에 맞는 업체가 없습니다.</div>';
    $('#seller-more').hidden = list.length <= shown;
  }

  function renderRegions() {
    const counts = {};
    rows.forEach((r) => { if (r.region) counts[r.region] = (counts[r.region] || 0) + 1; });
    const cur = $('#seller-region').value;
    $('#seller-region').innerHTML = '<option value="">전체 지역</option>' +
      Object.keys(counts).sort().map((k) => `<option value="${k}">${k} (${counts[k].toLocaleString('ko-KR')})</option>`).join('');
    $('#seller-region').value = counts[cur] ? cur : '';
  }

  async function render() {
    await ensureLoaded();
    const has = rows.length > 0;
    $('#seller-tools').hidden = !has;
    $('#seller-meta').textContent = has && meta
      ? `불러온 업체 ${meta.count.toLocaleString('ko-KR')}곳 · ${new Date(meta.importedAt).toLocaleString('ko-KR')} · 파일 ${meta.files.length}개`
      : '';
    if (has) { renderRegions(); renderList(); }
  }

  function bind() {
    $('#seller-file').addEventListener('change', async (e) => {
      const files = Array.from(e.target.files || []);
      e.target.value = '';
      if (!files.length) return;
      window.cph.toast('불러오는 중...');
      try {
        const { added, updated } = await importFiles(files);
        shown = PAGE;
        await render();
        window.cph.toast(`새 업체 ${added.toLocaleString('ko-KR')}곳, 갱신 ${updated.toLocaleString('ko-KR')}곳`);
      } catch (err) {
        window.cph.toast('불러오기 실패: ' + err.message);
      }
    });
    let t;
    const rerender = () => { shown = PAGE; clearTimeout(t); t = setTimeout(renderList, 150); };
    $('#seller-search').addEventListener('input', rerender);
    ['#seller-region', '#seller-active', '#seller-phone'].forEach((s) => $(s).addEventListener('change', rerender));
    $('#seller-more').addEventListener('click', () => { shown += PAGE; renderList(); });
    $('#seller-list').addEventListener('click', (e) => {
      const b = e.target.closest('[data-add-seller]');
      if (!b) return;
      const r = rows.find((x) => x.key === b.dataset.addSeller);
      if (r && window.cph.addClientFrom(r)) { b.innerHTML = ICON.check; b.disabled = true; }
    });
    $('#seller-clear').addEventListener('click', async () => {
      if (!confirm('불러온 업체 목록을 모두 삭제할까요? (내 고객에 담은 업체는 남습니다)')) return;
      await idb.del(KEY); await idb.del(META);
      rows = []; meta = null;
      await render();
      window.cph.toast('삭제했습니다');
    });
  }

  window.cphSellers = { render, _parseCsv: parseCsv, _toRecords: toRecords };
  document.addEventListener('DOMContentLoaded', bind);
})();
