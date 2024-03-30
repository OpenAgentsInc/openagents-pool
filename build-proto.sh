#!/bin/bash
npm install @protobuf-ts/plugin
npx protoc --ts_out src/proto \
--experimental_allow_proto3_optional \
--ts_opt long_type_number,server_generic \
 --proto_path proto proto/*.proto

