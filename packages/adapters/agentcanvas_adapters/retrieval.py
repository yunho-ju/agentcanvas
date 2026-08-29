"""BM25 순위 — 큰 응답을 조각으로 나눠 질의로 골라 싣기 위한 순수 점수 매김.

왜 BM25인가: dense/hybrid 검색은 임베딩 모델·라이브러리 버전에 재현성을 맡겨야 하지만
(ReproRAG), BM25는 표준 공식(Robertson/Spärck Jones)과 고정된 tokenization만으로
**같은 응답·같은 질의 → 항상 같은 순위**가 성립한다. 리플레이가 그 재현성 위에 선다.

이 모듈은 순수하다 — 모델·네트워크·시간·랜덤 없이 값만 돌려주고, 예외를 던지지 않는다.
"""

from __future__ import annotations

import math
import re
from collections import Counter

#: tokenization 규칙은 딱 하나로 고정한다 — 이 정규식이 재현성의 뿌리다.
#: 유니코드 단어 문자(letters·digits·underscore)의 연속을 한 토큰으로 본다. 소문자화 먼저.
_WORD = re.compile(r"\w+", re.UNICODE)

#: BM25 표준 상수 — 흔히 쓰는 값으로 고정한다(문헌 기본값). 조율은 이 브리프 밖.
K1 = 1.5
B = 0.75


def tokenize(text: str) -> list[str]:
    """글 하나를 토큰 목록으로 — 소문자화 + 유니코드 단어 경계. 규칙은 이 함수가 전부다."""
    return _WORD.findall(text.lower())


def _idf(total_docs: int, docs_with_term: int) -> float:
    """역문서빈도 — 흔한 말은 덜, 드문 말은 더. 음수가 나오지 않는 BM25 변형(+1)을 쓴다."""
    return math.log(1 + (total_docs - docs_with_term + 0.5) / (docs_with_term + 0.5))


def bm25_ranked(chunks: list[str], query: str) -> list[tuple[int, float]]:
    """조각들을 질의로 점수 매겨 (원래 index, 점수)를 높은 점수부터 돌려준다.

    동점은 원문 등장 순서를 지킨다(안정 정렬) — "무엇을 근거로 골랐나"가 재현되게.
    조각이 없으면 빈 순위다(에러 아님). top_k 자르기는 부르는 쪽의 몫이다.
    """
    tokenized = [tokenize(chunk) for chunk in chunks]
    total = len(tokenized)
    if total == 0:
        return []
    lengths = [len(tokens) for tokens in tokenized]
    avg_len = sum(lengths) / total
    counts = [Counter(tokens) for tokens in tokenized]

    query_terms = set(tokenize(query))
    docs_with = {
        term: sum(1 for count in counts if term in count) for term in query_terms
    }
    idf = {
        term: _idf(total, docs_with[term])
        for term in query_terms
        if docs_with[term] > 0
    }

    scores: list[float] = []
    for count, length in zip(counts, lengths, strict=True):
        score = 0.0
        for term, term_idf in idf.items():
            freq = count.get(term, 0)
            if freq == 0:
                continue
            denom = freq + K1 * (1 - B + B * (length / avg_len if avg_len else 0))
            score += term_idf * (freq * (K1 + 1)) / denom
        scores.append(score)

    # reverse=True도 안정 정렬이다 — 점수가 같으면 원래 순서를 지킨다(파이썬 sorted 보장).
    return sorted(enumerate(scores), key=lambda pair: pair[1], reverse=True)


__all__ = ["K1", "B", "bm25_ranked", "tokenize"]
