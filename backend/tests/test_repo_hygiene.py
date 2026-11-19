import os
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SKIP = {".venv", "node_modules", ".git", "dist", "__pycache__", ".pytest_cache", ".ruff_cache"}
SUFFIXES = {".py", ".md", ".ts", ".tsx", ".sql", ".toml", ".json", ".yml", ".yaml"}
MARKER = "TODO: " + "filled in"  # split, so this file does not flag itself


def source_files():
    for folder, dirs, files in os.walk(ROOT):
        dirs[:] = [d for d in dirs if d not in SKIP]
        for name in files:
            if Path(name).suffix in SUFFIXES:
                yield Path(folder) / name


def test_no_placeholder_stubs_are_left_in_the_repository():
    offenders = [
        str(path.relative_to(ROOT))
        for path in source_files()
        if MARKER in path.read_text(encoding="utf-8", errors="ignore")
    ]
    assert offenders == []