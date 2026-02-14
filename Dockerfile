# ─── N8N LABZ Setup Panel ───
FROM node:20-alpine AS frontend-build

WORKDIR /app/frontend
COPY frontend/package*.json ./
RUN npm install
COPY frontend/ ./
RUN npx vite build

# ─── Production ───
FROM node:20-alpine

RUN apk add --no-cache docker-cli docker-cli-compose curl tzdata

WORKDIR /app

COPY backend/package*.json ./backend/
RUN cd backend && npm install --production

COPY backend/ ./backend/
COPY --from=frontend-build /app/frontend/dist ./frontend/dist

ENV NODE_ENV=production
ENV PORT=3080

EXPOSE 3080

CMD ["node", "backend/server.js"]
