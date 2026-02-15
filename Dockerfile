FROM node:20-bookworm-slim

ENV NODE_ENV=production
WORKDIR /app

COPY --chown=node:node package.json package-lock.json ./
RUN npm ci --omit=dev

COPY --chown=node:node . .

ENV PORT=8080
EXPOSE 8080

USER node
CMD ["node", "server.js"]
