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
    fi
    eval "$(conda shell.bash hook)"
    conda init bash
    conda activate ./tmp/docsenv
else
    if [ "$NO_CONDA" != "1" ];
    then
        echo "Please install conda to generaste documentation"
        exit 0
    else
        python3 -m venv ./tmp/docsenv2
        . ./tmp/docsenv2/bin/activate   
    fi
fi


pip install sabledocs protobuf
cp sabledocs.toml build/docs
cd build/docs
sabledocs 
