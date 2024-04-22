import RPCServer from "../RPCServer";
import Fs from "fs";
import NostrConnector from "../NostrConnector";
import { generateSecretKey } from "nostr-tools";
import { bytesToHex } from "@noble/hashes/utils";
import WebHooks from "../WebHooks";
import HyperdrivePool from "../HyperdrivePool";



async function h2(url:string){
 
    const SECRET_KEY = process.env.NOSTR_SECRET_KEY || bytesToHex(generateSecretKey());
    const RELAYS = (process.env.NOSTR_RELAYS || "wss://nostr.rblb.it:7777").split(",");

    const nostr = new NostrConnector(SECRET_KEY, RELAYS, undefined);
    const hyperpool = new HyperdrivePool("./tmp/hyperpool3", nostr);
    const driveCId = (await hyperpool.open("test",url))[0];
    const driveC = await hyperpool.get("test", driveCId);

    console.log("List driver C");
    console.log(await driveC.list("/"));
    console.log("Get from C");
    console.log((await (await driveC.inputStream("/test.txt")).readAll()).toString());
    
}

async function main(){
    const url=Fs.readFileSync("tmp/url.txt").toString();
    console.log("Connect to",url);
    await h2(url);
}

main();
