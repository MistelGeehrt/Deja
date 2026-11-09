FROM node:22-alpine
WORKDIR /app
COPY package*.json tsconfig.json ./
COPY src ./src
RUN npm ci && npm run build && npm prune --omit=dev
CMD ["node", "dist/index.js"]
