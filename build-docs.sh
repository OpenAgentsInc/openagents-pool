#!/bin/bash
mkdir -p build/docs
mkdir -p tmp

npx protoc --proto_path proto proto/*.proto \
--experimental_allow_proto3_optional \
-o build/docs/descriptor.pb --include_source_info


if [ "`which conda`" != "" ]; then
    if [ ! -d  ./tmp/docsenv ];
    then
        conda create -y --prefix ./tmp/docsenv python=3.12
        eval "$(conda shell.bash hook)"
        conda init bash
        conda activate ./tmp/docsenv
        pip install sabledocs protobuf
    fi
    eval "$(conda shell.bash hook)"
    conda init bash
    conda activate ./tmp/docsenv
    cp sabledocs.toml build/docs
    cd build/docs
    sabledocs 
else
    echo "Please install conda to generaste documentation"
fi

