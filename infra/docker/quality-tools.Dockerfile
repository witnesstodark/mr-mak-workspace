FROM python:3.12-slim

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        ca-certificates \
        curl \
        ffmpeg \
        imagemagick \
        jq \
        sox \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /workspace
