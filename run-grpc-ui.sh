#!/bin/bash

if [ "`which grpcui`" == "" ]; then
    go install github.com/fullstorydev/grpcui/cmd/grpcui@latest
fi

grpcui -plaintext localhost:5000