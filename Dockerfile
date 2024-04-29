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


# Pool metadata used for discovery and logging
ENV POOL_DISPLAY_NAME=""
ENV POOL_NAME=""
ENV POOL_DESCRIPTION="A new pool"
ENV POOL_PICTURE=""
ENV POOL_WEBSITE=""
# Pool version (empty = auto)
ENV POOL_VERSION=""

# Config for pool's grpc service
ENV GRPC_BINDING_ADDRESS="0.0.0.0"
ENV GRPC_BINDING_PORT=5000
# Path to GRPC proto descriptor file (used only for grpcui)
ENV GRPC_PROTO_DESCRIPTOR_PATH = ""
# Only set GRPC_SERVER_CRT and GRPC_SERVER_KEY for public certificates
ENV GRPC_CA_CRT="" 
ENV GRPC_SERVER_CRT=""
ENV GRPC_SERVER_KEY=""

# Pool secret key on Nostr (empty = autogenerate on startup)
ENV NOSTR_SECRET_KEY="" 
# Relays to connect to (comma separated)
ENV NOSTR_RELAYS=""

# Events webhook endpoints (csv, used to send json payloads to an external service)
ENV EVENTS_WEBHOOK_ENDPOINTS=""

# Storage paths
ENV BLOB_STORAGE_PATH="/blobs"
# unused
ENV CACHE_PATH="/cache" 

# Used to authenticate nodes and clients
ENV POOL_AUTH_SERVICE=""

# Logging configuration
ENV LOG_LEVEL="debug"

# End point for external logging (empty=disabled)
ENV OPENOBSERVE_ENDPOINT=""
ENV OPENOBSERVE_ORG="default"
ENV OPENOBSERVE_STREAM="default"
ENV OPENOBSERVE_BASICAUTH=""
ENV OPENOBSERVE_USERNAME=""
ENV OPENOBSERVE_PASSWORD=""
ENV OPENOBSERVE_BATCHSIZE="21"
ENV OPENOBSERVE_FLUSH_INTERVAL="5000"
ENV OPENOBSERVE_LOG_LEVEL="debug"


VOLUME /blobs
VOLUME /cache



EXPOSE 5000
USER 1000
CMD ["npm","run", "start"]
