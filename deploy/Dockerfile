# Bobber Run's web client as a container (for Unkey Compute): the Vite build, served by Caddy with the same headers,
# CSP and caching as on Railway (../Caddyfile). It lives here, not at the root, so Railway keeps building with Railpack.
#   docker build -f deploy/Dockerfile -t bobber-web .
#   docker run -p 8080:8080 bobber-web
FROM oven/bun:1 AS build
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile
COPY . .
# the public endpoints baked into the client; the defaults are production
ARG VITE_CONVEX_URL=https://strong-magpie-681.convex.cloud
ARG VITE_RELAY_URL=wss://relay-production-a8ce.up.railway.app
RUN bun run build

FROM caddy:2-alpine
COPY --from=build /app/dist /srv
COPY Caddyfile /etc/caddy/Caddyfile.railpack
RUN sed 's|{{.DIST_DIR}}|/srv|' /etc/caddy/Caddyfile.railpack > /etc/caddy/Caddyfile
# Unkey routes to $PORT (8080 by default)
ENV PORT=8080
EXPOSE 8080
CMD ["caddy", "run", "--config", "/etc/caddy/Caddyfile", "--adapter", "caddyfile"]
