"""BM25 순위 — 같은 응답·같은 질의면 언제나 같은 top_k (리플레이 재현성의 관건).

이 모듈은 순수하다: 모델·네트워크·시간·랜덤 없이 입력 조각·질의 → 점수 순위만.
tokenization과 동점 규칙을 여기서 못 박는다 — 그 둘이 재현성을 정한다.
"""

from __future__ import annotations

from agentcanvas_adapters.retrieval import bm25_ranked, tokenize


class TestTokenization:
    def test_it_lowercases_and_splits_on_word_boundaries(self):
        assert tokenize("Asthma, in ADULTS!") == ["asthma", "in", "adults"]

    def test_punctuation_and_whitespace_are_not_tokens(self):
        assert tokenize("a.b  c\n\td--e") == ["a", "b", "c", "d", "e"]

    def test_it_keeps_unicode_letters_and_digits(self):
        assert tokenize("천식 J45 x2") == ["천식", "j45", "x2"]

    def test_empty_text_yields_no_tokens(self):
        assert tokenize("   ,. ") == []


class TestRanking:
    def test_the_chunk_that_matches_the_query_scores_highest(self):
        chunks = [
            "billing and payment amounts due",
            "the diagnosis is asthma with wheezing",
            "scheduling and appointment times",
        ]

        ranked = bm25_ranked(chunks, "asthma diagnosis")

        assert ranked[0][0] == 1  # the diagnosis chunk

    def test_the_same_input_always_gives_the_same_ranking(self):
        chunks = ["asthma diagnosis", "asthma plan", "billing"]

        once = bm25_ranked(chunks, "asthma")
        twice = bm25_ranked(chunks, "asthma")

        assert once == twice

    def test_a_tie_keeps_the_order_the_chunks_appeared_in(self):
        # 아무 조각도 질의어를 담지 않아 점수가 모두 같다(0) → 원문 등장 순서 그대로.
        chunks = ["alpha", "bravo", "charlie"]

        ranked = bm25_ranked(chunks, "nowhere")

        assert [index for index, _score in ranked] == [0, 1, 2]
        assert len({score for _index, score in ranked}) == 1

    def test_every_chunk_gets_a_place_even_beyond_top_k(self):
        chunks = ["one two", "two three", "three four"]

        ranked = bm25_ranked(chunks, "two")

        assert len(ranked) == len(chunks)
        assert sorted(index for index, _ in ranked) == [0, 1, 2]

    def test_no_chunks_is_an_empty_ranking_not_an_error(self):
        assert bm25_ranked([], "asthma") == []

    def test_a_repeated_term_lifts_a_chunk_above_a_single_mention(self):
        chunks = [
            "asthma asthma asthma cough",
            "asthma and a lot of other unrelated words here",
        ]

        ranked = bm25_ranked(chunks, "asthma")

        assert ranked[0][0] == 0
