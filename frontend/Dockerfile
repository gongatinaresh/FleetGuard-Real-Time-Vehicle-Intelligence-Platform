FROM node:20-alpine AS build

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build

FROM nginx:alpine AS production

ENV VITE_API_BASE_URL=/api \
    VITE_WS_URL=/ws \
    NGINX_ENVSUBST_TEMPLATE_DIR=/etc/nginx/runtime-templates \
    NGINX_ENVSUBST_OUTPUT_DIR=/usr/share/nginx/html \
    NGINX_ENVSUBST_FILTER=VITE_API_BASE_URL|VITE_WS_URL

COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
COPY runtime-config.js.template /etc/nginx/runtime-templates/runtime-config.js.template

EXPOSE 80

HEALTHCHECK --interval=10s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1/healthz || exit 1
