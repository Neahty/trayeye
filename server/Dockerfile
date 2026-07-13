FROM node:20-alpine

WORKDIR /app

COPY package.json ./
RUN npm install --no-audit --no-fund

COPY . .

ENV NODE_ENV=production
ENV PORT=4000

EXPOSE 4000

CMD ["node", "src/index.js"]
