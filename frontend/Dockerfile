# syntax=docker/dockerfile:1

# Production image for the React frontend.
#
# Multi-stage build:
#   Stage 1 (builder) — npm ci + typecheck + vite build.
#   Stage 2 (runtime)  — nginx serving the static bundle with an SPA fallback
#                        and a reverse proxy from /api to the backend service.
#
# Build:  docker build -f frontend/Dockerfile -t eval-frontend:<tag> frontend

# ---------- Stage 1: build the SPA ----------
FROM node:22-alpine AS builder

WORKDIR /app

# Install dependencies first (better layer caching).
COPY package.json package-lock.json ./
RUN npm ci

# Copy the rest of the source and build.
COPY . .
# VITE_API_URL contract (implemented in frontend/src/services/apiUrl.ts):
#   "" (empty)        -> same-origin; the browser resolves "/api/..." itself.
#   "/api"            -> same-origin path prefix; requests stay "/api/..." and
#                        the prefix is never duplicated into "/api/api/...".
#   absolute origin   -> requests go straight to that origin (the `vite dev`
#                        default is http://localhost:8000).
# VITE_WS_URL overrides the live-updates socket base; when unset it is derived
# from VITE_API_URL and the page origin (http -> ws, https -> wss).
ARG VITE_API_URL=/api
ENV VITE_API_URL=${VITE_API_URL}
RUN npm run build

# ---------- Stage 2: serve with nginx ----------
FROM nginx:1.27-alpine AS runtime

# SPA fallback + /api reverse proxy to the backend service.
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=builder /app/dist /usr/share/nginx/html

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]