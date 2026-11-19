# syntax=docker/dockerfile:1.7
FROM node:22-alpine AS builder

WORKDIR /app
RUN apk add --no-cache git openssh-client
COPY package.json package-lock.json ./
RUN npm ci
COPY . .

ARG GIT_USERNAME
RUN --mount=type=secret,id=git_token,required=false \
    if [ -f /run/secrets/git_token ]; then export GIT_TOKEN="$(cat /run/secrets/git_token)"; fi && \
    npm run build

FROM nginx:alpine AS production
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=builder /app/dist/ /usr/share/nginx/html/

EXPOSE 80
