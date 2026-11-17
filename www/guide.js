// 업무지침: 앱에 포함한 업무처리지침 PDF 보기 + 본문 찾기(형광 표시) + 요금 산출 기준 요약
(() => {
  'use strict';
  const $ = (s) => document.querySelector(s);
  const PDF_URL = 'guide.pdf';
  const MAX_RENDERED = 8;          // 동시에 그려 둘 최대 쪽 수 (메모리 절약)

  const lib = window.pdfjsLib;
  if (lib) lib.GlobalWorkerOptions.workerSrc = 'vendor/pdf.worker.min.js';

  let doc = null;
  let opening = null;
  let pages = [];                  // { num, el, canvasBox, textLayer, scale, cssScale, rendered, rendering, textContent, items, lastSeen }
  let observer = null;
  let pageWidth = 0;

  // 찾기 상태
  let query = '';
  let matches = [];                // { page, start, end, perPageIndex }
  let current = -1;
  let indexReady = null;           // 모든 쪽 텍스트 색인 Promise

  // ---------- 요금 산출 기준 요약 ----------
  function renderRules() {
    const { esc, won, tariff } = window.cph;
    const t = tariff;
    const vol = (i) => t.volumes[i];
    const specNames = (d) => (d.specs ? d.specs.map((i) => t.specs[i].name).join('·') : '감액 가능한 전 규격');
    const discountRows = t.sections.map((sec) => `
      <h4>${esc(sec.title)}</h4>
      <table class="rule-table">
        <thead><tr><th>항목</th><th>금액</th><th>적용 물량</th><th>한도</th></tr></thead>
        <tbody>${sec.ids.map((id) => t.discounts.find((d) => d.id === id)).filter(Boolean).map((d) => `
          <tr><td>${esc(d.name)}${d.specs ? `<div class="meta">${esc(specNames(d))}</div>` : ''}${d.oneSpec ? '<div class="meta">선택한 1개 규격에만</div>' : ''}</td>
          <td>${won(d.amount)}원</td><td>${esc(vol(d.minVolume))}</td><td>${d.outsideLimit ? '제외' : '적용'}</td></tr>`).join('')}
        </tbody>
      </table>`).join('');
    const stepRows = t.steps.map((s) => `<tr><td>${esc(s.name)}<div class="meta">${esc(s.desc)} · ${esc(specNames(s))}</div></td><td>최대 ${won(s.max)}원<div class="meta">${s.unit}원 단위</div></td><td>${esc(vol(s.minVolume))}</td><td>${s.outsideLimit ? '제외' : '적용'}</td></tr>`).join('');
    const limits = t.limits.slice().sort((a, b) => a.minYears - b.minYears)
      .map((l) => `<li>계약 ${l.minYears ? l.minYears + '년 이상' : '1년 미만'}: <b>${won(l.amount)}원</b></li>`).join('');

    $('#guide-rules').innerHTML = `
      <h4>감액 한도</h4>
      <ul>${limits}</ul>
      <p class="meta">한도는 ‘한도 적용’ 항목의 합계에만 적용됩니다. 고객 운송·초소형·소상공인 감액은 한도에서 제외됩니다.</p>
      <h4>규격별 적용</h4>
      <ul>
        <li>초소형은 2kg 기준요금을 사용합니다.</li>
        <li>${t.specs.filter((s) => !s.discountable).map((s) => esc(s.name)).join('·')}은 감액 없이 기준요금을 적용합니다.</li>
        <li>15kg(140cm)은 10kg 제안요금에 ${won(t.option15.addOn)}원을 더합니다.</li>
        <li>신규(마)·장기(바) 감액은 그중 하나만 선택할 수 있고, 고객 운송(나-1·나-2)도 하나만 선택합니다.</li>
      </ul>
      ${discountRows}
      <h4>5·6. 단계 감액</h4>
      <table class="rule-table"><thead><tr><th>항목</th><th>금액</th><th>적용 물량</th><th>한도</th></tr></thead><tbody>${stepRows}</tbody></table>
      <h4>평균요금</h4>
      <ul>
        <li>2kg 평균 = (초소형·2kg 제안요금 × 각 물량)의 가중평균</li>
        <li>5kg 평균 = (초소형·2kg·5kg 제안요금 × 각 물량)의 가중평균</li>
        <li>평균요금은 10원 미만을 버립니다.</li>
      </ul>
      ${t.notes.map((n) => `<h4>${esc(n.title)}</h4><ul>${n.items.map((it) => `<li>${esc(it)}</li>`).join('')}</ul>`).join('')}
      <p class="meta">기준: ${esc(t.version)} · 금액은 [설정]에서 수정한 값이 반영됩니다.</p>`;
  }

  // ---------- PDF 열기 ----------
  async function openDoc() {
    if (doc) return doc;
    if (!opening) {
      opening = (async () => {
        if (!lib) throw new Error('PDF 뷰어를 불러오지 못했습니다');
        const res = await fetch(PDF_URL);
        if (!res.ok) throw new Error('지침 파일이 앱에 없습니다');
        const data = new Uint8Array(await res.arrayBuffer());
        doc = await lib.getDocument({
          data,
          cMapUrl: 'vendor/cmaps/',
          cMapPacked: true,
          standardFontDataUrl: 'vendor/standard_fonts/'
        }).promise;
        return doc;
      })();
      opening.catch(() => { opening = null; });
    }
    return opening;
  }

  async function buildPages() {
    const box = $('#guide-pages');
    box.innerHTML = '<div class="empty">지침을 여는 중...</div>';
    try {
      await openDoc();
    } catch (e) {
      box.innerHTML = `<div class="empty">${window.cph.esc(e.message)}</div>`;
      return;
    }
    pageWidth = Math.min(box.clientWidth || 360, 760);
    box.innerHTML = '';
    pages = [];
    const first = await doc.getPage(1);
    const v1 = first.getViewport({ scale: 1 });
    for (let n = 1; n <= doc.numPages; n++) {
      const el = document.createElement('div');
      el.className = 'pdf-page';
      el.dataset.page = n;
      // 실제 크기는 그릴 때 맞추고, 우선 1쪽 비율로 자리만 잡아 둠
      el.style.width = pageWidth + 'px';
      el.style.height = Math.round(pageWidth * v1.height / v1.width) + 'px';
      el.innerHTML = `<div class="pdf-canvas"></div><div class="textLayer"></div><span class="pdf-num">${n} / ${doc.numPages}</span>`;
      box.appendChild(el);
      pages.push({ num: n, el, canvasBox: el.firstChild, textLayer: el.children[1], rendered: false, rendering: null, textContent: null, items: null, lastSeen: 0 });
    }
    $('#guide-meta').textContent = `우체국 계약소포업무 처리지침 · ${doc.numPages}쪽`;

    observer?.disconnect();
    observer = new IntersectionObserver((entries) => {
      entries.forEach((en) => {
        if (!en.isIntersecting) return;
        const p = pages[+en.target.dataset.page - 1];
        p.lastSeen = performance.now();
        renderPage(p);
      });
    }, { rootMargin: '900px 0px' });
    pages.forEach((p) => observer.observe(p.el));
    indexReady = null;
  }

  async function getText(p) {
    if (!p.textContent) {
      const page = await doc.getPage(p.num);
      p.textContent = await page.getTextContent();
      p.items = p.textContent.items.filter((it) => it.str !== undefined).map((it) => it.str);
    }
    return p.items;
  }

  function renderPage(p) {
    if (p.rendered) return Promise.resolve();
    if (p.rendering) return p.rendering;
    p.rendering = (async () => {
      const page = await doc.getPage(p.num);
      const v1 = page.getViewport({ scale: 1 });
      const cssScale = pageWidth / v1.width;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const vpCss = page.getViewport({ scale: cssScale });
      const vpDev = page.getViewport({ scale: cssScale * dpr });
      p.el.style.height = Math.round(vpCss.height) + 'px';
      p.el.style.setProperty('--scale-factor', cssScale);

      const canvas = document.createElement('canvas');
      canvas.width = Math.floor(vpDev.width);
      canvas.height = Math.floor(vpDev.height);
      p.canvasBox.replaceChildren(canvas);
      await page.render({ canvasContext: canvas.getContext('2d'), viewport: vpDev }).promise;

      await getText(p);
      p.textLayer.replaceChildren();
      p.textDivs = [];
      const strs = [];
      await lib.renderTextLayer({
        textContentSource: p.textContent,
        container: p.textLayer,
        viewport: vpCss,
        textDivs: p.textDivs,
        textContentItemsStr: strs
      }).promise;
      p.rendered = true;
      applyHighlights(p);
      evictFarPages();
    })().finally(() => { p.rendering = null; });
    return p.rendering;
  }

  // 오래 안 본 쪽의 그림을 비워 메모리 절약
  function evictFarPages() {
    const live = pages.filter((p) => p.rendered);
    if (live.length <= MAX_RENDERED) return;
    live.sort((a, b) => a.lastSeen - b.lastSeen)
      .slice(0, live.length - MAX_RENDERED)
      .forEach((p) => {
        p.canvasBox.replaceChildren();
        p.textLayer.replaceChildren();
        p.textDivs = null;
        p.rendered = false;
      });
  }

  // ---------- 찾기 ----------
  // 공백을 무시하고 대소문자 구분 없이 비교. 정규화된 글자 → (항목 번호, 글자 위치) 대응표를 함께 만든다.
  function normalizeItems(items) {
    let text = '';
    const map = [];
    items.forEach((s, i) => {
      for (let j = 0; j < s.length; j++) {
        const c = s[j];
        if (/\s/.test(c)) continue;
        text += c.toLowerCase();
        map.push([i, j]);
      }
    });
    return { text, map };
  }
  const normQuery = (q) => q.replace(/\s+/g, '').toLowerCase();

  function ensureIndex() {
    if (!indexReady) {
      indexReady = (async () => {
        for (const p of pages) {
          await getText(p);
          p.norm = normalizeItems(p.items);
        }
      })();
    }
    return indexReady;
  }

  async function runSearch(q) {
    query = normQuery(q);
    matches = [];
    current = -1;
    if (!doc) await openGuide();
    if (!query) { refreshAllHighlights(); updateCount(); return; }
    $('#gs-count').textContent = '찾는 중…';
    await ensureIndex();
    if (normQuery($('#gs-input').value) !== query) return;   // 그 사이 검색어가 바뀜
    pages.forEach((p) => {
      let from = 0, k = 0;
      while (true) {
        const at = p.norm.text.indexOf(query, from);
        if (at < 0) break;
        matches.push({ page: p.num, start: at, end: at + query.length, perPageIndex: k++ });
        from = at + query.length;
      }
    });
    refreshAllHighlights();
    if (matches.length) await goTo(0); else updateCount();
  }

  function updateCount() {
    const el = $('#gs-count');
    if (!query) el.textContent = '';
    else if (!matches.length) el.textContent = '결과 없음';
    else el.textContent = `${current + 1} / ${matches.length}`;
    $('#gs-prev').disabled = $('#gs-next').disabled = matches.length < 2;
  }

  function refreshAllHighlights() {
    pages.forEach((p) => { if (p.rendered) applyHighlights(p); });
  }

  // 한 쪽의 글자층(span)에 형광 표시를 입힌다
  function applyHighlights(p) {
    if (!p.textDivs || !p.items) return;
    const per = new Map();     // 항목 번호 → [{from, to, cur}]
    if (query && p.norm) {
      matches.forEach((m, gi) => {
        if (m.page !== p.num) return;
        const byItem = new Map();
        for (let k = m.start; k < m.end; k++) {
          const [i, j] = p.norm.map[k];
          const r = byItem.get(i) || { from: j, to: j + 1 };
          r.from = Math.min(r.from, j); r.to = Math.max(r.to, j + 1);
          byItem.set(i, r);
        }
        byItem.forEach((r, i) => {
          if (!per.has(i)) per.set(i, []);
          per.get(i).push({ ...r, cur: gi === current });
        });
      });
    }
    p.textDivs.forEach((div, i) => {
      const s = p.items[i] ?? '';
      const ranges = per.get(i);
      if (!ranges) {
        if (div.dataset.hl) { div.textContent = s; delete div.dataset.hl; }
        return;
      }
      ranges.sort((a, b) => a.from - b.from);
      div.replaceChildren();
      let pos = 0;
      ranges.forEach((r) => {
        if (r.from > pos) div.append(s.slice(pos, r.from));
        const mark = document.createElement('mark');
        if (r.cur) mark.className = 'cur';
        mark.textContent = s.slice(Math.max(r.from, pos), r.to);
        div.append(mark);
        pos = Math.max(pos, r.to);
      });
      if (pos < s.length) div.append(s.slice(pos));
      div.dataset.hl = '1';
    });
  }

  async function goTo(i) {
    if (!matches.length) return;
    current = (i + matches.length) % matches.length;
    const m = matches[current];
    const p = pages[m.page - 1];
    p.lastSeen = performance.now();
    p.el.scrollIntoView({ block: 'start' });
    await renderPage(p);
    refreshAllHighlights();
    updateCount();
    const mark = p.textLayer.querySelector('mark.cur');
    (mark || p.el).scrollIntoView({ block: 'center' });
  }

  // ---------- 화면 ----------
  async function openGuide() {
    if (!pages.length) await buildPages();
  }

  function render() {
    renderRules();
    openGuide();
  }

  function bind() {
    const input = $('#gs-input');
    let t;
    input.addEventListener('input', () => {
      clearTimeout(t);
      $('#gs-clear').hidden = !input.value;
      t = setTimeout(() => runSearch(input.value), 350);
    });
    input.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return;
      e.preventDefault();
      clearTimeout(t);
      if (normQuery(input.value) !== query) runSearch(input.value);
      else goTo(current + (e.shiftKey ? -1 : 1));
    });
    $('#gs-next').addEventListener('click', () => goTo(current + 1));
    $('#gs-prev').addEventListener('click', () => goTo(current - 1));
    $('#gs-clear').addEventListener('click', () => {
      input.value = '';
      $('#gs-clear').hidden = true;
      runSearch('');
      input.focus();
    });
  }

  window.cphGuide = { render, _search: runSearch, _state: () => ({ matches: matches.length, current, pages: pages.length }) };
  document.addEventListener('DOMContentLoaded', bind);
})();
