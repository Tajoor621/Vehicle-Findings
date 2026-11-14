FROM node:22-alpine
WORKDIR /app
COPY package.json index.html ./
COPY src ./src
COPY public ./public
ENV HOST=0.0.0.0
EXPOSE 3000
CMD ["node", "src/server.js"]
