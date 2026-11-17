// 업체 찾기: 공정거래위원회 통신판매사업자 공개자료를 받아 검색
//  - 자동: 공정위 '자료 다운로드'(매주 일요일 오전 갱신)에서 장성군 파일만 앱이 직접 받음
//  - 수동: 다른 지역 CSV를 직접 불러올 수도 있음
// 자료는 이 기기에만 저장하며 다른 곳으로 보내지 않습니다.
(() => {
  'use strict';
  const $ = (s) => document.querySelector(s);
  const KEY = 'sellers';
  const META = 'sellers_meta';
  const PAGE = 50;

  // 공정위 자료 다운로드 주소 규칙: 통신판매사업자_{시도}_{시군구}.csv
  // 장성군은 2026년 행정구역 개편으로 옛 '전라남도'와 새 '전남광주통합특별시' 두 파일에 나뉘어 있어 둘 다 받는다.
  // 같은 신고번호가 양쪽에 있으면 뒤(새 행정구역) 파일이 우선.
  const FTC_AREA = '장성군';
  const FTC_FILES = [
    '통신판매사업자_전라남도_장성군.csv',
    '통신판매사업자_전남광주통합특별시_장성군.csv'
  ];
  const FTC_URL = (name) => 'https://www.ftc.go.kr/www/downloadBizComm.do?atchFileUrl=dataopen&atchFileNm=' + encodeURIComponent(name);

  let rows = null;      // 메모리 캐시
  let meta = null;
  let shown = PAGE;
  let loading = null;
  let fetching = null;

  // 헤더 이름 → 필드 (앞쪽 후보가 우선)
  const FIELDS = {
    name:   ['상호', '상호명', '업체명', '스토어명'],
    ceo:    ['대표자명', '대표자'],
    tel:    ['전화번호', '대표전화', '연락처'],
    email:  ['전자우편', '이메일', 'email'],
    addr:   ['사업장소재지(도로명)', '도로명', '사업장소재지', '소재지', '주소'],
    jibun:  ['사업장소재지'],          // 지번 주소 (도로명이 비었을 때 대신 사용)
    status: ['업소상태', '영업상태', '상태'],
    items:  ['취급품목', '품목'],
    method: ['판매방식'],
    bizno:  ['사업자등록번호'],
    regno:  ['통신판매번호', '신고번호'],
    regdate:['신고일자'],
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
  // 주소에서 읍·면·동 (예: '전라남도 장성군 삼계면 …' → '삼계면')
  function townOf(addr) {
    const t = String(addr || '').trim().split(/\s+/);
    const i = t.findIndex((w, k) => k > 0 && /(군|시|구)$/.test(w));
    const town = i >= 0 ? t[i + 1] : '';
    return /(읍|면|동|가|리)$/.test(town || '') ? town : '';
  }

  // 인코딩 자동 판별 (UTF-8 → EUC-KR). 공정위 파일은 EUC-KR(CP949)
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
        method: get(r, 'method'), bizno: get(r, 'bizno'), regno: get(r, 'regno'),
        regdate: get(r, 'regdate'), domain: get(r, 'domain')
      };
      // 공정위 파일은 도로명 주소가 비면 'null' 글자가 들어 있음 → 지번 주소로 대신
      const jibun = get(r, 'jibun');
      if (!rec.addr || /^null$/i.test(rec.addr)) rec.addr = /^null$/i.test(jibun) ? '' : jibun;
      if (!/^\d{8}$/.test(rec.regdate)) rec.regdate = '';   // 열이 밀린 줄의 엉뚱한 값은 버림
      rec.region = regionOf(rec.addr);
      rec.town = townOf(rec.addr) || townOf(jibun);
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

  async function save() {
    await idb.set(KEY, rows);
    await idb.set(META, meta);
  }

  // ---------- 공정위 자동 받기 ----------
  const isNative = () => !!window.Capacitor?.isNativePlatform?.();
  const Http = () => window.Capacitor?.Plugins?.CapacitorHttp;

  function b64ToBytes(b64) {
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  // 앱(네이티브)에서 직접 받음: 웹뷰의 교차 출처 제한을 피하려고 Capacitor 기본 HTTP 사용
  async function download(name) {
    const H = Http();
    if (!isNative() || !H) throw new Error('공정위 자료는 설치된 앱에서만 바로 받을 수 있습니다');
    const res = await H.request({ url: FTC_URL(name), method: 'GET', responseType: 'arraybuffer', connectTimeout: 20000, readTimeout: 60000 });
    if (res.status !== 200) throw new Error(`공정위 서버 응답 ${res.status}`);
    const bytes = typeof res.data === 'string' ? b64ToBytes(res.data) : new Uint8Array(res.data);
    const recs = toRecords(parseCsv(decode(bytes)));
    if (!recs.length) throw new Error('받은 파일에 업체가 없습니다');
    return recs;
  }

  // 공정위 파일은 매주 일요일 오전에 갱신 → 가장 최근 일요일 12시(한국시간) 이후에 받은 적이 없으면 새로 받음
  function lastSundayNoonKST(now = new Date()) {
    const kst = new Date(now.getTime() + 9 * 3600e3);            // UTC 기준 시각을 한국 시각으로 옮겨 계산
    const d = new Date(Date.UTC(kst.getUTCFullYear(), kst.getUTCMonth(), kst.getUTCDate(), 12));
    d.setUTCDate(d.getUTCDate() - d.getUTCDay());                 // 이번 주 일요일
    if (d > kst) d.setUTCDate(d.getUTCDate() - 7);                // 아직 일요일 정오 전이면 지난주
    return new Date(d.getTime() - 9 * 3600e3);
  }
  const isStale = () => !meta?.fetchedAt || new Date(meta.fetchedAt) < lastSundayNoonKST();

  async function fetchFtc({ silent = false } = {}) {
    if (fetching) return fetching;
    fetching = (async () => {
      await ensureLoaded();
      setFetchStatus('공정위 자료를 받는 중…');
      const byKey = new Map();
      for (const name of FTC_FILES) (await download(name)).forEach((r) => byKey.set(r.key, r));
      const prevKeys = new Set((meta?.source === 'ftc' ? rows : []).map((r) => r.key));
      const fresh = Array.from(byKey.values());
      const firstTime = prevKeys.size === 0;
      let added = 0;
      fresh.forEach((r) => {
        r.isNew = !firstTime && !prevKeys.has(r.key);
        if (r.isNew) added++;
      });
      // 직전에 '새로 등록'이었던 표시는 다음 갱신까지 유지
      if (!firstTime && added === 0 && meta?.source === 'ftc') {
        const keepNew = new Set(rows.filter((r) => r.isNew).map((r) => r.key));
        fresh.forEach((r) => { if (keepNew.has(r.key)) r.isNew = true; });
      }
      rows = fresh;
      meta = {
        source: 'ftc', area: FTC_AREA, count: rows.length,
        fetchedAt: new Date().toISOString(),
        latestRegDate: rows.reduce((m, r) => (r.regdate > m ? r.regdate : m), ''),
        added
      };
      await save();
      shown = PAGE;
      await render();
      if (silent && added) window.cph.toast(`${FTC_AREA} 통신판매사업자 신규 ${added}곳이 추가되었습니다`);
      else if (!silent) window.cph.toast(`${FTC_AREA} ${rows.length.toLocaleString('ko-KR')}곳을 받았습니다${added ? ` (신규 ${added}곳)` : ''}`);
      return { count: rows.length, added };
    })().catch((e) => {
      setFetchStatus('');
      if (!silent) window.cph.toast('받기 실패: ' + e.message);
      throw e;
    }).finally(() => { fetching = null; renderMeta(); });
    return fetching;
  }

  function setFetchStatus(text) {
    const el = $('#ftc-status');
    if (el) el.textContent = text;
  }

  // ---------- 직접 불러오기(다른 지역 CSV) ----------
  async function importFiles(files) {
    await ensureLoaded();
    const byKey = new Map(rows.map((r) => [r.key, r]));
    let added = 0, updated = 0;
    for (const f of files) {
      const recs = toRecords(parseCsv(decode(await f.arrayBuffer())));
      recs.forEach((r) => { if (byKey.has(r.key)) updated++; else added++; byKey.set(r.key, r); });
    }
    rows = Array.from(byKey.values());
    meta = { ...(meta || {}), source: meta?.source === 'ftc' ? 'ftc+file' : 'file', count: rows.length, importedAt: new Date().toISOString() };
    await save();
    return { added, updated };
  }

  // ---------- 목록 ----------
  const isActive = (r) => !r.status || /정상|영업재개|영업중|계속/.test(r.status);

  function filtered() {
    const q = $('#seller-search').value.trim().toLowerCase();
    const town = $('#seller-region').value;
    const active = $('#seller-active').checked;
    const phone = $('#seller-phone').checked;
    const onlyNew = $('#seller-new').checked;
    return rows.filter((r) =>
      (!town || (r.town || r.region) === town) &&
      (!active || isActive(r)) &&
      (!phone || r.tel) &&
      (!onlyNew || r.isNew) &&
      (!q || `${r.name} ${r.ceo} ${r.items} ${r.addr} ${r.domain}`.toLowerCase().includes(q))
    ).sort((a, b) => (b.isNew ? 1 : 0) - (a.isNew ? 1 : 0) || String(b.regdate).localeCompare(String(a.regdate)));
  }

  const fmtDate = (s) => (/^\d{8}$/.test(s) ? `${s.slice(0, 4)}.${s.slice(4, 6)}.${s.slice(6)}` : s);

  function renderList() {
    const { esc, hasClientFrom } = window.cph;
    const list = filtered();
    $('#seller-count').textContent = `${list.length.toLocaleString('ko-KR')}곳 (전체 ${rows.length.toLocaleString('ko-KR')}곳) · 최근 신고순`;
    $('#seller-list').innerHTML = list.slice(0, shown).map((r) => {
      const tel = (r.tel || '').replace(/[^0-9+]/g, '');
      const added = hasClientFrom(r.key);
      return `<div class="item">
        <div class="main">
          <div class="title">${esc(r.name)}${r.isNew ? '<span class="badge new">신규</span>' : ''}${r.status ? `<span class="badge ${isActive(r) ? '' : 'due'}">${esc(r.status)}</span>` : ''}</div>
          <div class="sub">${esc([r.ceo, r.items, r.method, r.regdate ? '신고 ' + fmtDate(r.regdate) : ''].filter(Boolean).join(' · ')) || '&nbsp;'}</div>
          <div class="sub">${esc(r.addr)}</div>
        </div>
        <div class="side">
          ${tel ? `<a href="tel:${tel}" aria-label="전화">${ICON.phone}</a>` : ''}
          ${r.email && !r.email.includes('*') ? `<a href="mailto:${esc(r.email)}" aria-label="메일">${ICON.mail}</a>` : ''}
          <button data-add-seller="${esc(r.key)}" aria-label="내 고객에 담기" ${added ? 'disabled' : ''}>${added ? ICON.check : ICON.plus}</button>
        </div>
      </div>`;
    }).join('') || '<div class="empty">조건에 맞는 업체가 없습니다.</div>';
    $('#seller-more').hidden = list.length <= shown;
  }

  // 지역 선택: 한 군·시 자료면 읍·면별, 여러 지역이면 시·도별
  function renderRegions() {
    const counts = {};
    rows.forEach((r) => { const k = r.town || r.region; if (k) counts[k] = (counts[k] || 0) + 1; });
    const cur = $('#seller-region').value;
    $('#seller-region').innerHTML = '<option value="">전체 읍·면</option>' +
      Object.keys(counts).sort().map((k) => `<option value="${k}">${k} (${counts[k].toLocaleString('ko-KR')})</option>`).join('');
    $('#seller-region').value = counts[cur] ? cur : '';
    const newCount = rows.filter((r) => r.isNew).length;
    $('#seller-new-wrap').hidden = !newCount;
    $('#seller-new-count').textContent = newCount ? `(${newCount})` : '';
  }

  function renderMeta() {
    const el = $('#seller-meta');
    if (!el) return;
    if (fetching) return;
    if (meta?.fetchedAt) {
      const d = new Date(meta.fetchedAt);
      setFetchStatus('');
      el.textContent = `${meta.area || FTC_AREA} ${Number(meta.count || 0).toLocaleString('ko-KR')}곳 · ${d.toLocaleDateString('ko-KR')} ${d.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })}에 받음`
        + (meta.latestRegDate ? ` · 최근 신고 ${fmtDate(meta.latestRegDate)}` : '');
    } else if (rows?.length) {
      el.textContent = `직접 불러온 업체 ${rows.length.toLocaleString('ko-KR')}곳`;
    } else {
      el.textContent = isNative() ? '아직 받은 자료가 없습니다.' : '공정위 자료는 설치된 앱에서 받을 수 있습니다.';
    }
  }

  async function render() {
    await ensureLoaded();
    const has = rows.length > 0;
    $('#seller-tools').hidden = !has;
    renderMeta();
    if (has) { renderRegions(); renderList(); }
  }

  function bind() {
    $('#ftc-fetch').addEventListener('click', () => fetchFtc().catch(() => {}));
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
    ['#seller-region', '#seller-active', '#seller-phone', '#seller-new'].forEach((s) => $(s).addEventListener('change', rerender));
    $('#seller-more').addEventListener('click', () => { shown += PAGE; renderList(); });
    $('#seller-list').addEventListener('click', (e) => {
      const b = e.target.closest('[data-add-seller]');
      if (!b) return;
      const r = rows.find((x) => x.key === b.dataset.addSeller);
      if (r && window.cph.addClientFrom(r)) { b.innerHTML = ICON.check; b.disabled = true; }
    });
    $('#seller-clear').addEventListener('click', async () => {
      if (!confirm('받은 업체 목록을 모두 삭제할까요? (내 고객에 담은 업체는 남습니다)')) return;
      await idb.del(KEY); await idb.del(META);
      rows = []; meta = null;
      await render();
      window.cph.toast('삭제했습니다');
    });

    // 앱을 켤 때: 공정위가 갱신한 뒤(매주 일요일 오전) 아직 안 받았으면 조용히 새로 받음
    if (isNative()) {
      setTimeout(async () => {
        await ensureLoaded();
        if (isStale()) fetchFtc({ silent: true }).catch(() => {});
      }, 5000);
    }
  }

  window.cphSellers = { render, fetchFtc, _parseCsv: parseCsv, _toRecords: toRecords, _decode: decode, _lastSunday: lastSundayNoonKST, _townOf: townOf };
  document.addEventListener('DOMContentLoaded', bind);
})();
