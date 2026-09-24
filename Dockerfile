FROM node:20-slim

WORKDIR /app

# Avval faqat bog'liqliklar — kesh uchun
COPY package*.json ./
RUN npm ci --omit=dev || npm install --omit=dev

# Qolgan kod
COPY . .

# Ma'lumotlar (db.json) shu papkada — volume sifatida ulanadi
RUN mkdir -p /app/data
VOLUME /app/data

ENV PORT=3000
EXPOSE 3000

# Konteyner sog'ligini tekshirish
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD node -e "fetch('http://localhost:'+(process.env.PORT||3000)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "src/index.js"]
