FROM node:22-bookworm-slim AS dependencies
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

FROM dependencies AS build
COPY . .
RUN pnpm build

FROM nginx:1.28-alpine AS web
COPY deploy/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
HEALTHCHECK --interval=15s --timeout=3s CMD wget -q -O /dev/null http://127.0.0.1/healthz || exit 1

FROM dependencies AS emulators
COPY --from=eclipse-temurin:21-jre /opt/java/openjdk /opt/java/openjdk
ENV JAVA_HOME=/opt/java/openjdk
ENV PATH="/opt/java/openjdk/bin:${PATH}"
COPY firebase.json firestore.rules ./
COPY deploy/emulators.sh /app/emulators.sh
RUN chmod +x /app/emulators.sh
EXPOSE 4000 8081 9099
ENTRYPOINT ["/app/emulators.sh"]
