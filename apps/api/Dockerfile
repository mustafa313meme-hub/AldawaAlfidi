FROM node:20-slim AS build
RUN apt-get update && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package*.json ./
# Uses the lock file when present (commit package-lock.json, then this is reproducible).
RUN if [ -f package-lock.json ]; then npm ci; else npm install --no-audit --no-fund; fi
COPY . .
RUN npx prisma generate && npm run build

FROM node:20-slim
RUN apt-get update && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*
WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
RUN if [ -f package-lock.json ]; then npm ci --omit=dev; else npm install --omit=dev --no-audit --no-fund; fi && npm i prisma@5 --no-save --no-audit --no-fund
COPY --from=build /app/dist ./dist
COPY --from=build /app/prisma ./prisma
RUN npx prisma generate
USER node
EXPOSE 3000
CMD ["node", "dist/main.js"]
