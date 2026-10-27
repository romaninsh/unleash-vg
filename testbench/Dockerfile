# syntax=docker/dockerfile:1
# The test bench against the deployed SDK API (.github/workflows/deploy-bench.yaml).
#   docker build -t unleash-vg-bench testbench
# deploy.config.json names the target and its brands; the SDK tokens come from TESTBENCH_TOKENS at
# run time, so the image holds no token.
FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npx vite build

FROM node:24-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY server server
COPY deploy.config.json ./
COPY --from=build /app/dist dist
ENV TESTBENCH_CONFIG=deploy.config.json HOST=0.0.0.0
USER node
CMD ["node", "server/main.ts"]
