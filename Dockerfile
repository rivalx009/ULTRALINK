FROM node:22-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts
COPY server.js accounts.js postgres-store.js migrate-accounts.js desktop-url.txt ./
COPY public ./public
ENV PORT=8080
EXPOSE 8080
CMD ["node","server.js"]
