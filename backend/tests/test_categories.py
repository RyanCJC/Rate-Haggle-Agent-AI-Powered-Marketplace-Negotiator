from pathlib import Path
from typing import get_args

import psycopg
import pytest

from backend.app.api.schemas import StartRequest
from backend.app.knowledge.categories import (
    CATEGORY_NAMES,
    infer_category,
    resolve_category,
)
from backend.app.knowledge.embed import HashEmbedder
from backend.app.knowledge.facts import DEFAULT_KEYS, extract_claims, required_keys
from backend.app.knowledge.retrieval import Doc, index_documents, search_knowledge
from backend.app.settings import Settings

ROOT = Path(__file__).resolve().parents[2]
needs_db = pytest.mark.skipif(
    not Settings.load().database_url, reason="DATABASE_URL not set"
)


def test_request_schema_accepts_exactly_the_known_categories():
    literal = get_args(StartRequest.model_fields["category"].annotation)[0]
    assert set(get_args(literal)) == set(CATEGORY_NAMES)


def test_every_category_has_a_document_and_there_are_no_orphans():
    documents = {path.stem for path in (ROOT / "knowledge").glob("*.md")}
    assert documents == (set(CATEGORY_NAMES) - {"other"}) | {"general"}


@pytest.mark.parametrize(
    ("title", "expected"),
    [
        ("Dell 27 inch gaming monitor 144hz", "monitors"),
        ("iPhone 13 128GB", "phones"),
        ("MacBook Air M1", "laptops"),
        ("Canon camera body", "cameras"),
        ("Nintendo Switch OLED", "consoles"),
        ("Dining table and 4 chairs", "furniture"),
        ("Samsung fridge", "appliances"),
        ("Vintage guitar", None),
        ("Standing desk with monitor arm", None),
    ],
)
def test_the_category_is_guessed_from_the_title(title, expected):
    assert infer_category(title) == expected


def test_the_description_can_decide_when_the_title_is_vague():
    guess = infer_category("Old unit", "It is a DSLR with a low shutter count")
    assert guess == "cameras"


def test_a_specific_choice_is_kept_and_other_is_guessed():
    assert resolve_category("phones", "Canon camera", None) == ("phones", False)
    assert resolve_category("other", "Canon camera", None) == ("cameras", True)
    assert resolve_category(None, "Canon camera", None) == ("cameras", True)
    assert resolve_category("other", "Vintage guitar", None) == ("other", False)
    assert resolve_category(None, "Vintage guitar", None) == (None, False)


def test_extra_keys_follow_the_category_table():
    assert required_keys("cameras") == (*DEFAULT_KEYS, "shutter_count")
    assert required_keys("monitors") == (*DEFAULT_KEYS, "size_inch", "refresh_rate")
    assert required_keys("furniture") == DEFAULT_KEYS
    assert required_keys("something-new") == DEFAULT_KEYS


def test_shutter_count_is_extracted_from_listing_text():
    claims = extract_claims("Canon body, 12,500 shutter count, no scratches", "listing")
    assert [c.value for c in claims if c.key == "shutter_count"] == ["12,500"]
    claims = extract_claims("Shutter count: 8000", "listing")
    assert [c.value for c in claims if c.key == "shutter_count"] == ["8000"]


@needs_db
def test_general_guidance_is_searchable_from_every_category():
    embedder = HashEmbedder()
    docs = [
        Doc("general", "zz_general.md", "Ask the reason for selling and whether it still works."),
        Doc("zz_cat", "zz_cat.md", "Check the widget hinge for cracks."),
    ]
    with psycopg.connect(Settings.load().require_database_url()) as conn:
        try:
            index_documents(conn, docs, embedder)
            inside = search_knowledge(conn, embedder, "why is it sold", "zz_cat", k=50)
            assert {p.source for p in inside} >= {"zz_general.md", "zz_cat.md"}
            outside = search_knowledge(conn, embedder, "why is it sold", "monitors", k=50)
            assert "zz_cat.md" not in {p.source for p in outside}
            assert "zz_general.md" in {p.source for p in outside}
        finally:
            conn.execute("DELETE FROM knowledge_chunks WHERE source LIKE 'zz\\_%'")
            conn.commit()