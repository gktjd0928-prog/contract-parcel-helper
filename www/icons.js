// 목록에서 쓰는 선 아이콘 (이모지 대신 차분한 단색 아이콘)
window.ICON = (() => {
  const svg = (d) => `<svg class="ic" viewBox="0 0 24 24" aria-hidden="true" style="width:18px;height:18px">${d}</svg>`;
  return {
    phone: svg('<path d="M5 4h3.5l1.5 4-2 1.3a10 10 0 0 0 6.7 6.7L16 14l4 1.5V19a1.5 1.5 0 0 1-1.6 1.5A15.5 15.5 0 0 1 3.5 5.6 1.5 1.5 0 0 1 5 4z"/>'),
    sms: svg('<path d="M4 5h16v11H9l-5 4z"/><path d="M8 9.5h8M8 12.5h5"/>'),
    mail: svg('<rect x="3.5" y="5.5" width="17" height="13" rx="2"/><path d="m4 7 8 6 8-6"/>'),
    trash: svg('<path d="M4.5 7h15M10 7V4.5h4V7M6.5 7l1 13h9l1-13M10 11v5.5M14 11v5.5"/>'),
    plus: svg('<path d="M12 5v14M5 12h14"/>'),
    check: svg('<path d="m5 12.5 4.5 4.5L19 7.5"/>')
  };
})();
