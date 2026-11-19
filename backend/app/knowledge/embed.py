import hashlib
import math
import re
from typing import Protocol

from backend.app.settings import Settings

DIM = 384
DEFAULT_MODEL = "BAAI/bge-small-en-v1.5"


class Embedder(Protocol):
    name: str

    def embed(self, texts: list[str]) -> list[list[float]]: ...


class HashEmbedder:
    """Deterministic bag-of-words embedder. TEST DOUBLE: lexical overlap only, not semantic."""

    name = "hash-384"

    def embed(self, texts: list[str]) -> list[list[float]]:
        return [self._one(t) for t in texts]

    def _one(self, text: str) -> list[float]:
        vec = [0.0] * DIM
        for token in re.findall(r"[a-z0-9]+", text.lower()):
            h = int.from_bytes(hashlib.blake2b(token.encode(), digest_size=8).digest(), "big")
            vec[h % DIM] += 1.0 if (h >> 32) & 1 else -1.0
        norm = math.sqrt(sum(x * x for x in vec))
        return [x / norm for x in vec] if norm else vec


class FastEmbedder:
    """Real local embeddings (ONNX, CPU). The model downloads on first use."""

    def __init__(self, model: str | None = None):
        try:
            from fastembed import TextEmbedding
        except ImportError as error:
            raise RuntimeError("fastembed is not installed: pip install fastembed") from error
        model = model or Settings.from_env().embed_model or DEFAULT_MODEL       
        self.name = f"fastembed:{model}"
        self._model = TextEmbedding(model_name=model)

    def embed(self, texts: list[str]) -> list[list[float]]:
        return [vec.tolist() for vec in self._model.embed(texts)]


def chunk_text(text: str, max_chars: int = 350) -> list[str]:
    """Split on blank lines, merging short paragraphs (like headings) up to max_chars.

    A long paragraph stays whole: cutting mid-sentence hurts retrieval more than size does.
    """
    paragraphs = [p.strip() for p in re.split(r"\n\s*\n", text) if p.strip()]
    chunks: list[str] = []
    buffer = ""
    for paragraph in paragraphs:
        if buffer and len(buffer) + 2 + len(paragraph) > max_chars:
            chunks.append(buffer)
            buffer = paragraph
        else:
            buffer = f"{buffer}\n\n{paragraph}" if buffer else paragraph
    if buffer:
        chunks.append(buffer)
    return chunks