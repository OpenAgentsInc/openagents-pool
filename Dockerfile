# Builder
FROM node:18 as builder

ADD . /app
WORKDIR /app
#RUN  apk add --no-cache bash wget python3 py3-pip&& \
#export NO_CONDA="1" && \
#npm i && npm run build
RUN apt update && apt install -y bash wget python3 python3-pip && \
apt clean && \
export NO_CONDA="1" && \
npm i && npm run build

# Runner
FROM node:18
RUN mkdir -p /app
WORKDIR /app
COPY --from=builder /app/build /app/build
COPY package.json /app
COPY package-lock.json /app
RUN \
npm i --production && \
chown 1000:1000 -Rf /app 

ENV GRPC_BINDING_ADDRESS="0.0.0.0"
ENV GRPC_BINDING_PORT=5000

ENV GRPC_CA_CRT=""
ENV GRPC_SERVER_CRT=""
ENV GRPC_SERVER_KEY=""

# NOSTR_CONNECT_SECRET_KEY empty = generate random key
ENV NOSTR_SECRET_KEY="" 
ENV NOSTR_RELAYS=""

EXPOSE 5000

USER 1000
CMD ["npm","run", "start"]
