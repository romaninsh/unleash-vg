# flag-service: the Unleash-compatible SDK API. Built and run by composer.yaml.
FROM rust:1-bookworm AS build
WORKDIR /src
COPY Cargo.toml Cargo.lock ./
COPY src ./src
RUN cargo build --release --locked

FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates curl && rm -rf /var/lib/apt/lists/*
COPY --from=build /src/target/release/flag-service /usr/local/bin/flag-service
ENV PORT=4380
EXPOSE 4380
HEALTHCHECK --interval=5s --timeout=2s --retries=10 CMD curl -fsS http://127.0.0.1:${PORT}/health || exit 1
ENTRYPOINT ["flag-service"]
