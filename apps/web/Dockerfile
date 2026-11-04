FROM node:20-slim AS build

RUN npm install -g pnpm@9

WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
RUN pnpm install --frozen-lockfile

# Copying merges, so remove the previous source tree first; otherwise files
# deleted from the repo stay in the image and can be bundled by Vite.
RUN rm -rf apps/web/src apps/web/public
COPY apps/web apps/web
RUN pnpm --filter @arkpay/web build

FROM nginx:1.27-alpine

COPY deploy/web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/apps/web/dist /usr/share/nginx/html

EXPOSE 3000
CMD ["nginx", "-g", "daemon off;"]
