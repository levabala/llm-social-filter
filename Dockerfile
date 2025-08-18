FROM oven/bun:1.2.20-alpine

WORKDIR /app

COPY package.json bun.lock* tsconfig.json ./
COPY src ./src

RUN bun install --frozen-lockfile

# Create data directory for database files
RUN mkdir -p /app/data

LABEL org.opencontainers.image.source=https://github.com/levabala/llm-social-filter
LABEL org.opencontainers.image.description="LLM Social Filter - AI-powered content filtering for social media"
LABEL org.opencontainers.image.licenses=MIT

CMD ["bun", "run", "src/index.ts"]
