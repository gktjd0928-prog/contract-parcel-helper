// 업무지침: 앱에 포함한 업무처리지침 PDF 보기 + 본문 찾기(형광 표시) + 요금 산출 기준 요약
(() => {
  'use strict';
  const $ = (s) => document.querySelector(s);
  const PDF_URL = 'guide.pdf';
  const MAX_RENDERED = 10;         // 동시에 그려 둘 최대 쪽 수 (메모리 절약)

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
        <li>신규(마) 감액은 계약 1년 미만(최초 계약기간)에만, 장기(바) 감액은 계약 1년 이상이면 ‘1년 이상’ 항목, 3년 이상이면 ‘3년 이상’ 항목만 적용합니다. 계약 기간에 맞지 않는 항목은 계산 화면에서 선택할 수 없습니다.</li>
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
      ${toleranceHtml(t.tolerance)}
      <p class="meta">기준: ${esc(t.version)} · 금액은 [설정]에서 수정한 값이 반영됩니다.</p>`;
  }

  // 계약소포 규격 적용 시 허용한도 (업무처리지침 29쪽 [별표 3] 2.)
  function toleranceHtml(tol) {
    if (!tol) return '';
    const { esc } = window.cph;
    const table = (label, data) => `
      <table class="rule-table tol-table">
        <thead><tr><th>${esc(label)}</th>${data.rows.map(([k]) => `<th>${esc(k)}</th>`).join('')}</tr></thead>
        <tbody><tr><td>허용한도</td>${data.rows.map(([, v]) => `<td><b>${esc(v)}</b></td>`).join('')}</tr></tbody>
      </table>
      <p class="meta">${esc(data.note)}</p>`;
    return `
      <h4>계약소포 규격 적용 시 허용한도</h4>
      <p class="tol-sub">가. 중량 단계별 최대 허용한도</p>
      ${table('중량', tol.weight)}
      <p class="tol-sub">나. 크기 단계별 최대 허용한도</p>
      ${table('크기', tol.size)}
      <p class="tol-sub">다. 크기 초과 우편물의 접수</p>
      <ul>${tol.oversize.map((it) => `<li>${esc(it)}</li>`).join('')}</ul>
      <p class="meta">${esc(tol.source)} · 지침 본문에서 ‘허용한도’로 찾아 원문을 확인하세요.</p>`;
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

  // ---------- 쪽 배치·그리기 (확대 지원) ----------
  const MIN_ZOOM = 1, MAX_ZOOM = 4;
  const MAX_CANVAS_PX = 5e6;       // 쪽 하나의 캔버스 최대 픽셀 (확대해도 메모리 폭주 방지)
  const PIXEL_BUDGET = 24e6;       // 그려 둔 쪽 전체의 최대 픽셀
  const TEXT_LAYER_MIN_SCALE = 2.5;  // 글자층 최소 배율 (9pt 글자 → 약 22px로 그린 뒤 축소)
  let zoom = 1;
  let baseWidth = 0;
  const near = new Set();          // 화면 근처에 있는 쪽 번호

  async function buildPages() {
    const box = $('#guide-pages');
    box.innerHTML = '<div class="empty">지침을 여는 중...</div>';
    try {
      await openDoc();
    } catch (e) {
      box.innerHTML = `<div class="empty">${window.cph.esc(e.message)}</div>`;
      return;
    }
    // 100%일 때 쪽 너비 = 화면 안쪽 너비 (스크롤 영역의 좌우 여백 제외)
    const sc = $('#guide-scroller');
    const cs = getComputedStyle(sc);
    const inner = (sc.clientWidth || 360) - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
    baseWidth = Math.min(inner, 760);
    pageWidth = Math.round(baseWidth * zoom);
    box.innerHTML = '';
    pages = [];
    const first = await doc.getPage(1);
    const v1 = first.getViewport({ scale: 1 });
    for (let n = 1; n <= doc.numPages; n++) {
      const el = document.createElement('div');
      el.className = 'pdf-page';
      el.dataset.page = n;
      el.innerHTML = `<div class="pdf-canvas"></div><div class="textLayer"></div><span class="pdf-num">${n} / ${doc.numPages}</span>`;
      box.appendChild(el);
      // 실제 비율은 그릴 때 맞추고, 우선 1쪽 비율로 자리만 잡아 둠
      const p = { num: n, el, canvasBox: el.firstChild, textLayer: el.children[1], ratio: v1.height / v1.width, rendered: false, rendering: null, textContent: null, items: null, lastSeen: 0, pixels: 0 };
      sizePage(p);
      pages.push(p);
    }
    // 쪽마다 실제 크기를 미리 맞춰 둠 (나중에 그릴 때 높이가 바뀌어 화면이 밀리지 않도록)
    for (const p of pages) {
      const vp = (await doc.getPage(p.num)).getViewport({ scale: 1 });
      p.ratio = vp.height / vp.width;
      sizePage(p);
    }
    $('#guide-meta').textContent = `우체국 계약소포업무 처리지침 · ${doc.numPages}쪽 · 두 손가락으로 확대`;

    observer?.disconnect();
    near.clear();
    observer = new IntersectionObserver((entries) => {
      entries.forEach((en) => {
        const n = +en.target.dataset.page;
        if (!en.isIntersecting) { near.delete(n); return; }
        near.add(n);
        const p = pages[n - 1];
        p.lastSeen = performance.now();
        renderPage(p);
      });
    }, { rootMargin: '900px 900px' });
    pages.forEach((p) => observer.observe(p.el));
    indexReady = null;
  }

  function sizePage(p) {
    p.el.style.width = pageWidth + 'px';
    p.el.style.height = Math.round(pageWidth * p.ratio) + 'px';
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
    const width = pageWidth;
    p.rendering = (async () => {
      const page = await doc.getPage(p.num);
      const v1 = page.getViewport({ scale: 1 });
      p.ratio = v1.height / v1.width;
      const cssScale = width / v1.width;
      const vpCss = page.getViewport({ scale: cssScale });
      // 화면 밀도만큼 선명하게, 단 쪽당 픽셀 상한 안에서
      let dpr = Math.min(window.devicePixelRatio || 1, 2);
      dpr = Math.min(dpr, Math.sqrt(MAX_CANVAS_PX / (vpCss.width * vpCss.height)));
      const vpDev = page.getViewport({ scale: cssScale * dpr });

      const canvas = document.createElement('canvas');
      canvas.width = Math.floor(vpDev.width);
      canvas.height = Math.floor(vpDev.height);
      await page.render({ canvasContext: canvas.getContext('2d'), viewport: vpDev }).promise;
      if (width !== pageWidth) return;          // 그리는 사이 확대 배율이 바뀜 → 버림
      sizePage(p);
      p.el.style.setProperty('--scale-factor', cssScale);
      p.canvasBox.replaceChildren(canvas);
      p.pixels = canvas.width * canvas.height;

      await getText(p);
      // 글자층(찾기·형광 표시 위치)은 크게 그린 뒤 화면 크기로 줄인다.
      // 안드로이드 웹뷰는 최소 글자 크기(약 8px)보다 작은 글자를 강제로 키워서,
      // 100%에서 그대로 그리면 형광 표시가 실제 글자와 어긋난다.
      const textScale = Math.max(cssScale, TEXT_LAYER_MIN_SCALE);
      const vpText = page.getViewport({ scale: textScale });
      const layer = document.createElement('div');
      layer.className = 'textLayer';
      layer.style.setProperty('--scale-factor', textScale);
      layer.style.transform = `scale(${cssScale / textScale})`;
      const divs = [];
      // 글자층은 화면에 붙인 상태에서 그려야 --scale-factor를 읽을 수 있음
      p.textLayer.replaceWith(layer);
      p.textLayer = layer;
      await lib.renderTextLayer({ textContentSource: p.textContent, container: layer, viewport: vpText, textDivs: divs, textContentItemsStr: [] }).promise;
      if (width !== pageWidth) return;
      p.textDivs = divs;
      p.rendered = true;
      applyHighlights(p);
      evictFarPages();
    })().finally(() => {
      p.rendering = null;
      // 확대 배율이 바뀌었는데 아직 화면 근처라면 새 배율로 다시 그림
      if (!p.rendered && near.has(p.num)) renderPage(p);
    });
    return p.rendering;
  }

  function clearPage(p, keepCanvas) {
    if (!keepCanvas) { p.canvasBox.replaceChildren(); p.pixels = 0; }
    p.textLayer.replaceChildren();
    p.textDivs = null;
    p.rendered = false;
  }

  // 오래 안 본 쪽부터 비워 픽셀 예산 안으로 유지
  function evictFarPages() {
    const live = pages.filter((p) => p.pixels > 0).sort((a, b) => a.lastSeen - b.lastSeen);
    let total = live.reduce((a, p) => a + p.pixels, 0);
    let count = live.length;
    for (const p of live) {
      if (total <= PIXEL_BUDGET && count <= MAX_RENDERED) break;
      if (near.has(p.num)) continue;
      total -= p.pixels;
      count--;
      clearPage(p, false);
    }
  }

  // ---------- 확대·축소 ----------
  // anchor(화면 좌표)에 있던 지점이 확대 후에도 같은 자리에 오도록 스크롤을 맞춘다
  function setZoom(next, anchorX, anchorY) {
    next = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, next));
    if (!pages.length || Math.abs(next - zoom) < 0.01) { updateZoomBadge(); return; }
    const scroller = $('#guide-scroller');
    const sRect = scroller.getBoundingClientRect();
    if (anchorX == null) { anchorX = sRect.left + sRect.width / 2; anchorY = window.innerHeight / 2; }
    // 손가락 아래에 있는 쪽과 그 쪽 안에서의 위치를 기억 (쪽 사이 간격은 확대되지 않으므로 쪽 기준으로 맞춤)
    let anchorPage = pages[0], best = Infinity;
    for (const p of pages) {
      const r = p.el.getBoundingClientRect();
      const d = anchorY < r.top ? r.top - anchorY : anchorY > r.bottom ? anchorY - r.bottom : 0;
      if (d < best) { best = d; anchorPage = p; }
      if (d === 0) break;
    }
    const pr = anchorPage.el.getBoundingClientRect();
    const xIn = anchorX - pr.left, yIn = anchorY - pr.top;
    const ratio = next / zoom;

    zoom = next;
    pageWidth = Math.round(baseWidth * zoom);
    pages.forEach((p) => {
      sizePage(p);
      // 화면 근처 쪽은 늘어난 그림을 임시로 두고 글자층만 비운 뒤 새 배율로 다시 그림
      if (p.rendered || p.pixels) clearPage(p, near.has(p.num));
    });
    let nr = anchorPage.el.getBoundingClientRect();
    window.scrollBy(0, nr.top + yIn * ratio - anchorY);
    nr = anchorPage.el.getBoundingClientRect();
    scroller.scrollLeft += nr.left + xIn * ratio - anchorX;
    updateZoomBadge();
    scheduleRerender();
  }

  let rerenderTimer;
  function scheduleRerender() {
    clearTimeout(rerenderTimer);
    rerenderTimer = setTimeout(() => {
      const vh = window.innerHeight;
      pages.forEach((p) => {
        const r = p.el.getBoundingClientRect();
        if (r.bottom > -900 && r.top < vh + 900) { near.add(p.num); p.lastSeen = performance.now(); renderPage(p); }
      });
    }, 120);
  }

  function updateZoomBadge() {
    const b = $('#gs-zoom');
    b.hidden = zoom <= 1.01;
    b.querySelector('span').textContent = Math.round(zoom * 100) + '%';
  }

  function bindZoom() {
    const scroller = $('#guide-scroller');
    const box = $('#guide-pages');
    let pinch = null;
    const dist = (t) => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);

    scroller.addEventListener('touchstart', (e) => {
      if (e.touches.length !== 2 || !pages.length) return;
      e.preventDefault();
      const t = e.touches;
      const cx = (t[0].clientX + t[1].clientX) / 2, cy = (t[0].clientY + t[1].clientY) / 2;
      const r = box.getBoundingClientRect();
      box.style.transformOrigin = `${cx - r.left}px ${cy - r.top}px`;
      pinch = { d0: dist(t), z0: zoom, cx, cy, s: 1 };
    }, { passive: false });

    scroller.addEventListener('touchmove', (e) => {
      if (!pinch || e.touches.length !== 2) return;
      e.preventDefault();
      const z = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, pinch.z0 * dist(e.touches) / pinch.d0));
      pinch.s = z / pinch.z0;
      box.style.transform = `scale(${pinch.s})`;
      const b = $('#gs-zoom');
      b.hidden = false;
      b.querySelector('span').textContent = Math.round(z * 100) + '%';
    }, { passive: false });

    const end = (e) => {
      if (!pinch || e.touches.length >= 2) return;
      const { z0, s, cx, cy } = pinch;
      pinch = null;
      box.style.transform = '';
      setZoom(z0 * s, cx, cy);
    };
    scroller.addEventListener('touchend', end);
    scroller.addEventListener('touchcancel', end);

    // PC: Ctrl + 휠로 확대
    scroller.addEventListener('wheel', (e) => {
      if (!e.ctrlKey || !pages.length) return;
      e.preventDefault();
      setZoom(zoom * (e.deltaY < 0 ? 1.15 : 1 / 1.15), e.clientX, e.clientY);
    }, { passive: false });

    $('#gs-zoom').addEventListener('click', () => setZoom(1));
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
    (mark || p.el).scrollIntoView({ block: 'center', inline: 'center' });
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
    bindZoom();
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
