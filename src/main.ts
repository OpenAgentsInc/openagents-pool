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
import Logger from "./Logger";
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

    const GRPC_BINDING_ADDRESS = process.env.GRPC_BINDING_ADDRESS || "0.0.0.0";
    const GRPC_BINDING_PORT = Number(process.env.GRPC_BINDING_PORT || 5000);
    const GRPC_PROTO_DESCRIPTOR_PATH = process.env.GRPC_PROTO_DESCRIPTOR_PATH || "./docs/descriptor.pb";

    const GRPC_CA_CRT: string = process.env.GRPC_CA_CRT || "";
    const GRPC_SERVER_CRT: string = process.env.GRPC_SERVER_CRT || "";
    const GRPC_SERVER_KEY: string = process.env.GRPC_SERVER_KEY || "";

    const NOSTR_SECRET_KEY = process.env.NOSTR_SECRET_KEY || bytesToHex(generateSecretKey());
    const NOSTR_RELAYS = (process.env.NOSTR_RELAYS || "wss://nostr.rblb.it:7777").split(",");

    const EVENTS_WEBHOOK_ENDPOINTS = (process.env.EVENTS_WEBHOOK_ENDPOINTS || "").split(",");

    //////
    const NOSTR_PUBLIC_KEY = getPublicKey(hexToBytes(NOSTR_SECRET_KEY));
    const CA_CRT_DATA: Buffer | undefined = GRPC_CA_CRT ? Fs.readFileSync(GRPC_CA_CRT) : undefined;
    const SERVER_CRT_DATA: Buffer | undefined = GRPC_SERVER_CRT
        ? Fs.readFileSync(GRPC_SERVER_CRT)
        : undefined;
    const SERVER_KEY_DATA: Buffer | undefined = GRPC_SERVER_KEY
        ? Fs.readFileSync(GRPC_SERVER_KEY)
        : undefined;
    ////


    const BLOB_STORAGE_PATH = Path.join(
        process.env.BLOB_STORAGE_PATH || "./data/hyperpool",
        NOSTR_PUBLIC_KEY
    );

    const CACHE_STORAGE_PATH = Path.join(
        process.env.CACHE_PATH || "./data/cache",
        NOSTR_PUBLIC_KEY
    );

    const POOL_AUTH_SERVICE =
        process.env.POOL_AUTH_SERVICE ||
        "json:https://gist.githubusercontent.com/riccardobl/6b05b2a6f5836b5e7954d9623c00c397/raw/oa-auth-test.json";

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
    await Logger.init(
        POOL_NAME,
        POOL_VERSION,
        LOG_LEVEL,
        OPENOBSERVE_ENDPOINT,
        OPENOBSERVE_ORG,
        OPENOBSERVE_STREAM,
        OPENOBSERVE_BASICAUTH || {
            username: OPENOBSERVE_USERNAME,
            password: OPENOBSERVE_PASSWORD,
        },
        OPENOBSERVE_BATCHSIZE,
        OPENOBSERVE_FLUSH_INTERVAL,
        OPENOBSERVE_LOG_LEVEL
    );
    Logger.get().info("Starting pool...");

 
    let auth = undefined;
    if (POOL_AUTH_SERVICE.startsWith("json:")) {
        const baseUrl = POOL_AUTH_SERVICE.substring(5);
        auth = new JsonAuth(baseUrl);
    }

    const webhooks = new WebHooks(EVENTS_WEBHOOK_ENDPOINTS);
    const nostr = new NostrConnector(NOSTR_SECRET_KEY, NOSTR_RELAYS, auth);
    nostr.setWebHooks(webhooks);
    const hyp = new HyperdrivePool(BLOB_STORAGE_PATH, nostr);
    const cache = new Cache(BLOB_STORAGE_PATH, hyp, NOSTR_PUBLIC_KEY);
    const server = new RPCServer(
        NOSTR_SECRET_KEY,
        GRPC_BINDING_ADDRESS,
        GRPC_BINDING_PORT,
        GRPC_PROTO_DESCRIPTOR_PATH,
        nostr,
        hyp,
        auth,
        cache,
        CA_CRT_DATA,
        SERVER_CRT_DATA,
        SERVER_KEY_DATA
    );
    await server.start();
    Logger.get().info("Provider pubkey", NOSTR_PUBLIC_KEY);
}

main();