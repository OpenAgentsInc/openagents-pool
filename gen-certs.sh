#!/bin/bash
set -e
mkdir -p certs
cd certs

function newca {
    openssl genrsa  -out ca.key 4096
    openssl req -new -x509 -days 365 -key ca.key -out ca.crt -subj  "/C=CL/ST=RM/L=Santiago/O=Test/OU=Test/CN=ca"
}

function  newcert {
    name=$1
    openssl genrsa  -out $name.key 4096
    openssl req  -new -key $name.key -out $name.csr -subj  "/C=CL/ST=RM/L=Santiago/O=Test/OU=$name/CN=localhost"
    openssl x509 -req -days 999 -in $name.csr -CA ca.crt -CAkey ca.key  -out $name.crt
    openssl rsa -in $name.key -out $name.key
}

$@