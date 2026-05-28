# Official Playwright image — Chromium pre-installed and configured
FROM mcr.microsoft.com/playwright:v1.60.0-jammy

WORKDIR /app

# Install dependencies only (layer cache)
COPY package*.json ./
RUN npm install --omit=dev

# Copy app
COPY index.js ./

# Cloud Run expects port 8080
EXPOSE 8080
ENV PORT=8080
ENV NODE_ENV=production

CMD ["node", "index.js"]
