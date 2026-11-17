// 앱 업데이트: GitHub에 올린 version.json을 확인하고, 새 화면 묶음(zip)을 받아 적용
//  - 웹 묶음 업데이트: @capgo/capacitor-updater (수동 모드)로 내려받아 바로 적용
//  - 새 APK가 필요한 경우: 내려받기 링크를 열어 사용자가 설치
(() => {
  'use strict';
  const $ = (s) => document.querySelector(s);
  const Updater = () => window.Capacitor?.Plugins?.CapacitorUpdater;
  const AppPlugin = () => window.Capacitor?.Plugins?.App;
  const isNative = () => !!window.Capacitor?.isNativePlatform?.();

  let latest = null;     // 받아온 version.json
  let busy = false;

  // '1.2.10' > '1.2.9'
  function cmp(a, b) {
    const pa = String(a).split('.').map(Number), pb = String(b).split('.').map(Number);
    for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
      const d = (pa[i] || 0) - (pb[i] || 0);
      if (d) return d > 0 ? 1 : -1;
    }
    return 0;
  }

  async function nativeBuild() {
    try { return Number((await AppPlugin()?.getInfo())?.build) || 0; } catch (e) { return 0; }
  }

  async function fetchManifest() {
    const url = window.UPDATE_MANIFEST_URL;
    if (!url) throw new Error('업데이트 주소가 아직 설정되지 않았습니다');
    const res = await fetch(url + (url.includes('?') ? '&' : '?') + 't=' + Date.now(), { cache: 'no-store' });
    if (!res.ok) throw new Error('업데이트 정보를 받지 못했습니다 (' + res.status + ')');
    const m = await res.json();
    if (!m.version || !m.bundleUrl || !m.checksum) throw new Error('업데이트 정보 형식이 올바르지 않습니다');
    return m;
  }

  function setStatus(html) { $('#upd-status').innerHTML = html; }

  function renderVersion(build) {
    $('#upd-version').textContent = `현재 버전 ${window.APP_VERSION}${build ? ` · 앱 빌드 ${build}` : ''}`;
  }

  function markTab(on) {
    document.querySelector('.tabbar [data-view=settings]')?.classList.toggle('has-update', on);
  }

  async function check({ silent = false } = {}) {
    if (busy) return;
    busy = true;
    const { esc, toast } = window.cph;
    if (!silent) setStatus('확인 중…');
    try {
      latest = await fetchManifest();
      const build = await nativeBuild();
      const needApk = isNative() && latest.nativeBuild && build && latest.nativeBuild > build;
      const newer = cmp(latest.version, window.APP_VERSION) > 0;
      markTab(newer || needApk);
      if (needApk) {
        setStatus(`<div class="status bad">새 앱 설치 파일(APK)이 필요한 업데이트입니다 — 버전 ${esc(latest.version)}</div>
          ${notes(latest)}
          <div class="actions"><button class="btn primary" id="upd-apk">설치 파일 내려받기</button></div>
          <p class="hint">내려받은 뒤 파일을 열어 [설치]를 누르세요. 기존 데이터는 그대로 남습니다.</p>`);
        $('#upd-apk').onclick = () => openExternal(latest.apkUrl);
        if (silent) toast('새 버전이 있습니다. 설정에서 확인하세요');
      } else if (newer) {
        setStatus(`<div class="status ok">새 버전 ${esc(latest.version)}이 있습니다</div>
          ${notes(latest)}
          <div class="actions"><button class="btn primary" id="upd-apply">지금 업데이트</button></div>`);
        $('#upd-apply').onclick = apply;
        if (silent) toast('새 버전이 있습니다. 설정에서 업데이트하세요');
      } else if (!silent) {
        setStatus('<div class="status ok">최신 버전입니다</div>');
      }
    } catch (e) {
      if (!silent) setStatus(`<div class="status bad">${window.cph.esc(e.message)}</div>`);
    } finally {
      busy = false;
    }
  }

  function notes(m) {
    if (!m.notes) return '';
    const { esc } = window.cph;
    const date = m.publishedAt ? new Date(m.publishedAt).toLocaleDateString('ko-KR') : '';
    return `<div class="upd-notes"><b>변경 내용</b>${date ? ` <span class="meta">${esc(date)}</span>` : ''}<p>${esc(m.notes).replace(/\n/g, '<br>')}</p></div>`;
  }

  function openExternal(url) {
    if (!url) return;
    // Capacitor 웹뷰는 앱 밖 주소를 외부 브라우저로 엽니다
    window.open(url, '_blank');
  }

  async function apply() {
    const U = Updater();
    if (!isNative() || !U) {
      setStatus('<div class="status bad">업데이트 적용은 설치된 앱에서만 할 수 있습니다</div>');
      return;
    }
    if (busy || !latest) return;
    busy = true;
    const progress = (p) => setStatus(`<div class="upd-progress"><div style="width:${p}%"></div></div><p class="hint">내려받는 중… ${p}%</p>`);
    progress(0);
    let sub;
    try {
      sub = await U.addListener('download', (e) => progress(Math.round(e.percent || 0)));
      const bundle = await U.download({ url: latest.bundleUrl, version: latest.version, checksum: latest.checksum });
      setStatus('<p class="hint">적용 중… 앱이 곧 다시 시작됩니다</p>');
      await U.set({ id: bundle.id });   // 새 묶음으로 다시 불러옴
    } catch (e) {
      setStatus(`<div class="status bad">업데이트 실패: ${window.cph.esc(e.message || String(e))}</div>
        <div class="actions"><button class="btn ghost" id="upd-retry">다시 시도</button></div>`);
      $('#upd-retry').onclick = () => check();
    } finally {
      sub?.remove?.();
      busy = false;
    }
  }

  async function init() {
    // 새 묶음으로 정상 시작했음을 알림 (알리지 않으면 플러그인이 이전 버전으로 되돌림)
    try { await Updater()?.notifyAppReady(); } catch (e) { /* 웹 미리보기 */ }
    renderVersion(await nativeBuild());
    $('#upd-check').addEventListener('click', () => check());
    if (isNative() && window.UPDATE_MANIFEST_URL) setTimeout(() => check({ silent: true }), 3000);
  }

  window.cphUpdater = { check, _cmp: cmp };
  document.addEventListener('DOMContentLoaded', init);
})();
