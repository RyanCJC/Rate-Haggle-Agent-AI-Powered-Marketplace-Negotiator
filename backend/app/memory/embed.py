import hashlib
import itertools
import math
import re

DIM = 384  # the same width as the other vector columns
NAME = "hash-v1"  # stored with every vector, so a future embedder can be told apart

_WORD = re.compile(r"[a-z0-9]+")


def _features(text: str):
    words = _WORD.findall(text.lower())
    for word in words:
        yield word, 1.0
        if len(word) >= 4:  # character trigrams: "monitor" matches "monitors"
            padded = f"#{word}#"
            for i in range(len(padded) - 2):
                yield padded[i : i + 3], 0.4
    for first, second in itertools.pairwise(words):
        yield f"{first} {second}", 0.6


def embed(text: str) -> list[float]:
    """A deterministic, offline embedding (feature hashing). No model, no network.
    It matches similar WORDING, not meaning."""
    vector = [0.0] * DIM
    count = 0
    for feature, weight in _features(text):
        digest = hashlib.blake2b(feature.encode(), digest_size=8).digest()
        number = int.from_bytes(digest, "big")
        vector[number % DIM] += weight if (number >> 40) & 1 else -weight
        count += 1
    norm = math.sqrt(sum(x * x for x in vector))
    if not count or not norm:
        raise ValueError("nothing to embed")
    return [x / norm for x in vector]