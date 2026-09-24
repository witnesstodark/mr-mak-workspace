FROM python:3.12-slim

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        ca-certificates \
        ffmpeg \
        imagemagick \
        python3-pil \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /workspace
