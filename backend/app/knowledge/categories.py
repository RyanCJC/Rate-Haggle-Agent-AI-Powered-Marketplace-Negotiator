import re
from dataclasses import dataclass


@dataclass(frozen=True)
class Category:
    name: str
    label: str
    keywords: tuple[str, ...] = ()
    extra_keys: tuple[str, ...] = ()


# One table drives the category list, the guess from a title, and the extra facts to ask about.
CATEGORIES: tuple[Category, ...] = (
    Category(
        "monitors",
        "Monitor",
        ("monitor", "ultrawide", "144hz", "165hz", "240hz"),
        ("size_inch", "refresh_rate"),
    ),
    Category(
        "phones",
        "Phone",
        (
            "iphone",
            "smartphone",
            "phone",
            "galaxy",
            "google pixel",
            "redmi",
            "xiaomi",
            "oppo",
            "vivo",
            "huawei",
            "oneplus",
        ),
        ("storage", "battery_health"),
    ),
    Category(
        "laptops",
        "Laptop",
        ("laptop", "macbook", "thinkpad", "notebook", "chromebook", "ideapad", "zenbook"),
        ("storage",),
    ),
    Category(
        "cameras",
        "Camera",
        ("camera", "dslr", "mirrorless", "gopro", "shutter", "fujifilm", "nikon", "canon eos"),
        ("shutter_count",),
    ),
    Category(
        "consoles",
        "Game console",
        ("playstation", "ps5", "ps4", "xbox", "nintendo", "steam deck", "game console"),
        ("storage",),
    ),
    Category(
        "furniture",
        "Furniture",
        ("sofa", "couch", "table", "desk", "chair", "wardrobe", "mattress", "bookshelf", "cabinet"),
    ),
    Category(
        "appliances",
        "Home appliance",
        (
            "fridge",
            "refrigerator",
            "washing machine",
            "dryer",
            "aircond",
            "air conditioner",
            "microwave",
            "air fryer",
            "vacuum",
            "rice cooker",
            "dishwasher",
        ),
    ),
    Category("other", "Other"),
)

CATEGORY_NAMES = tuple(category.name for category in CATEGORIES)


def _hits(text: str, keywords: tuple[str, ...]) -> int:
    """How many different keywords appear as whole words (a plural 's' is allowed)."""
    return sum(1 for word in keywords if re.search(rf"\b{re.escape(word)}s?\b", text))


def infer_category(title: str | None, description: str | None = None) -> str | None:
    """Best guess from keywords; a title match counts triple. None when nothing matches or
    two categories tie, so an unclear listing stays unclassified rather than mislabelled."""
    title_text, body_text = (title or "").lower(), (description or "").lower()
    scores: dict[str, int] = {}
    for category in CATEGORIES:
        score = 3 * _hits(title_text, category.keywords) + _hits(body_text, category.keywords)
        if score:
            scores[category.name] = score
    if not scores:
        return None
    ranked = sorted(scores.values(), reverse=True)
    if len(ranked) > 1 and ranked[0] == ranked[1]:
        return None
    return max(scores, key=lambda name: scores[name])


def resolve_category(
    chosen: str | None, title: str | None, description: str | None
) -> tuple[str | None, bool]:
    """(category, guessed). A specific choice is always kept; 'other' or nothing is guessed."""
    if chosen and chosen != "other":
        return chosen, False
    guess = infer_category(title, description)
    if guess:
        return guess, True
    return chosen, False