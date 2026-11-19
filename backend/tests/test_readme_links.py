import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
LINK = re.compile(r"!?\[[^\]]*\]\(([^)\s]+)\)")
FILES = [ROOT / "README.md", *sorted((ROOT / "docs").glob("*.md"))]


def test_relative_links_and_images_point_to_files_that_exist():
    missing = []
    for doc in FILES:
        for target in LINK.findall(doc.read_text(encoding="utf-8")):
            if target.startswith(("http://", "https://", "mailto:", "#")):
                continue
            path = target.split("#")[0]
            if path and not (doc.parent / path).exists():
                missing.append(f"{doc.relative_to(ROOT)} -> {target}")
    assert not missing, missing


def test_the_docs_do_not_claim_there_is_no_offline_model():
    text = (ROOT / "README.md").read_text(encoding="utf-8")
    assert "no offline fallback" not in text
    assert "always uses a live" not in text
