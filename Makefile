.PHONY: dev web api test example

dev:
	@echo "Run 'make web' and 'make api' in separate terminals."

web:
	pnpm dev

api:
	cd apps/api && uvicorn app.main:app --reload --port 8000

test:
	pnpm test
	cd apps/api && pytest

example:
	cd apps/api && python scripts/generate_example.py
