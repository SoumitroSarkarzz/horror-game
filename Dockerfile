FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --include=dev --no-audit --no-fund
COPY tsconfig.server.json ./
COPY shared ./shared
COPY server ./server
RUN npx tsc -p tsconfig.server.json
FROM node:24-bookworm-slim
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund
COPY --from=build /app/dist-server ./dist-server
ENV PORT=3001 SAVE_DIR=/app/data
RUN mkdir -p /app/data && chown -R node:node /app
USER node
EXPOSE 3001
CMD ["npm","start"]
