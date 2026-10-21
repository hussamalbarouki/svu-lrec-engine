FROM node:22-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg ca-certificates tini && rm -rf /var/lib/apt/lists/* && mkdir -p /work && chown node:node /work
WORKDIR /app
COPY --chown=node:node package.json ./
COPY --chown=node:node src/ ./src/
USER node
ENV NODE_ENV=production PORT=3000 WORK_ROOT=/work MAX_UPLOAD_MB=256 MAX_MINUTES=180 FPS=5
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 CMD node -e 'fetch("http://127.0.0.1:3000/healthz").then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))'
ENTRYPOINT ["/usr/bin/tini","--"]
CMD ["node","src/server.mjs"]
