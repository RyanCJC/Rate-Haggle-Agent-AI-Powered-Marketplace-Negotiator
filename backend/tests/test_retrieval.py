import math
import os

import psycopg
import pytest
from dotenv import load_dotenv

from backend.app.knowledge.embed import DIM, HashEmbedder, chunk_text
from backend.app.knowledge.retrieval import Doc, index_documents, search_knowledge

load_dotenv()


def cosine(a, b):
    return sum(x * y for x, y in zip(a, b, strict=True))


def test_chunker_merges_a_heading_with_its_paragraph():
    assert chunk_text("# Title\n\nShort paragraph.") == ["# Title\n\nShort paragraph."]


def test_chunker_keeps_big_paragraphs_apart_and_whole():
    first, second = "a" * 200, "b" * 200
    assert chunk_text(f"{first}\n\n{second}", max_chars=350) == [first, second]


def test_hash_embedder_is_deterministic_normalised_and_the_right_size():
    embedder = HashEmbedder()
    a = embedder.embed(["dead pixels on the monitor"])[0]
    assert a == embedder.embed(["dead pixels on the monitor"])[0]
    assert len(a) == DIM
    assert math.isclose(math.sqrt(sum(x * x for x in a)), 1.0)


def test_similar_text_is_closer_than_unrelated_text():
    embedder = HashEmbedder()
    a, b, c = embedder.embed(
        ["dead pixels on monitor screen", "dead pixels on the monitor", "battery cycles on laptop"]
    )
    assert cosine(a, b) > cosine(a, c)


@pytest.fixture
def conn():
    if not os.getenv("DATABASE_URL"):
        pytest.skip("DATABASE_URL not set")
    connection = psycopg.connect(os.environ["DATABASE_URL"])
    yield connection
    connection.rollback()  # tests never leave data behind
    connection.close()


def test_index_then_search_finds_the_right_document_and_respects_the_category(conn):
    embedder = HashEmbedder()
    docs = [
        Doc("zz_test", "zz_pixels.md", "Dead pixels show on a white screen and a black screen."),
        Doc("zz_test", "zz_battery.md", "Battery cycles and capacity decide how long it lasts."),
        Doc("zz_other", "zz_other.md", "Dead pixels on a white screen again."),
    ]
    assert index_documents(conn, docs, embedder) == 3
    assert index_documents(conn, docs, embedder) == 3  # re-indexing replaces, never duplicates

    found = search_knowledge(conn, embedder, "dead pixels white screen", category="zz_test", k=3)

    assert found[0].source == "zz_pixels.md"
    assert {p.source for p in found} == {"zz_pixels.md", "zz_battery.md"}  # zz_other filtered out