FROM oven/bun:1 AS base
WORKDIR /app

# Install dependencies
COPY package.json bun.lock ./
COPY dashboard/package.json dashboard/
RUN bun install --frozen-lockfile
RUN cd dashboard && bun install --frozen-lockfile

# Build dashboard
COPY dashboard/ dashboard/
RUN cd dashboard && bun run build

# Copy server source
COPY src/ src/
COPY tsconfig.json config.example.json ./

# Expose port
EXPOSE 3000

# Run
CMD ["bun", "run", "src/index.ts"]
