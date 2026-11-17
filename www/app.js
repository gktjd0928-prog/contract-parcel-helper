(() => {
  'use strict';

  // ---------- 저장소 ----------
  const KEYS = {
    tariff: 'cph_tariff_v2',
    profile: 'cph_profile_v1',
    quotes: 'cph_quotes_v1',
    clients: 'cph_clients_v1',
    current: 'cph_current_v2'
  };
  const store = {
    get(key, fallback) {
      try {
        const raw = localStorage.getItem(key);
        return raw == null ? fallback : JSON.parse(raw);
      } catch (e) { return fallback; }
    },
    set(key, value) {
      try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { toast('저장 공간에 쓸 수 없습니다'); }
    }
  };

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const won = (n) => Number(n || 0).toLocaleString('ko-KR');
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  const todayISO = () => {
    const d = new Date();
    return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  };
  const clone = (o) => JSON.parse(JSON.stringify(o));
  const toInt = (v) => {
    const n = parseInt(String(v ?? '').replace(/[^0-9]/g, ''), 10);
    return Number.isFinite(n) ? n : null;
  };

  // ---------- 요금 데이터 (기본값 + 사용자 수정값) ----------
  let tariff;
  function loadTariff() {
    tariff = clone(window.DEFAULT_TARIFF);
    const o = store.get(KEYS.tariff, null);
    if (o) {
      if (Array.isArray(o.rates) && o.rates.length === tariff.rates.length) tariff.rates = o.rates;
      if (o.amounts) {
        tariff.discounts.forEach((d) => { if (o.amounts[d.id] != null) d.amount = o.amounts[d.id]; });
        tariff.steps.forEach((s) => { if (o.amounts[s.id] != null) s.max = o.amounts[s.id]; });
      }
      if (Array.isArray(o.limits) && o.limits.length === tariff.limits.length) tariff.limits = o.limits;
    }
  }
  function saveTariffOverrides() {
    const amounts = {};
    tariff.discounts.forEach((d) => { amounts[d.id] = d.amount; });
    tariff.steps.forEach((s) => { amounts[s.id] = s.max; });
    store.set(KEYS.tariff, { rates: tariff.rates, amounts, limits: tariff.limits });
  }
  const discountById = (id) => tariff.discounts.find((d) => d.id === id);
  loadTariff();

  // ---------- 견적 상태 ----------
  const blankQuote = () => ({
    id: null, clientId: null, client: '',
    volume: window.DEFAULT_TARIFF.defaultVolume ?? 0, years: 0,
    checked: (window.DEFAULT_TARIFF.defaultChecked || []).slice(),
    oneSpec: {}, steps: {},
    opt15: false, manual: false, manualRates: {},
    qty: [0, 0, 0, 0, 0, 0],
    updatedAt: null
  });
  let quote = Object.assign(blankQuote(), store.get(KEYS.current, {}));
  const persistCurrent = () => store.set(KEYS.current, quote);

  function limitFor(years) {
    const sorted = tariff.limits.slice().sort((a, b) => b.minYears - a.minYears);
    const hit = sorted.find((l) => years >= l.minYears);
    return hit ? hit.amount : 0;
  }

  // 견적 계산: 순수 함수
  function compute(q) {
    const vol = Math.min(Math.max(0, q.volume | 0), tariff.rates.length - 1);
    const base = tariff.rates[vol];
    const perSpec = tariff.specs.map(() => 0);
    const applied = [];
    let inLimit = 0;
    let outLimit = 0;
    const discountableIdx = tariff.specs.map((s, i) => (s.discountable ? i : -1)).filter((i) => i >= 0);

    const apply = (name, amount, targets, outside) => {
      if (amount <= 0) return;
      targets.forEach((i) => { if (tariff.specs[i]) perSpec[i] += amount; });
      if (outside) outLimit += amount; else inLimit += amount;
      applied.push({ name, amount, outside, specs: targets.map((i) => tariff.specs[i].name) });
    };

    tariff.discounts.forEach((d) => {
      if (!(q.checked || []).includes(d.id) || vol < d.minVolume) return;
      if (d.years && !d.years.includes(q.years | 0)) return;   // 계약 기간이 맞지 않는 감액(신규·장기)은 적용 안 함
      let targets = d.specs || tariff.specs.map((s, i) => i);
      if (d.oneSpec) targets = [q.oneSpec?.[d.id] ?? 0];
      apply(d.name, d.amount, targets, d.outsideLimit);
    });
    tariff.steps.forEach((s) => {
      const amt = Math.min(s.max, (q.steps?.[s.id] | 0));
      if (vol < s.minVolume) return;
      apply(s.name, amt, s.specs || tariff.specs.map((x, i) => i), s.outsideLimit);
    });

    const manualVal = (key) => {
      if (!q.manual) return null;
      return toInt(q.manualRates?.[key]);
    };

    // 20kg·30kg 등 감액 불가 규격은 기준요금 그대로
    const rows = tariff.specs.map((s, i) => {
      const b = base[s.baseFrom];
      const disc = s.discountable ? perSpec[i] : 0;
      const auto = Math.max(0, b - disc);
      const m = manualVal(i);
      return { key: String(i), name: s.name, size: s.size, base: b, disc, auto, final: m ?? auto, manual: m != null, discountable: s.discountable };
    });
    if (q.opt15 && tariff.option15) {
      const o = tariff.option15;
      const from = rows[o.fromSpec];
      const auto = from.final + o.addOn;
      const m = manualVal('15');
      rows.splice(o.insertAfter + 1, 0, {
        key: '15', name: o.name, size: o.size, base: from.base + o.addOn, disc: from.disc,
        auto, final: m ?? auto, manual: m != null, discountable: from.discountable
      });
    }

    // 평균요금: 10원 미만 버림
    const qty = (q.qty || []).map((n) => Math.max(0, +n || 0));
    const avgOf = (idxs) => {
      const sum = idxs.reduce((a, i) => a + (qty[i] || 0), 0);
      if (!sum) return null;
      const finals = tariff.specs.map((s, i) => rows.find((r) => r.key === String(i)).final);
      const w = idxs.reduce((a, i) => a + finals[i] * (qty[i] || 0), 0) / sum;
      return Math.floor(w / 10) * 10;
    };

    const limit = limitFor(q.years | 0);
    return {
      rows, applied, inLimit, outLimit, total: inLimit + outLimit, limit, over: inLimit > limit,
      volumeLabel: tariff.volumes[vol],
      totalQty: qty.reduce((a, b) => a + b, 0),
      avg2: avgOf([0, 1]),
      avg5: avgOf([0, 1, 2])
    };
  }

  // ---------- 화면 전환 ----------
  const TITLES = { calc: '요금 계산', proposal: '제안서', crm: '고객 관리', guide: '업무지침', settings: '설정' };
  let currentView = 'calc';
  function showView(name) {
    currentView = name;
    $$('.view').forEach((v) => v.classList.toggle('active', v.id === 'view-' + name));
    $$('.tabbar button').forEach((b) => b.classList.toggle('active', b.dataset.view === name));
    $('#appbar-title').textContent = TITLES[name];
    $('#btn-reset').style.visibility = name === 'calc' ? 'visible' : 'hidden';
    if (name === 'proposal') renderProposal();
    if (name === 'crm') renderCrm();
    if (name === 'settings') renderSettings();
    if (name === 'guide' && window.cphGuide) window.cphGuide.render();
    window.scrollTo(0, 0);
  }

  // ---------- 계산 화면 ----------
  function renderCalcInputs() {
    $('#q-volume').innerHTML = tariff.volumes.map((v, i) => `<option value="${i}">${esc(v)}</option>`).join('');
    $('#q-client').value = quote.client;
    $('#q-volume').value = String(quote.volume);
    $('#q-years').value = String(quote.years);
    $('#opt-15').checked = !!quote.opt15;
    $('#opt-manual').checked = !!quote.manual;
    renderQty();
  }

  // 계약 기간 선택값(0·1·3)이 이 감액에 맞는지
  const YEARS_LABEL = { 0: '계약 1년 미만(신규)만', 1: '계약 1년 이상만', 3: '계약 3년 이상만' };
  const yearsOk = (d, years) => !d.years || d.years.includes(years | 0);

  function discountRow(d, vol) {
    const volOk = vol >= d.minVolume;
    const yrOk = yearsOk(d, quote.years);
    const disabled = !volOk || !yrOk;
    const checked = quote.checked.includes(d.id) && !disabled;
    const meta = [
      d.outsideLimit ? '한도 제외' : null,
      d.specs ? d.specs.map((i) => tariff.specs[i].name).join('·') + '만' : null,
      !volOk ? tariff.volumes[d.minVolume] + '부터' : null,
      !yrOk ? d.years.map((y) => YEARS_LABEL[y]).join(', ') : null
    ].filter(Boolean).join(' · ');
    const specPicker = d.oneSpec && checked
      ? `<select data-onespec="${d.id}" aria-label="간편접수 적용 규격">${tariff.specs.map((s, i) => `<option value="${i}" ${(quote.oneSpec[d.id] ?? 0) == i ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}</select>`
      : '';
    return `<label class="disc ${disabled ? 'disabled' : ''}">
      <input type="checkbox" data-disc="${d.id}" ${checked ? 'checked' : ''} ${disabled ? 'disabled' : ''}>
      <span class="name">${esc(d.name)}${meta ? `<div class="meta">${esc(meta)}</div>` : ''}</span>
      ${specPicker}
      <span class="amt">-${won(d.amount)}</span>
    </label>`;
  }

  function renderDiscounts() {
    const vol = quote.volume | 0;
    $('#discount-sections').innerHTML = tariff.sections.map((sec) => `
      <h2 class="section-title">${esc(sec.title)}${sec.ids.some((id) => discountById(id)?.group === 'tenure') ? ' <small>신규·장기 중 하나만</small>' : ''}</h2>
      <div class="card">${sec.ids.map((id) => discountById(id)).filter(Boolean).map((d) => discountRow(d, vol)).join('')}</div>
    `).join('');

    $('#step-list').innerHTML = tariff.steps.map((s) => {
      const disabled = vol < s.minVolume;
      const val = disabled ? 0 : Math.min(s.max, quote.steps[s.id] | 0);
      const meta = [
        s.desc,
        `최대 ${won(s.max)}원`,
        s.outsideLimit ? '한도 제외' : '한도 적용',
        disabled ? tariff.volumes[s.minVolume] + '부터' : null
      ].filter(Boolean).join(' · ');
      return `<div class="disc ${disabled ? 'disabled' : ''}">
        <span class="name">${esc(s.name)}<div class="meta">${esc(meta)}</div></span>
        <div class="stepper">
          <button type="button" data-step="${s.id}" data-dir="-1" ${disabled ? 'disabled' : ''} aria-label="${esc(s.name)} 줄이기">−</button>
          <output>${won(val)}원</output>
          <button type="button" data-step="${s.id}" data-dir="1" ${disabled ? 'disabled' : ''} aria-label="${esc(s.name)} 늘리기">＋</button>
        </div>
      </div>`;
    }).join('');
  }

  function renderResult() {
    const r = compute(quote);
    const st = $('#limit-status');
    const sum = `한도 적용 ${won(r.inLimit)}원 · 한도 제외 ${won(r.outLimit)}원 · 합계 ${won(r.total)}원`;
    if (r.total === 0) st.innerHTML = '';
    else if (r.over) st.innerHTML = `<div class="status bad">⚠ 감액 한도 초과 (한도 ${won(r.limit)}원)<br>${sum}</div>`;
    else st.innerHTML = `<div class="status ok">✓ 적정 감액 (한도 ${won(r.limit)}원 이내)<br>${sum}</div>`;

    $('#result-table').innerHTML = `
      <thead><tr><th>규격</th><th>기준요금</th><th>감액</th><th>제안요금</th></tr></thead>
      <tbody>${r.rows.map((row) => `
        <tr>
          <td>${esc(row.name)}<div class="meta">${esc(row.size)}</div></td>
          <td>${won(row.base)}</td>
          <td class="minus">${row.discountable ? (row.disc ? '-' + won(row.disc) : '0') : '해당 없음'}</td>
          <td class="final ${row.manual ? 'manual' : ''}">${quote.manual
            ? `<input class="manual-input" inputmode="numeric" data-manual="${row.key}" value="${esc(quote.manualRates[row.key] ?? '')}" placeholder="${won(row.auto)}" aria-label="${esc(row.name)} 제안요금 직접 입력">`
            : won(row.final)}</td>
        </tr>`).join('')}
      </tbody>`;
    renderAverages(r);
  }

  function renderQty() {
    $('#qty-grid').innerHTML = tariff.specs.map((s, i) => `
      <label class="field"><span>${esc(s.name)}</span>
        <input inputmode="numeric" data-qty="${i}" value="${quote.qty[i] || ''}" placeholder="0">
      </label>`).join('');
  }
  function renderAverages(r) {
    $('#avg-box').innerHTML = `
      <div><dt>총 물량</dt><dd>${won(r.totalQty)}통</dd></div>
      <div><dt>2kg 평균<small>초소형+2kg</small></dt><dd>${r.avg2 == null ? '-' : won(r.avg2) + '원'}</dd></div>
      <div><dt>5kg 평균<small>초소형~5kg</small></dt><dd>${r.avg5 == null ? '-' : won(r.avg5) + '원'}</dd></div>`;
  }

  function refreshCalc() {
    renderDiscounts();
    renderResult();
    persistCurrent();
  }

  function bindCalc() {
    $('#q-client').addEventListener('input', (e) => { quote.client = e.target.value; persistCurrent(); });
    $('#q-volume').addEventListener('change', (e) => { quote.volume = +e.target.value; refreshCalc(); });
    $('#q-years').addEventListener('change', (e) => { quote.years = +e.target.value; refreshCalc(); });
    $('#opt-15').addEventListener('change', (e) => { quote.opt15 = e.target.checked; refreshCalc(); });
    $('#opt-manual').addEventListener('change', (e) => { quote.manual = e.target.checked; refreshCalc(); });

    $('#discount-sections').addEventListener('change', (e) => {
      const id = e.target.dataset.disc;
      if (id) {
        const d = discountById(id);
        quote.checked = quote.checked.filter((x) => x !== id);
        if (e.target.checked) {
          if (d.group) {
            const same = tariff.discounts.filter((x) => x.group === d.group).map((x) => x.id);
            quote.checked = quote.checked.filter((x) => !same.includes(x));
          }
          quote.checked.push(id);
        }
        refreshCalc();
      }
      const one = e.target.dataset.onespec;
      if (one) { quote.oneSpec[one] = +e.target.value; refreshCalc(); }
    });
    // 라벨 안의 select를 눌러도 체크가 토글되지 않게
    $('#discount-sections').addEventListener('click', (e) => { if (e.target.tagName === 'SELECT') e.preventDefault(); });

    $('#step-list').addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-step]');
      if (!btn) return;
      const s = tariff.steps.find((x) => x.id === btn.dataset.step);
      const next = (quote.steps[s.id] | 0) + s.unit * (+btn.dataset.dir);
      quote.steps[s.id] = Math.max(0, Math.min(s.max, next));
      refreshCalc();
    });

    // 수동 요금 입력: 입력 중에는 표를 다시 그리지 않음 (포커스 유지)
    $('#result-table').addEventListener('input', (e) => {
      const k = e.target.dataset.manual;
      if (k == null) return;
      const v = toInt(e.target.value);
      if (v == null) delete quote.manualRates[k]; else quote.manualRates[k] = v;
      persistCurrent();
      renderAverages(compute(quote));
    });
    $('#result-table').addEventListener('change', (e) => { if (e.target.dataset.manual != null) renderResult(); });

    $('#qty-grid').addEventListener('input', (e) => {
      const i = e.target.dataset.qty;
      if (i == null) return;
      quote.qty[i] = toInt(e.target.value) || 0;
      persistCurrent();
      renderAverages(compute(quote));
    });

    $('#btn-reset').addEventListener('click', () => {
      if (!confirm('입력한 내용을 지우고 새 견적을 시작할까요?')) return;
      quote = blankQuote();
      renderCalcInputs();
      refreshCalc();
    });
    $('#btn-to-proposal').addEventListener('click', () => showView('proposal'));
    $('#btn-save-quote').addEventListener('click', saveQuote);

    $('#quote-list').addEventListener('click', (e) => {
      const del = e.target.closest('[data-del-quote]');
      if (del) {
        e.stopPropagation();
        if (!confirm('이 견적을 삭제할까요?')) return;
        store.set(KEYS.quotes, quotes().filter((q) => q.id !== del.dataset.delQuote));
        renderQuotes();
        return;
      }
      const open = e.target.closest('[data-open-quote]');
      if (open) {
        const q = quotes().find((x) => x.id === open.dataset.openQuote);
        if (q) {
          quote = Object.assign(blankQuote(), clone(q));
          renderCalcInputs();
          refreshCalc();
          window.scrollTo({ top: 0, behavior: 'smooth' });
          toast('견적을 불러왔습니다');
        }
      }
    });
  }

  // ---------- 저장된 견적 ----------
  const quotes = () => store.get(KEYS.quotes, []);
  function saveQuote() {
    if (!quote.client.trim()) { toast('고객(업체)명을 입력하세요'); $('#q-client').focus(); return; }
    const list = quotes();
    quote.id = quote.id || uid();
    quote.updatedAt = new Date().toISOString();
    const idx = list.findIndex((q) => q.id === quote.id);
    if (idx >= 0) list[idx] = clone(quote); else list.unshift(clone(quote));
    store.set(KEYS.quotes, list.slice(0, 200));
    persistCurrent();
    renderQuotes();
    toast('견적을 저장했습니다');
  }
  function renderQuotes() {
    const list = quotes();
    $('#quote-list').innerHTML = list.length ? list.map((q) => {
      const r = compute(Object.assign(blankQuote(), q));
      const two = r.rows.find((x) => x.key === '1');
      return `<div class="item">
        <div class="main" data-open-quote="${q.id}">
          <div class="title">${esc(q.client)}</div>
          <div class="sub">${esc(r.volumeLabel)} · 2kg ${won(two.final)}원 · ${new Date(q.updatedAt).toLocaleDateString('ko-KR')}</div>
        </div>
        <div class="side"><button data-del-quote="${q.id}" aria-label="삭제">${ICON.trash}</button></div>
      </div>`;
    }).join('') : '<div class="empty">저장된 견적이 없습니다.</div>';
  }

  // ---------- 제안서 ----------
  const profile = () => store.get(KEYS.profile, { office: '', name: '', phone: '' });

  function buildMessage() {
    const r = compute(quote);
    const p = profile();
    const lines = [];
    lines.push(`[우체국 계약소포 요금 제안] ${quote.client || '고객'}님`);
    lines.push('');
    lines.push(`계약 물량: 월 ${r.volumeLabel}`);
    r.rows.forEach((row) => lines.push(`· ${row.name}(${row.size}): ${won(row.final)}원`));
    if (r.avg2 != null) lines.push(`· 2kg 평균: ${won(r.avg2)}원`);
    if (r.avg5 != null) lines.push(`· 5kg 평균: ${won(r.avg5)}원`);
    lines.push('');
    tariff.notes.forEach((n) => {
      lines.push(`■ ${n.title}`);
      n.items.forEach((it) => lines.push(`- ${it}`));
    });
    if (p.name || p.office) {
      lines.push('');
      lines.push(`계약문의: ${`${p.office} ${p.name}`.trim()}${p.phone ? ` ${p.phone}` : ''}`);
    }
    return lines.join('\n');
  }

  function renderProposal() {
    const r = compute(quote);
    const p = profile();
    $('#proposal').innerHTML = `
      <div class="p-kicker">우체국 계약소포</div>
      <h2>계약소포 요금 제안서</h2>
      <div class="to">2026 개정 요금체계 기준</div>
      <dl class="kv">
        <dt>국명</dt><dd>${esc(p.office || '-')}</dd>
        <dt>업체명</dt><dd>${esc(quote.client || '-')}</dd>
        <dt>계약 물량</dt><dd>월 ${esc(r.volumeLabel)}</dd>
        <dt>작성일</dt><dd>${todayISO()}</dd>
      </dl>
      <h3 class="p-h">1. 규격별 제안 요금</h3>
      <div class="scroll-x"><table class="rate-table p-table">
        <thead><tr><th>구분</th>${r.rows.map((row) => `<th>${esc(row.name)}<div class="meta">${esc(row.size)}</div></th>`).join('')}</tr></thead>
        <tbody><tr><td>제안요금</td>${r.rows.map((row) => `<td class="final">${won(row.final)}</td>`).join('')}</tr></tbody>
      </table></div>
      ${(r.avg2 != null || r.avg5 != null) ? `<p class="p-avg">${r.avg2 != null ? `2kg 평균 <b>${won(r.avg2)}원</b>` : ''}${r.avg2 != null && r.avg5 != null ? ' · ' : ''}${r.avg5 != null ? `5kg 평균 <b>${won(r.avg5)}원</b>` : ''}</p>` : ''}
      ${r.over ? `<div class="status bad">⚠ 감액 한도(${won(r.limit)}원)를 초과했습니다. 발송 전 조정하세요.</div>` : ''}
      ${tariff.notes.map((n, i) => `
        <h3 class="p-h">${i + 2}. ${esc(n.title)}</h3>
        <ul>${n.items.map((it) => `<li>${esc(it)}</li>`).join('')}</ul>`).join('')}
      <div class="sign">계약문의 · ${esc(p.office || '소속 미입력')} ${esc(p.name || '')}${p.phone ? ' · ' + esc(p.phone) : ''}</div>`;

    const client = quote.clientId ? clients().find((c) => c.id === quote.clientId) : null;
    if (client && client.phone && !$('#p-phone').value) $('#p-phone').value = client.phone;
    $('#p-message').value = buildMessage();
  }

  async function copyText(text) {
    try { await navigator.clipboard.writeText(text); return true; }
    catch (e) {
      const ta = document.createElement('textarea');
      ta.value = text; document.body.appendChild(ta); ta.select();
      const ok = document.execCommand('copy'); ta.remove(); return ok;
    }
  }

  function bindProposal() {
    $('#btn-copy').addEventListener('click', async () => {
      toast((await copyText($('#p-message').value)) ? '복사했습니다' : '복사하지 못했습니다');
    });
    $('#btn-share').addEventListener('click', async () => {
      const text = $('#p-message').value;
      const title = '계약소포 요금 제안';
      try {
        const Share = window.Capacitor?.Plugins?.Share;
        if (Share) await Share.share({ title, text, dialogTitle: '제안서 공유' });
        else if (navigator.share) await navigator.share({ title, text });
        else { await copyText(text); toast('공유를 지원하지 않아 복사했습니다'); }
      } catch (e) { /* 사용자가 공유 취소 */ }
    });
    $('#btn-sms').addEventListener('click', () => {
      const phone = $('#p-phone').value.replace(/[^0-9+]/g, '');
      if (!phone) { toast('받는 사람 번호를 입력하세요'); $('#p-phone').focus(); return; }
      const sep = /iPhone|iPad|iPod/.test(navigator.userAgent) ? '&' : '?';
      window.location.href = `sms:${phone}${sep}body=${encodeURIComponent($('#p-message').value)}`;
    });
  }

  // ---------- 고객 관리 ----------
  const STATUS = [
    ['lead', '발굴'], ['meet', '상담'], ['propose', '제안'], ['signed', '계약'], ['hold', '보류']
  ];
  const statusName = (k) => (STATUS.find((s) => s[0] === k) || STATUS[0])[1];
  const clients = () => store.get(KEYS.clients, []);
  const saveClients = (list) => store.set(KEYS.clients, list);

  function renderCrm() {
    const list = clients();
    $('#crm-stats').innerHTML = STATUS.map(([k, n]) => `<div><b>${list.filter((c) => c.status === k).length}</b><span>${n}</span></div>`).join('');
    const q = $('#crm-search').value.trim().toLowerCase();
    const f = $('#crm-filter').value;
    const today = todayISO();
    const shown = list
      .filter((c) => !f || c.status === f)
      .filter((c) => !q || [c.name, c.contact, c.phone, c.memo, c.address].join(' ').toLowerCase().includes(q))
      .sort((a, b) => (a.nextDate || '9999').localeCompare(b.nextDate || '9999'));
    $('#crm-list').innerHTML = shown.length ? shown.map((c) => {
      const due = c.nextDate && c.nextDate <= today && c.status !== 'signed';
      const tel = (c.phone || '').replace(/[^0-9+]/g, '');
      return `<div class="item">
        <div class="main" data-edit-client="${c.id}">
          <div class="title">${esc(c.name)}<span class="badge">${statusName(c.status)}</span>${due ? '<span class="badge due">연락할 날</span>' : ''}</div>
          <div class="sub">${esc([c.contact, c.phone, c.nextDate ? '다음 ' + c.nextDate : '', c.memo].filter(Boolean).join(' · ')) || '&nbsp;'}</div>
        </div>
        ${tel ? `<div class="side"><a href="tel:${tel}" aria-label="전화">${ICON.phone}</a><a href="sms:${tel}" aria-label="문자">${ICON.sms}</a></div>` : ''}
      </div>`;
    }).join('') : `<div class="empty">${list.length ? '조건에 맞는 고객이 없습니다.' : '＋ 버튼으로 고객을 추가하거나, [업체 찾기]에서 업체를 담으세요.'}</div>`;
  }

  function openClient(id) {
    const form = $('#client-form');
    const c = id ? clients().find((x) => x.id === id) : null;
    form.reset();
    form.id.value = c ? c.id : '';
    ['name', 'contact', 'phone', 'address', 'memo', 'nextDate'].forEach((k) => { form[k].value = c ? (c[k] || '') : ''; });
    form.status.value = c ? c.status : 'lead';
    form.volume.value = c ? String(c.volume ?? 0) : '0';
    $('#client-sheet-title').textContent = c ? '고객 정보' : '고객 추가';
    $('#btn-del-client').style.display = c ? '' : 'none';
    $('#client-sheet').hidden = false;
    setTimeout(() => form.name.focus(), 50);
  }
  const closeClient = () => { $('#client-sheet').hidden = true; };

  function readClientForm() {
    const form = $('#client-form');
    return {
      id: form.id.value || uid(),
      name: form.name.value.trim(),
      contact: form.contact.value.trim(),
      phone: form.phone.value.trim(),
      address: form.address.value.trim(),
      status: form.status.value,
      volume: +form.volume.value,
      nextDate: form.nextDate.value,
      memo: form.memo.value.trim(),
      updatedAt: new Date().toISOString()
    };
  }
  function upsertClient(c) {
    const list = clients();
    const i = list.findIndex((x) => x.id === c.id);
    if (i >= 0) list[i] = Object.assign(list[i], c); else list.push(c);
    saveClients(list);
  }

  // 업체 찾기 → 내 고객 담기
  function addClientFrom(seller) {
    const list = clients();
    const dup = list.find((c) => c.sourceKey && c.sourceKey === seller.key);
    if (dup) { toast('이미 내 고객에 있습니다'); return false; }
    list.push({
      id: uid(), sourceKey: seller.key,
      name: seller.name, contact: seller.ceo || '', phone: seller.tel || '', address: seller.addr || '',
      status: 'lead', volume: 0, nextDate: '',
      memo: [seller.items, seller.email].filter(Boolean).join(' · '),
      updatedAt: new Date().toISOString()
    });
    saveClients(list);
    toast('내 고객에 담았습니다');
    return true;
  }
  const hasClientFrom = (key) => clients().some((c) => c.sourceKey === key);

  function setSegment(seg) {
    $$('.segment button').forEach((b) => b.classList.toggle('active', b.dataset.seg === seg));
    $('#seg-mine').hidden = seg !== 'mine';
    $('#seg-sellers').hidden = seg !== 'sellers';
    if (seg === 'mine') renderCrm();
    if (seg === 'sellers' && window.cphSellers) window.cphSellers.render();
  }

  function bindCrm() {
    $('#crm-filter').innerHTML = '<option value="">전체</option>' + STATUS.map(([k, n]) => `<option value="${k}">${n}</option>`).join('');
    const form = $('#client-form');
    form.status.innerHTML = STATUS.map(([k, n]) => `<option value="${k}">${n}</option>`).join('');
    form.volume.innerHTML = tariff.volumes.map((v, i) => `<option value="${i}">${esc(v)}</option>`).join('');

    $$('.segment button').forEach((b) => b.addEventListener('click', () => setSegment(b.dataset.seg)));
    $('#crm-search').addEventListener('input', renderCrm);
    $('#crm-filter').addEventListener('change', renderCrm);
    $('#btn-add-client').addEventListener('click', () => openClient(null));
    $('#crm-list').addEventListener('click', (e) => {
      const m = e.target.closest('[data-edit-client]');
      if (m) openClient(m.dataset.editClient);
    });
    $('#client-sheet').addEventListener('click', (e) => {
      if (e.target.id === 'client-sheet' || e.target.closest('[data-close]')) closeClient();
    });
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const c = readClientForm();
      if (!c.name) { toast('업체명을 입력하세요'); return; }
      upsertClient(c);
      closeClient();
      renderCrm();
      toast('저장했습니다');
    });
    $('#btn-del-client').addEventListener('click', () => {
      const id = form.id.value;
      if (!id || !confirm('이 고객을 삭제할까요?')) return;
      saveClients(clients().filter((c) => c.id !== id));
      closeClient();
      renderCrm();
    });
    $('#btn-quote-client').addEventListener('click', () => {
      const c = readClientForm();
      if (!c.name) { toast('업체명을 입력하세요'); return; }
      upsertClient(c);
      closeClient();
      quote = Object.assign(blankQuote(), { clientId: c.id, client: c.name, volume: c.volume });
      renderCalcInputs();
      refreshCalc();
      showView('calc');
    });
  }

  // ---------- 설정 ----------
  function renderSettings() {
    const p = profile();
    $('#s-office').value = p.office || '';
    $('#s-name').value = p.name || '';
    $('#s-phone').value = p.phone || '';
    $('#tariff-version').textContent = tariff.version;

    // 열마다 그 열을 기준요금으로 쓰는 마지막 규격 이름 (2kg 열은 초소형과 공유)
    const heads = tariff.rates[0].map((_, c) => tariff.specs.filter((s) => s.baseFrom === c).pop());
    $('#tariff-table').innerHTML = `
      <thead><tr><th>물량</th>${heads.map((s) => `<th>${esc(s.name)}</th>`).join('')}</tr></thead>
      <tbody>${tariff.rates.map((row, r) => `<tr><td>${esc(tariff.volumes[r])}</td>${row.map((v, c) => `<td><input inputmode="numeric" data-r="${r}" data-c="${c}" value="${v}" aria-label="${esc(tariff.volumes[r])} ${esc(heads[c]?.name || '')}"></td>`).join('')}</tr>`).join('')}</tbody>`;

    $('#discount-editor').innerHTML =
      tariff.discounts.map((d) => editorRow(d.id, d.name, d.amount)).join('') +
      tariff.steps.map((s) => editorRow(s.id, s.name + ' (최대)', s.max)).join('') +
      tariff.limits.map((l, i) => editorRow('limit:' + i, `감액 한도 — 계약 ${l.minYears ? l.minYears + '년 이상' : '1년 미만'}`, l.amount)).join('');
  }
  const editorRow = (id, name, value) => `<label class="disc"><span class="name">${esc(name)}</span>
      <input class="amt-input" inputmode="numeric" data-amt="${id}" value="${value}"> 원</label>`;

  function bindSettings() {
    ['office', 'name', 'phone'].forEach((k) => {
      $('#s-' + k).addEventListener('input', (e) => {
        const p = profile(); p[k] = e.target.value.trim(); store.set(KEYS.profile, p);
      });
    });
    $('#tariff-table').addEventListener('change', (e) => {
      const t = e.target;
      if (t.dataset.r == null) return;
      const v = toInt(t.value);
      if (v == null) { t.value = tariff.rates[t.dataset.r][t.dataset.c]; return; }
      tariff.rates[t.dataset.r][t.dataset.c] = v;
      t.value = v;
      saveTariffOverrides();
      refreshCalc();
      toast('기준요금을 수정했습니다');
    });
    $('#discount-editor').addEventListener('change', (e) => {
      const id = e.target.dataset.amt;
      if (!id) return;
      const v = toInt(e.target.value);
      if (v == null) { renderSettings(); return; }
      if (id.startsWith('limit:')) tariff.limits[+id.slice(6)].amount = v;
      else {
        const d = discountById(id);
        if (d) d.amount = v;
        const s = tariff.steps.find((x) => x.id === id);
        if (s) s.max = Math.floor(v / s.unit) * s.unit;
      }
      saveTariffOverrides();
      renderSettings();
      refreshCalc();
      toast('감액 금액을 수정했습니다');
    });
    $('#btn-tariff-reset').addEventListener('click', () => {
      if (!confirm('요금표와 감액 금액을 기본값으로 되돌릴까요?')) return;
      localStorage.removeItem(KEYS.tariff);
      loadTariff();
      renderSettings();
      refreshCalc();
      toast('기본값으로 복원했습니다');
    });

    $('#btn-export').addEventListener('click', async () => {
      const data = {
        app: 'contract-parcel-helper', exportedAt: new Date().toISOString(),
        profile: profile(), clients: clients(), quotes: quotes(), tariff: store.get(KEYS.tariff, null)
      };
      const text = JSON.stringify(data, null, 2);
      const name = `계약소포도우미-백업-${todayISO()}.json`;
      try {
        const file = new File([text], name, { type: 'application/json' });
        const Share = window.Capacitor?.Plugins?.Share;
        if (Share) { await Share.share({ title: '백업', text, dialogTitle: '백업 데이터 보내기' }); return; }
        if (navigator.canShare && navigator.canShare({ files: [file] })) { await navigator.share({ files: [file], title: '백업' }); return; }
        const a = document.createElement('a');
        a.href = URL.createObjectURL(file); a.download = name; a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 5000);
      } catch (e) { /* 취소 */ }
    });
    $('#btn-import').addEventListener('change', async (e) => {
      const f = e.target.files[0];
      e.target.value = '';
      if (!f) return;
      try {
        const data = JSON.parse(await f.text());
        if (data.app !== 'contract-parcel-helper') throw new Error('형식이 다릅니다');
        if (!confirm(`고객 ${data.clients?.length || 0}명, 견적 ${data.quotes?.length || 0}건을 가져옵니다. 현재 데이터를 덮어쓸까요?`)) return;
        if (data.profile) store.set(KEYS.profile, data.profile);
        if (Array.isArray(data.clients)) saveClients(data.clients);
        if (Array.isArray(data.quotes)) store.set(KEYS.quotes, data.quotes);
        if (data.tariff) store.set(KEYS.tariff, data.tariff); else localStorage.removeItem(KEYS.tariff);
        loadTariff();
        renderSettings(); renderQuotes(); refreshCalc();
        toast('가져오기를 완료했습니다');
      } catch (err) { toast('가져오기 실패: ' + err.message); }
    });
  }

  // ---------- 공통 ----------
  let toastTimer;
  function toast(msg) {
    const t = $('#toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), 1900);
  }

  function bindNativeBack() {
    const App = window.Capacitor?.Plugins?.App;
    if (!App) return;
    App.addListener('backButton', () => {
      const openSheet = document.querySelector('.sheet-backdrop:not([hidden])');
      if (openSheet) openSheet.hidden = true;   // 열린 팝업(고객·업체 상세)부터 닫기
      else if (currentView !== 'calc') showView('calc');
      else App.exitApp();
    });
  }

  function init() {
    loadTariff();
    $$('.tabbar button').forEach((b) => b.addEventListener('click', () => showView(b.dataset.view)));
    renderCalcInputs();
    bindCalc();
    bindProposal();
    bindCrm();
    bindSettings();
    bindNativeBack();
    refreshCalc();
    renderQuotes();
    showView('calc');
  }

  // 다른 모듈(업체 찾기·지침)과 테스트에서 쓰는 공용 기능
  window.cph = {
    toast, esc, won,
    get tariff() { return tariff; },
    limitFor,
    addClientFrom, hasClientFrom,
    compute: (q) => compute(Object.assign(blankQuote(), q))
  };
  document.addEventListener('DOMContentLoaded', init);
})();
