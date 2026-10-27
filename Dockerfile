# syntax=docker/dockerfile:1
# The admin web app (api/flags.yaml and web/flags/) on vantage-server, as deployed to Cloud Run
# (.github/workflows/deploy-admin.yaml). The SDK API has its own image: service/Dockerfile.
#   docker build --platform linux/amd64 -t unleash-vg-admin .
# Secrets come from the environment at run time (VANTAGE_PROFILE=prod, SECRET_*), and the
# sign-in tokens file is mounted at /app/project/private/web-tokens.yaml: neither is in the image.
ARG WEB_DEV=romaninsh/vantage-web-dev:1.8.6
ARG SERVER=romaninsh/vantage-server:1.8.6

# The built site is plain files, so this stage runs natively even when the
# image is for another platform.
FROM --platform=$BUILDPLATFORM ${WEB_DEV} AS web
ARG API=flags
# 1 = the sign-in page lists the seeded demo users (the hosted demo); unset for real use
ARG VITE_DEMO_SIGN_IN=
ENV VITE_DEMO_SIGN_IN=${VITE_DEMO_SIGN_IN}
COPY --chown=node:node web/${API} /app
RUN node /opt/vantage/entrypoint/main.mjs build --out /app/out

FROM ${SERVER}
ARG API=flags
COPY application.yaml /app/project/application.yaml
COPY datasource /app/project/datasource
COPY table /app/project/table
COPY api /app/project/api
COPY action /app/project/action
# the tables' log_changes scripts (!include ../script/…) and the pages the API's actions read
COPY script /app/project/script
COPY page /app/project/page
COPY --from=web /app/out /app/web
ENV VANTAGE_API=${API}
CMD ["--static", "/app/web"]
