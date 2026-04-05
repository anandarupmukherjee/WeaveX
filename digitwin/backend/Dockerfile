FROM python:3.12-slim

WORKDIR /app

# System deps for document parsing (pymupdf, unstructured)
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential libffi-dev libmagic1 poppler-utils tesseract-ocr \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# Persistent data directory
RUN mkdir -p /app/data/uploads /app/data/extractions /app/data/chroma

EXPOSE 5001

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "5001"]
