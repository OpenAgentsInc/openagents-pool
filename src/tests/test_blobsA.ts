import RPCServer from "../RPCServer";
import Fs from "fs";
import NostrConnector from "../NostrConnector";
import { generateSecretKey } from "nostr-tools";
import { bytesToHex } from "@noble/hashes/utils";
import WebHooks from "../WebHooks";
import HyperdrivePool from "../HyperdrivePool";
async function h1() {
   
    const SECRET_KEY = process.env.NOSTR_SECRET_KEY || bytesToHex(generateSecretKey());
    const RELAYS = (process.env.NOSTR_RELAYS || "wss://nostr.rblb.it:7777").split(",");


    const nostr = new NostrConnector(SECRET_KEY, RELAYS, undefined);
    const hyperpool = new HyperdrivePool("./tmp/hyperpool4", nostr);

    console.log("Create driver");
    const url = await hyperpool.create("test");
    
    console.log("Open driver in A");
    const driveAId = (await hyperpool.open("test",url))[0];

    console.log("Open driver in B");
    const driveBId = (await hyperpool.open("test2",url))[0];

    console.log("Get drivers");
    const driveA = await hyperpool.get("test",driveAId);
    const driveB = await hyperpool.get("test", driveBId);

    // await driveA.put("/test2.txt","Hello World");
    
    console.log("Write to A");
    const out = await driveA.outputStream("/test.txt");
    out.write("Hello World");   
    await out.flushAndWait();
    console.log("List driver A")
    console.log(await driveA.list("/"));
    console.log("List driver B")
    console.log(await driveB.list("/"));

    console.log("Get from A");
    console.log((await (await driveB.inputStream("/test.txt")).readAll()).toString());
    
    console.log("Get from B");
    console.log(
        (await (await driveB.inputStream("/test.txt"))
            .readAll())
            .toString()
    );

    await driveA.commit();
    await driveB.commit();

    return url;

}



async function main(){
    const url=await h1();
    console.log("Connect to",url);
    Fs.writeFileSync("tmp/url.txt",url);
}

main();
