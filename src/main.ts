import RPCServer from "./RPCServer";
import Fs from "fs";
import Path from "path";
import Express from "express";
import NostrConnector from "./NostrConnector";
import { generateSecretKey } from "nostr-tools";
import {  bytesToHex } from '@noble/hashes/utils' 

async function main(){
    const IP = process.env.NOSTR_CONNECT_GRPC_BINDING_ADDRESS || "0.0.0.0";
    const PORT = Number(process.env.NOSTR_CONNECT_GRPC_BINDING_PORT || 5000);
    const DESCRIPTOR_PATH= process.env.NOSTR_CONNECT_GRPC_DESCRIPTOR_PATH || "./docs/descriptor.pb";
    const SECRET_KEY = process.env.NOSTR_CONNECT_SECRET_KEY || bytesToHex(generateSecretKey());

    const nostr = new NostrConnector(SECRET_KEY,["wss://nostr.rblb.it:7777"],undefined);


    const server = new RPCServer(IP, PORT, DESCRIPTOR_PATH, nostr);
    await server.start();

    const docsPath = process.env.NOSTR_CONNECT_DOCS_PATH||"./docs";
    if(Fs.existsSync(docsPath)){
        const DOCS_PORT = Number(process.env.NOSTR_CONNECT_DOCS_PORT || PORT+1);
        console.info(`Loading docs: ${docsPath}`);
        const app = Express();
        app.use(Express.static(docsPath));
        app.listen(DOCS_PORT, () => {
            console.info(`Docs server started on port ${DOCS_PORT}`);
        });
    }
}

main();