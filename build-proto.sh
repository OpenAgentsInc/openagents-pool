#!/bin/bash

# typescript
npm install @protobuf-ts/plugin
mkdir -p dist/proto/typescript
npx protoc --ts_out dist/proto/typescript \
--experimental_allow_proto3_optional \
--ts_opt long_type_number,server_generic \
 --proto_path proto proto/*.proto
mkdir -p src/proto
cp -Rf dist/proto/typescript/* src/proto/


# python 
python3 -m venv tmp/protobuild-venv
. tmp/protobuild-venv/bin/activate
pip install grpcio-tools
mkdir -p dist/proto/python
python -m grpc_tools.protoc -Iproto --python_out=dist/proto/python --pyi_out=dist/proto/python --grpc_python_out=dist/proto/python proto/*.proto
