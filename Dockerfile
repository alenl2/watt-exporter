FROM node:latest

ARG BUILD_VERSION=0.0.0

# Create app directory
WORKDIR /app

COPY package.json ./
COPY yarn.lock ./

RUN yarn install --production

# Bundle app source
COPY . .
RUN npm version "$BUILD_VERSION"

EXPOSE 3000
USER root
ENTRYPOINT [ "yarn", "start" ]