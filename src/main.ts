import RPCServer from "./RPCServer";
import Fs from "fs";
import NostrConnector from "./NostrConnector";
import { generateSecretKey } from "nostr-tools";
import {  bytesToHex } from '@noble/hashes/utils' 
import WebHooks from "./WebHooks";
import HyperdrivePool from "./HyperdrivePool";
async function main(){
    process.on("uncaughtException", (err) => {
        console.error("There was an uncaught error", err);
    });
    process.on("unhandledRejection", (reason, promise) => {
        console.error("Unhandled Rejection at:", promise, "reason:", reason);
    });
    const IP = process.env.GRPC_BINDING_ADDRESS || "0.0.0.0";
    const PORT = Number(process.env.GRPC_BINDING_PORT || 5000);
    const DESCRIPTOR_PATH= process.env.GRPC_PROTO_DESCRIPTOR_PATH || "./docs/descriptor.pb";
    const SECRET_KEY = process.env.NOSTR_SECRET_KEY || bytesToHex(generateSecretKey());
    const RELAYS = (process.env.NOSTR_RELAYS || "wss://nostr.rblb.it:7777").split(",");
    const WEBHOOKS = (process.env.WEBHOOKS || "").split(",");

    const CA_CRT_PATH: string = process.env.GRPC_CA_CRT || "";
    const SERVER_CRT_PATH: string = process.env.GRPC_SERVER_CRT || "";
    const SERVER_KEY_PATH: string = process.env.GRPC_SERVER_KEY || "";

    const CA_CRT: Buffer | undefined =
        CA_CRT_PATH && Fs.existsSync(CA_CRT_PATH) ? Fs.readFileSync(CA_CRT_PATH) : undefined;
    const SERVER_CRT: Buffer | undefined =
        SERVER_CRT_PATH && Fs.existsSync(SERVER_CRT_PATH) ? Fs.readFileSync(SERVER_CRT_PATH) : undefined;
    const SERVER_KEY: Buffer | undefined =
        SERVER_KEY_PATH && Fs.existsSync(SERVER_KEY_PATH) ? Fs.readFileSync(SERVER_KEY_PATH) : undefined;
    

    const BLOB_STORAGE_PATH = process.env.BLOB_STORAGE_PATH || "./data/hyperpool";

    const webhooks = new WebHooks(WEBHOOKS);
    const nostr = new NostrConnector(SECRET_KEY, RELAYS, undefined);
    nostr.setWebHooks(webhooks);
    const hyp = new HyperdrivePool(BLOB_STORAGE_PATH, nostr);
    const server = new RPCServer(
        SECRET_KEY, 
        IP,
        PORT,
        DESCRIPTOR_PATH,
        nostr,
        hyp,
        CA_CRT,
        SERVER_CRT,
        SERVER_KEY
    );
    await server.start();

}

main();