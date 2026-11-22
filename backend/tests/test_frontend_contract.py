"""Contract test ensuring frontend category types match backend CATEGORY_NAMES."""

import re
from pathlib import Path

from backend.app.knowledge.categories import CATEGORY_NAMES

ROOT = Path(__file__).resolve().parents[2] / "frontend" / "src"


def read_text(rel_path: str) -> str:
    return (ROOT / rel_path).read_text()


def test_types_ts_listing_category_matches_backend() -> None:
    """ListingCategory in types.ts must exactly match backend CATEGORY_NAMES."""
    text = read_text("types.ts")
    # Find the ListingCategory type block (multi-line union type)
    start = text.find("export type ListingCategory")
    assert start != -1, "types.ts does not define ListingCategory"
    end = text.find(";", start)
    assert end != -1, "types.ts ListingCategory block not terminated"
    body = text[start:end]
    members = {
        m.strip().strip('"').strip("'")
        for m in re.findall(r'["\']([^"\']+)["\']', body)
    }
    expected = set(CATEGORY_NAMES)
    missing = expected - members
    extra = members - expected
    assert not missing, f"types.ts ListingCategory is missing backend categories: {sorted(missing)}"
    assert not extra, f"types.ts ListingCategory has unexpected categories: {sorted(extra)}"


def test_home_tsx_categories_match_backend() -> None:
    """CATEGORIES in frontend/src/lib/categories.ts must exactly match backend CATEGORY_NAMES."""
    text = read_text("lib/categories.ts")
    start = text.find("export const CATEGORIES")
    assert start != -1, "categories.ts does not define CATEGORIES"
    end = text.find("];", start)
    assert end != -1, "categories.ts CATEGORIES block not terminated"
    body = text[start:end]
    values = {
        m.strip().strip('"').strip("'")
        for m in re.findall(r'value:\s*["\']([^"\']+)["\']', body)
    }
    expected = set(CATEGORY_NAMES)
    missing = expected - values
    extra = values - expected
    assert not missing, f"categories.ts CATEGORIES is missing backend categories: {sorted(missing)}"
    assert not extra, f"categories.ts CATEGORIES has unexpected categories: {sorted(extra)}"


def test_home_tsx_category_labels_match_backend() -> None:
    """Category labels in frontend/src/lib/categories.ts must match the backend Category.label."""
    text = read_text("lib/categories.ts")
    from backend.app.knowledge.categories import CATEGORIES as BACKEND_CATEGORIES

    label_map = {c.name: c.label for c in BACKEND_CATEGORIES}
    matches = re.findall(r'\{\s*value:\s*"([^"]+)"\s*,\s*label:\s*"([^"]+)"\s*\}', text)
    frontend_map = {v: l for v, l in matches}
    for name, label in label_map.items():
        assert frontend_map.get(name) == label, (
            f"categories.ts label for {name!r} is {frontend_map.get(name)!r}, "
            f"expected {label!r}"
        )


def test_types_ts_channel_matches_backend_startrequest() -> None:
    """Channel union values in frontend/types.ts must match backend StartRequest.channel Literal."""
    text = read_text("types.ts")
    start = text.find("export type Channel")
    assert start != -1, "types.ts does not define Channel"
    end = text.find(";", start)
    assert end != -1, "types.ts Channel block not terminated"
    body = text[start:end]
    frontend_channels = {
        m.strip().strip('"').strip("'")
        for m in re.findall(r'["\']([^"\']+)["\']', body)
    }

    # Parse backend StartRequest.channel Literal from schemas.py.
    schema_text = (ROOT.parent.parent / "backend" / "app" / "api" / "schemas.py").read_text()
    start = schema_text.find("channel: Literal[")
    assert start != -1, "schemas.py does not define StartRequest.channel Literal"
    end = schema_text.find("]", start)
    assert end != -1, "schemas.py StartRequest.channel Literal not terminated"
    body = schema_text[start:end]
    backend_channels = {
        m.strip().strip('"').strip("'")
        for m in re.findall(r'["\']([^"\']+)["\']', body)
    }

    missing = backend_channels - frontend_channels
    extra = frontend_channels - backend_channels
    assert not missing, f"frontend Channel is missing backend values: {sorted(missing)}"
    assert not extra, f"frontend Channel has unexpected values: {sorted(extra)}"

