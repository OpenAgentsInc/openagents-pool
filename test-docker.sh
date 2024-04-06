#!/bin/bash
set -e
bash build-docker.sh

docker run \
-p 5000:5000 \
-p 5001:5001 \
--read-only \
--tmpfs /tmp \
--tmpfs /run \
--tmpfs /var/log \
-it \
--rm \
--name=openagents-grpc \
openagents-grpc 