FROM node:24-bookworm-slim
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@11.19.0 --activate
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --prod --frozen-lockfile
COPY server.js ./
COPY public ./public
COPY scripts ./scripts
RUN mkdir -p /var/data && chown node:node /var/data
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3000 DATABASE_FILE=/var/data/reservations.sqlite
USER node
EXPOSE 3000
CMD ["node", "server.js"]
