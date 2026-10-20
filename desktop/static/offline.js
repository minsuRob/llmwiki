// 다시 시도 — 메인이 붙여 준 주소(?url=)로 돌아간다. 이 페이지에는 브리지가 없다.
const q = new URLSearchParams(location.search);
const url = q.get('url');
document.getElementById('info').textContent = [q.get('code') && `원인: ${q.get('code')}`, q.get('v') && `셸 ${q.get('v')}`].filter(Boolean).join(' · ');
document.getElementById('retry').addEventListener('click', () => { if (url && /^https?:\/\//.test(url)) location.href = url; });
