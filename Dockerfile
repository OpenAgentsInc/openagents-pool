# Builder
FROM node:alpine as builder

ADD . /app
WORKDIR /app
RUN  apk add --no-cache bash wget python3 py3-pip&& \
export NO_CONDA="1" && \
npm i && npm run build

# Runner
FROM node:alpine
RUN mkdir -p /app
WORKDIR /app
COPY --from=builder /app/build /app/build
COPY package.json /app
COPY package-lock.json /app
RUN \
npm i --production && \
chown 1000:1000 -Rf /app 

ENV NOSTR_CONNECT_GRPC_BINDING_ADDRESS="0.0.0.0"
ENV NOSTR_CONNECT_GRPC_BINDING_PORT=5000
ENV NOSTR_CONNECT_GRPC_DESCRIPTOR_PATH="/app/build/docs/descriptor.pb"
ENV NOSTR_CONNECT_DOCS_PATH="/app/build/docs"
ENV NOSTR_CONNECT_DOCS_PORT=5001
ENV NOSTR_CONNECT_DOCS_BINDING_ADDRESS="0.0.0.0"

# NOSTR_CONNECT_SECRET_KEY empty = generate random key
ENV NOSTR_CONNECT_SECRET_KEY="" 

EXPOSE 5000
EXPOSE 5001

USER 1000
CMD ["npm","run", "start"]
