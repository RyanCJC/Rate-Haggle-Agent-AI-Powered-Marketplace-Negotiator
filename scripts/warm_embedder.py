"""Warm the embedder used by KnowledgeSearch.

Creates the same FastEmbedder the app uses (Settings.from_env().embed_model),
embeds one short string, and prints only the model name, vector length, and
elapsed seconds. Does not touch the database.
"""

import time

from backend.app.knowledge.embed import FastEmbedder
from backend.app.settings import Settings


def main() -> None:
    settings = Settings.from_env()
    model = settings.embed_model
    embedder = FastEmbedder(model=model)
    start = time.monotonic()
    vecs = embedder.embed(["warm-up query"])
    elapsed = time.monotonic() - start
    print(f"{embedder.name} {len(vecs[0])} {elapsed:.3f}s")


if __name__ == "__main__":
    main()
