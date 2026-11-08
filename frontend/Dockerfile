FROM node:20-alpine AS build

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build

FROM nginx:alpine AS production

ENV VITE_API_BASE_URL=/api \
    VITE_WS_URL=/ws \
    BACKEND_URL=http://backend:8000 \
    PORT=80 \
    NGINX_ENVSUBST_FILTER=BACKEND_URL|PORT

COPY nginx.conf /etc/nginx/templates/default.conf.template
COPY --from=build /app/dist /usr/share/nginx/html
COPY runtime-config.js.template /etc/fleetguard/runtime-config.js.template
COPY docker-entrypoint.d/10-runtime-config.sh /docker-entrypoint.d/10-runtime-config.sh
RUN chmod +x /docker-entrypoint.d/10-runtime-config.sh

EXPOSE 80

HEALTHCHECK --interval=10s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -q -O /dev/null "http://127.0.0.1:$PORT/healthz" || exit 1
