FROM node:20-slim

ENV NODE_ENV=production
WORKDIR /app

# ffmpeg — AI Kontent studiyada Reels video yasash uchun (src/videoMaker.js); shrift — avto-Reels kadrlaridagi matn uchun
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg fonts-dejavu-core && rm -rf /var/lib/apt/lists/*

# Avval faqat bog'liqliklar — kesh uchun. package-lock.json bilan aniq mos kelmasa build to'xtaydi.
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

# Qolgan kod (.dockerignore: .env, data, backups, testlar kirmaydi)
COPY --chown=node:node . .

# Ma'lumotlar va zaxiralar — volume sifatida ulanadi (docker-compose.yml)
RUN mkdir -p /app/data /app/backups && chown -R node:node /app/data /app/backups
VOLUME ["/app/data", "/app/backups"]

# Root emas — ilovadagi zaiflik butun konteynerni egallashga olib kelmasin
USER node

ENV PORT=3015
EXPOSE 3015

# Konteyner sog'ligini tekshirish
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
  CMD node -e "fetch('http://localhost:'+(process.env.PORT||3015)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "src/index.js"]
