.PHONY: install install-training install-qlora test lint typecheck check run training-stats

install:
	python -m pip install -e ".[dev]"

install-training:
	python -m pip install -e ".[dev,training]"

install-qlora:
	python -m pip install -e ".[dev,training,qlora]"

test:
	pytest -q

lint:
	ruff check src tests

typecheck:
	mypy src

check:
	python -m compileall -q src tests
	ruff check src tests
	mypy src
	pytest -q

run:
	ledgerly-response-intelligence serve

training-stats:
	ledgerly-response-intelligence training-stats
