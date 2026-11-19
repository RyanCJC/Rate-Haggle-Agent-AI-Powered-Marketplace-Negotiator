from dataclasses import dataclass

from .embed import Embedder, chunk_text


@dataclass(frozen=True)
class Doc:
    category: str
    source: str  # file name, shown as the citation
    text: str


@dataclass(frozen=True)
class Passage:
    source: str
    text: str
    score: float  # cosine similarity, higher is closer


def to_vector(values: list[float]) -> str:
    return "[" + ",".join(f"{x:.6f}" for x in values) + "]"


def index_documents(conn, docs: list[Doc], embedder: Embedder) -> int:
    """Replace the chunks of each document for this embedder. Returns chunks written."""
    total = 0
    for doc in docs:
        chunks = chunk_text(doc.text)
        vectors = embedder.embed(chunks)
        conn.execute(
            "DELETE FROM knowledge_chunks WHERE source = %s AND embedder = %s",
            (doc.source, embedder.name),
        )
        for index, (chunk, vector) in enumerate(zip(chunks, vectors, strict=True)):
            conn.execute(
                "INSERT INTO knowledge_chunks (category, source, chunk_index, text, embedding, "
                "embedder) VALUES (%s, %s, %s, %s, %s::vector, %s)",
                (doc.category, doc.source, index, chunk, to_vector(vector), embedder.name),
            )
        total += len(chunks)
    return total


def search_knowledge(
    conn, embedder: Embedder, query: str, category: str | None = None, k: int = 3
) -> list[Passage]:
    vector = to_vector(embedder.embed([query])[0])
    rows = conn.execute(
        "SELECT source, text, 1 - (embedding <=> %s::vector) FROM knowledge_chunks "
        "WHERE embedder = %s AND (%s::text IS NULL OR category = %s OR category = 'general') "
        "ORDER BY embedding <=> %s::vector LIMIT %s",
        (vector, embedder.name, category, category, vector, k),
    ).fetchall()
    return [Passage(source, text, float(score)) for source, text, score in rows]


def knowledge_lookup(conn, embedder: Embedder, k: int = 3):
    """Adapter for the graph's search_knowledge tool: (query, category) -> ['source: text']."""

    def lookup(query: str, category: str | None) -> list[str]:
        found = search_knowledge(conn, embedder, query, category, k)
        return [f"{p.source}: {p.text}" for p in found]

    return lookup