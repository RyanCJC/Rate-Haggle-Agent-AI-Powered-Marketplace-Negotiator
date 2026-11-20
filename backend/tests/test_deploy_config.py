"""Text-based deploy configuration checks (no YAML library needed)."""

from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
RENDER = ROOT / "render.yaml"
VERCEL = ROOT / "frontend" / "vercel.json"


def test_render_yaml_has_health_check_path():
    text = RENDER.read_text(encoding="utf-8")
    assert "healthCheckPath: /health" in text


def test_render_yaml_does_not_set_haggle_llm():
    text = RENDER.read_text(encoding="utf-8")
    assert "HAGGLE_LLM" not in text


def test_render_yaml_secret_keys_use_sync_false():
    text = RENDER.read_text(encoding="utf-8")
    lines = text.splitlines()
    for i, line in enumerate(lines):
        stripped = line.strip()
        if stripped.startswith("- key: ") and stripped.split(" ", 1)[1] in (
            "DATABASE_URL",
            "LLM_BASE_URL",
            "LLM_API_KEY",
            "LLM_MODEL",
            "CORS_ORIGINS",
        ):
            assert i + 1 < len(lines), f"missing sync: false after {stripped}"
            assert lines[i + 1].strip() == "sync: false", f"expected sync: false after {stripped}"


def test_no_secret_values_in_deploy_files():
    for path in (RENDER, VERCEL):
        text = path.read_text(encoding="utf-8")
        assert "postgres://" not in text.lower()
        assert not any(
            line.strip().startswith('"sk-') or line.strip().startswith("sk-")
            for line in text.splitlines()
        )


def test_start_command_matches_makefile_run():
    render_text = RENDER.read_text(encoding="utf-8")
    makefile_text = (ROOT / "Makefile").read_text(encoding="utf-8")
    # The module path (backend.app.api.main:app) must match between Makefile run and render.yaml.
    assert "backend.app.api.main:app" in render_text
    assert "backend.app.api.main:app" in makefile_text


def test_cors_origins_parse_vercel_and_localhost():
    from backend.app.settings import Settings

    s = Settings.from_env({"CORS_ORIGINS": "https://a.vercel.app, http://localhost:5173"})
    assert s.cors_origins == ("https://a.vercel.app", "http://localhost:5173")
