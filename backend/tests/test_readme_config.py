"""Drift guard: every environment variable read by backend/app/settings.py must be
documented in README.md, and README.md must reference the MCP routes."""

from __future__ import annotations

import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
README = (ROOT / "README.md").read_text(encoding="utf-8")
SETTINGS = (ROOT / "backend" / "app" / "settings.py").read_text(encoding="utf-8")

# settings.py reads environment variables via env.get("NAME") inside Settings.from_env.
ENV_RE = re.compile(r'env\.get\("([A-Z_][A-Z0-9_]*)"\)')

# Variables intentionally not documented in README, with a one-line reason each.
ALLOWLIST: dict[str, str] = {
    # HAGGLE_LLM is documented in the Prerequisites and Quick start sections of README.md,
    # not in the Configuration table, so it is listed here to keep the allowlist minimal.
    "HAGGLE_LLM": "documented in Prerequisites and Quick start, not the Configuration table",
}


def test_readme_covers_all_settings_env_vars():
    """Every env var read by settings.py appears in README.md or the allowlist."""
    found_in_settings = set(ENV_RE.findall(SETTINGS))
    assert found_in_settings, "no env vars found in settings.py — regex may be stale"

    missing = []
    for var in sorted(found_in_settings):
        if var in ALLOWLIST:
            continue
        if var not in README:
            missing.append(var)

    assert not missing, (
        f"README.md does not document these settings.py env vars: {missing}. "
        f"Add them to the Configuration table or the allowlist in this test."
    )


def test_readme_mentions_marketplace_routes():
    """README.md references the marketplace channel flag and MCP routes."""
    for token in ("MARKETPLACE_CHANNEL", "/connections", "/capabilities"):
        assert token in README, f"README.md does not contain {token!r}"
