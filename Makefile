migrate:
	python scripts/migrate.py

seed:
	python scripts/seed.py

test:
	pytest -q

check:
	ruff check . && pytest -q

run:
	uvicorn backend.app.main:app --reload
