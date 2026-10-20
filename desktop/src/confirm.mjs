// 외부 전송 확인 — 메인이 띄우는 네이티브 창이라 웹 페이지가 건너뛸 수 없다. 기본 단추는 취소. 매번 묻는다(Gemma 포함).
import { bundleSummary } from './validate.mjs';

export const DESTINATION = {
  claude: 'Anthropic(Claude Code CLI) — 웹 조사만, 파일 수정 · 셸 실행 없음',
  codex: 'OpenAI(Codex CLI) — 읽기 전용 샌드박스',
  gemma: '내 오라클 서버(oci-a1)의 Gemma — 정해진 작업(handoff_gemma)만',
};
const LABEL = { claude: 'Claude', codex: 'Codex', gemma: 'Gemma' };

/** dialog.showMessageBox 에 넘길 내용(순수 — 시험용) */
export function confirmBox(req) {
  const s = bundleSummary(req.bundleMarkdown);
  return {
    type: 'question',
    buttons: ['보내기', '취소'],
    defaultId: 1,
    cancelId: 1,
    noLink: true,
    title: 'llmwiki — 맥락 묶음 보내기',
    message: `${LABEL[req.executor]}에게 맥락 묶음을 보낼까요?`,
    detail: [
      s.title && `업무: ${s.title}`,
      `받는 곳: ${DESTINATION[req.executor]}`,
      `크기: ${s.chars.toLocaleString('ko-KR')}자 · 자료 ${s.sources}개${req.model ? ` · 모델 ${req.model}` : ''}`,
      '',
      '답은 앱에 "제안"으로만 들어오고, 확정은 직접 하세요.',
    ].filter((l) => l !== false && l != null).join('\n'),
  };
}

export function createConfirm(dialog, getWindow) {
  return async (req) => {
    const win = getWindow();
    const box = confirmBox(req);
    const r = win ? await dialog.showMessageBox(win, box) : await dialog.showMessageBox(box);
    return r.response === 0;
  };
}
