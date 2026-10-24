FROM node:24-bookworm-slim AS dependencies
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

FROM dependencies AS build
ARG NEXT_PUBLIC_BASE_PATH=/study
ENV NEXT_PUBLIC_BASE_PATH=$NEXT_PUBLIC_BASE_PATH NEXT_TELEMETRY_DISABLED=1
COPY . .
RUN npm test && npm run build

FROM node:24-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 HOSTNAME=0.0.0.0 PORT=3000 DATABASE_PATH=/data/wordsteps.sqlite
RUN mkdir -p /data && chown node:node /data
COPY --from=build --chown=node:node /app/.next/standalone ./
COPY --from=build --chown=node:node /app/.next/static ./.next/static
COPY --from=build --chown=node:node /app/public ./public
COPY --from=build --chown=node:node /app/drizzle ./drizzle
COPY --from=build --chown=node:node /app/scripts/create-admin.mjs ./scripts/create-admin.mjs
COPY --from=build --chown=node:node /app/lib/auth-password.ts ./lib/auth-password.ts
USER node
EXPOSE 3000
CMD ["node", "server.js"]
