.PHONY: install test lint typecheck check run

install:
	python -m pip install -e ".[dev]"

test:
	pytest -q

lint:
	ruff check src tests

typecheck:
	mypy src

check:
	python -m compileall -q src tests
	ruff check src tests
	pytest -q

run:
	ledgerly-response-intelligence serve
