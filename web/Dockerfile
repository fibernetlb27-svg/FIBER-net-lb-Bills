FROM node:24-bookworm-slim
ENV NODE_ENV=production
WORKDIR /app
RUN groupadd --gid 10001 fiber && useradd --uid 10001 --gid fiber --no-create-home fiber
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force
COPY --chown=root:root server.cjs ./server.cjs
COPY --chown=root:root lib ./lib
COPY --chown=root:root app ./app
COPY --chown=root:root tools/verify-backup.cjs ./tools/verify-backup.cjs
USER 10001:10001
ENV BIND_ADDRESS=0.0.0.0 PORT=3000 DATA_DIRECTORY=/data SECRETS_KEY_FILE=/run/secrets/server-key PROVIDERS_ENABLED=false
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 CMD ["node", "-e", "require('node:http').get('http://127.0.0.1:3000/health',{headers:{Host:new URL(process.env.APP_ORIGIN).host}},r=>{r.resume();if(r.statusCode!==200)process.exit(1)}).on('error',()=>process.exit(1))"]
CMD ["node", "server.cjs"]
