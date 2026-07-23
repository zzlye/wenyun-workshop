# ---- 构建阶段 ----
FROM --platform=$BUILDPLATFORM node:20-alpine AS build

WORKDIR /app

ARG APP_VERSION=0.4.13
ENV APP_VERSION=$APP_VERSION
ENV VITE_DEFAULT_API_URL=__VITE_DEFAULT_API_URL_PLACEHOLDER__
ENV VITE_API_PROXY_AVAILABLE=__VITE_API_PROXY_AVAILABLE_PLACEHOLDER__
ENV VITE_API_PROXY_LOCKED=__VITE_API_PROXY_LOCKED_PLACEHOLDER__
ENV VITE_DOCKER_DEPLOYMENT=__VITE_DOCKER_DEPLOYMENT_PLACEHOLDER__
ENV VITE_DOCKER_LEGACY_API_URL_USED=__VITE_DOCKER_LEGACY_API_URL_USED_PLACEHOLDER__

COPY package.json package-lock.json ./
RUN npm ci --legacy-peer-deps

COPY . .
RUN npm run build

# ---- 运行阶段 ----
FROM nginx:alpine

RUN apk add --no-cache nodejs

ARG APP_VERSION=0.4.13
LABEL org.opencontainers.image.title="wenyun-workshop"
LABEL org.opencontainers.image.version=$APP_VERSION

ENV HOST=0.0.0.0
ENV PORT=80
ENV DEFAULT_API_URL=https://api.zzlye.xyz/v1
ENV API_PROXY_URL=https://api.zzlye.xyz/v1
ENV ENABLE_API_PROXY=true
ENV LOCK_API_PROXY=true
ENV IMAGE_RELAY_HOST=127.0.0.1
ENV IMAGE_RELAY_PORT=8787
ENV IMAGE_RELAY_UPSTREAM=http://new-api:3000/v1
ENV IMAGE_RELAY_HEARTBEAT_MS=10000
ENV IMAGE_RELAY_TIMEOUT_MS=900000

COPY --from=build /app/dist /usr/share/nginx/html
COPY deploy/nginx.conf /etc/nginx/templates/default.conf.template
COPY --chmod=755 deploy/migrate-api-env.envsh /docker-entrypoint.d/05-migrate-api-env.envsh
COPY --chmod=755 deploy/inject-api-url.sh /docker-entrypoint.d/40-inject-api-url.sh
COPY server/image-relay.mjs /opt/wenyun/image-relay.mjs
COPY --chmod=755 deploy/start-services.sh /opt/wenyun/start-services.sh

EXPOSE 80

CMD ["/opt/wenyun/start-services.sh"]
