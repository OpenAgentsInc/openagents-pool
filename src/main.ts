import RPCServer from "./RPCServer";
import Fs from "fs";
import NostrConnector from "./NostrConnector";
import { generateSecretKey, getPublicKey } from "nostr-tools";
import {  bytesToHex, hexToBytes } from '@noble/hashes/utils' 
import WebHooks from "./WebHooks";
import HyperdrivePool from "./HyperdrivePool";
import Cache from "./Cache";
import Path from "path";
import JsonAuth from "./auth/JsonAuth";
import NoAuth from "./auth/NoAuth";
import Logger from "./Logger";
import Auth from "./Auth";
import NWCAdapter from "./NWCAdapter";
async function main(){
    process.on("uncaughtException", (err) => {
        Logger.get().error("There was an uncaught error", err);
    });
    process.on("unhandledRejection", (reason, promise) => {
        let r = reason;
        let m = reason;
        if (reason instanceof Error) {
            r = reason.stack;
            m = reason.message;
        }
        Logger.get().error("Unhandled Rejection at:", promise, "reason:", r, m);
    });

    const POOL_DISPLAY_NAME = process.env.POOL_DISPLAY_NAME || "Self-hosted Pool";
    const POOL_NAME = process.env.POOL_NAME || "newpool";
    const POOL_DESCRIPTION = process.env.POOL_DESCRIPTION || "A self-hosted pool";
    const POOL_PICTURE = process.env.POOL_PICTURE || "";
    const POOL_WEBSITE = process.env.POOL_WEBSITE || "";
    const POOL_VERSION = process.env.POOL_VERSION || "0.1";

    const POOL_GRPC_BINDING_ADDRESS = process.env.POOL_GRPC_BINDING_ADDRESS || "0.0.0.0";
    const POOL_GRPC_BINDING_PORT = Number(process.env.POOL_GRPC_BINDING_PORT || 5021);
    const POOL_GRPC_PROTO_DESCRIPTOR_PATH = process.env.POOL_GRPC_PROTO_DESCRIPTOR_PATH || "./docs/descriptor.pb";

    const POOL_GRPC_CA_CRT: string = process.env.POOL_GRPC_CA_CRT || "";
    const POOL_GRPC_SERVER_CRT: string = process.env.POOL_GRPC_SERVER_CRT || "";
    const POOL_GRPC_SERVER_KEY: string = process.env.POOL_GRPC_SERVER_KEY || "";

    const POOL_NOSTR_SECRET_KEY = process.env.POOL_NOSTR_SECRET_KEY || bytesToHex(generateSecretKey());
    const NOSTR_RELAYS = (process.env.NOSTR_RELAYS || "wss://nostr.openagents.com:7777").split(",");

    const POOL_EVENTS_WEBHOOK_ENDPOINTS = (process.env.POOL_EVENTS_WEBHOOK_ENDPOINTS || "").split(",");

    //////
    const POOL_NOSTR_PUBLIC_KEY = getPublicKey(hexToBytes(POOL_NOSTR_SECRET_KEY));
    const POOL_CA_CRT_DATA: Buffer | undefined = POOL_GRPC_CA_CRT ? Fs.readFileSync(POOL_GRPC_CA_CRT) : undefined;
    const POOL_SERVER_CRT_DATA: Buffer | undefined = POOL_GRPC_SERVER_CRT
        ? Fs.readFileSync(POOL_GRPC_SERVER_CRT)
        : undefined;
    const POOL_SERVER_KEY_DATA: Buffer | undefined = POOL_GRPC_SERVER_KEY
        ? Fs.readFileSync(POOL_GRPC_SERVER_KEY)
        : undefined;
    ////


    const POOL_BLOB_STORAGE_PATH = Path.join(
        process.env.POOL_BLOB_STORAGE_PATH || "./data/hyperpool",
        POOL_NOSTR_PUBLIC_KEY
    );

    const POOL_CACHE_STORAGE_PATH = Path.join(
        process.env.POOL_CACHE_PATH || "./data/cache",
        POOL_NOSTR_PUBLIC_KEY
    );

    const POOL_AUTH_SERVICE =  process.env.POOL_AUTH_SERVICE ||      "";

    const LOG_LEVEL = process.env.LOG_LEVEL || "finest";

    const OPENOBSERVE_ENDPOINT = process.env.OPENOBSERVE_ENDPOINT || undefined;
    const OPENOBSERVE_ORG = process.env.OPENOBSERVE_ORG || undefined;
    const OPENOBSERVE_STREAM = process.env.OPENOBSERVE_STREAM || undefined;
    const OPENOBSERVE_BASICAUTH = process.env.OPENOBSERVE_BASICAUTH || "";
    const OPENOBSERVE_USERNAME = process.env.OPENOBSERVE_USERNAME || "";
    const OPENOBSERVE_PASSWORD = process.env.OPENOBSERVE_PASSWORD || "";
    const OPENOBSERVE_BATCHSIZE = Number(process.env.OPENOBSERVE_BATCHSIZE || "0");
    const OPENOBSERVE_FLUSH_INTERVAL = Number(process.env.OPENOBSERVE_FLUSH_INTERVAL || "0");
    const OPENOBSERVE_LOG_LEVEL = process.env.OPENOBSERVE_LOG_LEVEL || "";

    ///


    // init logger
    Logger.init(
        POOL_NAME,
        POOL_VERSION,
        LOG_LEVEL,
        !!OPENOBSERVE_ENDPOINT        
    );
    Logger.get().info("Starting pool...");

 
    let auth:Auth = new NoAuth();
    if (POOL_AUTH_SERVICE.startsWith("json:")||POOL_AUTH_SERVICE.endsWith(".json")) {
        let baseUrl = POOL_AUTH_SERVICE;
        Logger.get().info("Using JSON Auth service", baseUrl);
        if(baseUrl.startsWith("json:")){
            baseUrl=baseUrl.substring(5);
        }
        auth = new JsonAuth(baseUrl, POOL_NOSTR_PUBLIC_KEY);        
    }else{
        Logger.get().info("Using NoAuth service "+POOL_AUTH_SERVICE);
    }

    const webhooks = new WebHooks(POOL_EVENTS_WEBHOOK_ENDPOINTS);
    const nostr = new NostrConnector(POOL_NOSTR_SECRET_KEY, NOSTR_RELAYS, auth);
    nostr.setWebHooks(webhooks);
    const hyp = new HyperdrivePool(POOL_BLOB_STORAGE_PATH, nostr);
    const cache = new Cache(POOL_BLOB_STORAGE_PATH, hyp, POOL_NOSTR_PUBLIC_KEY);
    const nwcAdapter = new NWCAdapter(nostr);

    const server = new RPCServer(
        POOL_NOSTR_PUBLIC_KEY,
        POOL_NOSTR_SECRET_KEY,
        POOL_GRPC_BINDING_ADDRESS,
        POOL_GRPC_BINDING_PORT,
        POOL_GRPC_PROTO_DESCRIPTOR_PATH,
        nostr,
        hyp,
        auth,
        cache,
        POOL_CA_CRT_DATA,
        POOL_SERVER_CRT_DATA,
        POOL_SERVER_KEY_DATA,
        nwcAdapter
    );
    await server.start();
    Logger.get().info("Provider pubkey", POOL_NOSTR_PUBLIC_KEY);
}

main();