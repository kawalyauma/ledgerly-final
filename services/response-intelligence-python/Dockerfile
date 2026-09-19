FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

WORKDIR /app
COPY pyproject.toml README.md ./
COPY src ./src
RUN pip install --no-cache-dir .

EXPOSE 8091
CMD ["uvicorn", "ledgerly_response_intelligence.api:app", "--host", "0.0.0.0", "--port", "8091"]
