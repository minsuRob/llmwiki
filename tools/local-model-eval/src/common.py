"""질문 정의 · 키워드 기준선 · BM25 (표준 라이브러리만)."""
import math
import re
from collections import Counter

# ----------------------------------------------------------------------------- Laya 질문 (판단 과제)
CAREER_OPTS = {
    "ko": {"entry_only": "신입·인턴만 뽑는다", "entry_or_junior": "신입·인턴과 주니어 경력자를 모두 뽑는다", "junior_only": "주니어 경력자만 뽑는다"},
    "en": {"entry_only": "hires new grads / interns only", "entry_or_junior": "hires both new grads/interns and junior experienced people", "junior_only": "hires junior experienced people only"},
}
Q = {
    "ko": {
        "is_it_dev": "이 채용공고는 IT·개발 직군(소프트웨어, 데이터, 하드웨어·반도체 등 기술 개발) 공고다.",
        "is_ai_title": "이 공고의 직무명(제목)은 AI 관련 직무(AI, LLM, ML, Agent, RAG 등)다.",
        "career": "이 공고가 뽑는 경력 수준",
        "has_due_date": "이 공고에는 지원 마감 날짜(연-월-일)가 구체적으로 적혀 있다.",
    },
    "en": {
        "is_it_dev": "This job posting is for an IT / engineering role (software, data, hardware, semiconductors or other technical development).",
        "is_ai_title": "The job title of this posting is an AI role (AI, LLM, ML, agents, RAG, etc.).",
        "career": "Experience level this posting hires for",
        "has_due_date": "This posting states a specific application deadline date.",
    },
    "ko_para": {
        "is_it_dev": "이 공고에서 뽑는 사람은 소프트웨어·데이터·하드웨어 같은 기술 개발을 하는 사람이다.",
        "is_ai_title": "공고 제목만 보면 인공지능 분야 직무다.",
        "career": "지원 가능한 경력 범위",
        "has_due_date": "공고에서 언제까지 지원해야 하는지 날짜를 확인할 수 있다.",
    },
}


def laya_questions(variant="ko", reverse_options=False):
    qs = Q[variant]
    opts = CAREER_OPTS["en" if variant == "en" else "ko"]
    items = list(opts.items())
    if reverse_options:
        items = items[::-1]
    return {
        "is_it_dev": {"type": "noul", "instructions": qs["is_it_dev"]},
        "is_ai_title": {"type": "noul", "instructions": qs["is_ai_title"]},
        "career": {"type": "choice", "instructions": qs["career"], "criteria": dict(items)},
        "has_due_date": {"type": "noul", "instructions": qs["has_due_date"]},
    }


# ----------------------------------------------------------------------------- 키워드 기준선
DEV_KW = re.compile(r"(개발|엔지니어|engineer|developer|backend|frontend|front-end|back-end|풀스택|full.?stack|데이터|data|devops|sre|"
                    r"인프라|infra|ml|ai|머신러닝|딥러닝|반도체|회로|펌웨어|firmware|임베디드|embedded|hw|하드웨어|보안|security|qa|"
                    r"소프트웨어|software|android|ios|서버|클라우드|cloud|로봇|robot|it\b)", re.I)
AI_TITLE_KW = re.compile(r"(\bAI\b|AI|인공지능|LLM|\bML\b|머신러닝|딥러닝|Agent|에이전트|RAG|\bFDE\b|\bAX\b|생성형|GenAI|Vision|비전 ?AI|NLP)", re.I)
DATE_KW = re.compile(r"(\d{4}\s*[.\-/년]\s*\d{1,2}\s*[.\-/월]\s*\d{1,2})|(\d{1,2}\s*월\s*\d{1,2}\s*일)|(\d{1,2}/\d{1,2}\s*\()")
DUE_CTX = re.compile(r"(마감|까지|접수 ?기간|지원 ?기간|deadline|apply by|closing)", re.I)
ENTRY = re.compile(r"(신입|인턴|intern|new ?grad|졸업 ?예정|경력 ?무관|entry)", re.I)
JUNIOR = re.compile(r"(경력\s*\d|\d+\s*년\s*(이상|이하|차)|주니어|junior|\d\+?\s*years?|경력직|경력자)", re.I)


def kw_baseline(title, body):
    head = body[:3000]
    dev_hits = len(DEV_KW.findall(title)) * 3 + len(DEV_KW.findall(head))
    has_date = any(DATE_KW.search(m.group(0) + head[m.end():m.end() + 40]) or DATE_KW.search(head[max(0, m.start() - 40):m.end()])
                   for m in DUE_CTX.finditer(head))
    e, j = bool(ENTRY.search(title + " " + head)), bool(JUNIOR.search(title + " " + head))
    career = "entry_or_junior" if (e and j) else ("junior_only" if j else "entry_only")
    return {"is_it_dev": dev_hits, "is_ai_title": bool(AI_TITLE_KW.search(title)), "career": career, "has_due_date": has_date}


# ----------------------------------------------------------------------------- BM25
TOKEN = re.compile(r"[A-Za-z][A-Za-z0-9+#.\-]*|[가-힣]+|\d+")


def tokenize(text):
    out = []
    for t in TOKEN.findall(text.lower()):
        if re.match(r"[가-힣]", t) and len(t) > 1:
            out += [t[i:i + 2] for i in range(len(t) - 1)]  # 한국어는 2글자 조각(형태소 분석기 없이)
        else:
            out.append(t)
    return out


class BM25:
    def __init__(self, docs, k1=1.4, b=0.75):
        self.ids = list(docs)
        self.tf = [Counter(tokenize(docs[i])) for i in self.ids]
        self.len = [sum(t.values()) for t in self.tf]
        self.avg = sum(self.len) / max(1, len(self.len))
        df = Counter()
        for t in self.tf:
            df.update(t.keys())
        n = len(self.ids)
        self.idf = {w: math.log(1 + (n - c + 0.5) / (c + 0.5)) for w, c in df.items()}
        self.k1, self.b = k1, b

    def search(self, query, k=10):
        q = tokenize(query)
        scores = []
        for i, tf in enumerate(self.tf):
            s = 0.0
            for w in q:
                if w in tf:
                    f = tf[w]
                    s += self.idf[w] * f * (self.k1 + 1) / (f + self.k1 * (1 - self.b + self.b * self.len[i] / self.avg))
            scores.append((s, self.ids[i]))
        scores.sort(reverse=True)
        return [(i, round(s, 3)) for s, i in scores[:k]]
