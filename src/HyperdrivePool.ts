import Hypercore from "hypercore";
import Hyperbee from "hyperbee";
import Corestore from "corestore";
import Hyperdrive from "hyperdrive";
import b4a from 'b4a'
import NostrConnector from "./NostrConnector";
import Hyperswarm from "hyperswarm";
import goodbye from "graceful-goodbye";
import Crypto from "crypto";
import { Writable, Readable, PassThrough } from "stream";
import Utils from "./Utils";
import { generateSecretKey } from "nostr-tools";

import { hexToBytes, bytesToHex } from "@noble/hashes/utils";
export type DriverOut = {
    flushAndWait:()=>Promise<void>
    write:(data:Buffer|string|Uint8Array)=>void
};
export type ReadableGreedy = Readable & {readAll:()=>Promise<Buffer>};
export class SharedDrive {
    drives: Hyperdrive[] = [];
    bundleUrl: string;
    lastAccess: number;
    isClosed: boolean = false;
    conn: NostrConnector;
    constructor(bundleUrl: string, conn: NostrConnector) {
        this.bundleUrl = bundleUrl;
        this.lastAccess = Date.now();
        this.conn = conn;
    }

    addDrive(drive: Hyperdrive, owner: string, local: boolean = false) {
        drive._instanceOwner = owner;
        drive._instanceLocal = local;
        this.lastAccess = Date.now();
        this.drives.push(drive);
    }

    hasDrive(key: string): boolean {
        return this.drives.some((drive) => drive.key.toString("hex") === key);
    }


    async put(path: string, data: string|Uint8Array) {
        this.lastAccess = Date.now();
        for (const drive of this.drives) {
            if (drive.writable) {
                await drive.put(path, data);
            }
        }

    }

    async get(path: string) : Promise<Buffer> {
        // TODO: Pick newer
        this.lastAccess = Date.now();
        for (const drive of this.drives) {
            if (await drive.exists(path)) {
                return drive.get(path);
            }
        }
        throw "File not found";

    }


    async outputStream(path: string): Promise<DriverOut> {
        const streams = [];
        for (const drive of this.drives) {
            if (drive.writable) {
                streams.push(drive.createWriteStream(path));
            }
        }
        this.lastAccess = Date.now();
        // const pt = new PassThrough() as any;
        // pt.on("error", (e) => console.log(`Error in outputStream: ${e}`));

        // let endedStreams = 0;
        // for (const stream of streams) {
        //     pt.pipe(stream);
        //     stream.on("close", () => {
        //         endedStreams++;
        //     });
        // }

        // pt.on("finish", () => {
        //     for (const stream of streams) {
        //         stream.end();
        //     }
        // });

        // pt.flushAndWait = async () => {
        //     for (const stream of streams) {
        //         stream.end();
        //     }
        //     pt.end();
        //     while (endedStreams < streams.length) {
        //         await new Promise((res) => setTimeout(res, 10));
        //     }
        // };
        const pt: DriverOut = {
            flushAndWait: async () => {
                let endedStreams = 0;
                for (const stream of streams) {
                    stream.end();
                    stream.on("close", () => {
                        endedStreams++;
                    });
                }
                while (endedStreams < streams.length) {
                    await new Promise((res) => setTimeout(res, 10));
                }
            },
            write: (data) => {
                for (const stream of streams) {
                    stream.write(data);
                }
            },
        };
        

        return pt;
    }

    async exists(path: string) {
        this.lastAccess = Date.now();
        for (const drive of this.drives) {
            if (await drive.exists(path)) {
                return true;
            }
        }
        return false;
    }

    async list(path: string) {
        this.lastAccess = Date.now();
        const files = [];
        for (const drive of this.drives) {
            for await (const entry of drive.list(path)) {
                const path = entry.key;
                if (!files.includes(path)) files.push(path);
            }
        }
        return files;
    }

    async inputStream(path: string): Promise<ReadableGreedy> {
        this.lastAccess = Date.now();
        let newestEntryInDrive;
        let newestEntryTimestamp = 0;
        for (const drive of this.drives) {
            const timestamp = 0;
            if (!newestEntryInDrive || timestamp > newestEntryTimestamp) {
                if (await drive.exists(path)) {
                    newestEntryInDrive = drive;
                    newestEntryTimestamp = timestamp;
                }
            }
        }
        if (!newestEntryInDrive) throw "File not found";
        const rs = newestEntryInDrive.createReadStream(path);
        rs.readAll = async () => {
            const buffers = [];
            for await (const buffer of rs) {
                buffers.push(buffer);
            }
            return Buffer.concat(buffers);
        };
        return rs;
    }

    async del(key: string) {
        this.lastAccess = Date.now();
        for (const drive of this.drives) {
            if (drive.writable) {
                await drive.del(key);
            }
        }
        this.lastAccess = Date.now();
    }

    async close(){
        await this.conn.unannounceHyperdrive( this.bundleUrl);
        for (const drive of this.drives) {
            await drive.close();
        }
        this.isClosed = true;
    }

    async commit() {
        this.lastAccess = Date.now();
        for(const drive of this.drives) {
            if (!drive._instanceLocal) continue;
            const version = drive.version;
            const diskUrl = "hyperdrive://" + drive.key.toString("hex");
            console.log("Commit local clone", diskUrl);
            await this.conn.announceHyperdrive(drive._instanceOwner, this.bundleUrl, diskUrl, version);
        }
        // for (const drive of this.drives) {
        //     await drive.close();
        // }
        // this.isClosed = true;
    }
}

export default class HyperdrivePool {
    storagePath: string;
    secretKey: string;
    store: Corestore;
    drives: { [key: string]: SharedDrive } = {};
    conn: NostrConnector;
    swarm: Hyperswarm;
    discovery: any;
    nPeers: number = 0;
    driverTimeout: number = 1000 * 60 * 60 * 1; // 1 hour
    isClosed: boolean = false;
    constructor(storagePath: string, conn: NostrConnector, topic: string = "OpenAgentsBlobStore") {
        this.store = new Corestore(storagePath, {
            secretKey: conn.sk,
        });
        const foundPeers = this.store.findingPeers();

        this.swarm = new Hyperswarm();
        this.swarm.on("connection", (conn) => {
            const name = b4a.toString(conn.remotePublicKey, "hex");
            console.log("* got a connection from:", name, "*");
            conn.on("error", (e) => console.log(`Connection error: ${e}`));
            this.store.replicate(conn);
            this.nPeers++;
            conn.once("close", () => {
                console.log("* connection closed from:", name, "*");
                this.nPeers--;
            });
        });

        this.swarm.flush().then(() => foundPeers());

        goodbye(() => {
            if (this.isClosed) return;
            this.swarm.destroy();
        });

        this.conn = conn;

        let topic32bytes = Buffer.alloc(32);
        topic32bytes.write(topic);
        this.discovery = this.swarm.join(topic32bytes, {
            server: true,
            client: true,
        });

        this._cleanup();
    }

    _cleanup() {
        if (this.isClosed) return;
        // const now = Date.now();
        // for (const key in this.drives) {
        //     const sharedDrive = this.drives[key];
        //     if (sharedDrive.isClosed || now-sharedDrive.lastAccess>this.driverTimeout) {
        //         sharedDrive.close();
        //         delete this.drives[key];
        //     }
        // }
        // setTimeout(()=>this._cleanup(),1000*60*5);
    }

    parseHyperUrl(url: string, encryptionKey?: string): { key: string; encryptionKey?: string } {
        const out = {
            key: url,
            encryptionKey: encryptionKey,
        };

        const urlAndParams = url.split("?");
        if (urlAndParams.length > 1) {
            const params = urlAndParams[1].split("&");
            for (const param of params) {
                const [key, value] = param.split("=");
                if (key === "encryptionKey") {
                    out.encryptionKey = decodeURIComponent(value);
                }
            }
        }
        out.key = urlAndParams[0].replace("hyperdrive://", "").replace("hyperdrive+bundle://", "");
        out.key = out.key.replace(/[^a-zA-Z0-9]/g, "_");
        return out;
    }

    async create(
        owner: string,
        encryptionKey?: string,
        includeEncryptionKeyInUrl: boolean = false
    ): Promise<string> {
        await this.discovery.flushed();

        const bundleUrl =
            "hyperdrive+bundle://" +
            bytesToHex(generateSecretKey()) +
            (includeEncryptionKeyInUrl && encryptionKey
                ? `?encryptionKey=${encodeURIComponent(encryptionKey)}`
                : "");

        const corestore = this.store.namespace(bundleUrl.replace(/[^a-zA-Z0-9]/g, "_"));

        const drive = new Hyperdrive(corestore, {
            encryptionKey: encryptionKey ? b4a.from(encryptionKey, "hex") : undefined,
        });
        await drive.ready();



        this.drives[bundleUrl] = new SharedDrive(bundleUrl, this.conn);
        this.drives[bundleUrl].addDrive(drive, owner);

        // const diskUrl = "hyperdrive://" + drive.key.toString("hex");
        // console.log("Announce driver", diskUrl);
        // await this.conn.announceHyperdrive(owner, bundleUrl, diskUrl);

        return bundleUrl;
    }

    async open(owner: string, bundleUrl: string, encryptionKey?: string): Promise<string> {
        await this.discovery.flushed();
        const bundleData = this.parseHyperUrl(bundleUrl, encryptionKey);

        const corestore = this.store.namespace(bundleUrl.replace(/[^a-zA-Z0-9]/g, "_"));
        let sharedDrive = this.drives[bundleUrl];
        if (!sharedDrive) {
            const drive = new Hyperdrive(corestore, {
                encryptionKey: bundleData.encryptionKey
                    ? b4a.from(bundleData.encryptionKey, "hex")
                    : undefined,
            });
            await drive.ready();

            sharedDrive = new SharedDrive(bundleUrl, this.conn);
            sharedDrive.addDrive(drive, owner, true);
            this.drives[bundleUrl] = sharedDrive;
        }

        let drives;
        // while (true) {
            drives = await this.conn.findAnnouncedHyperdrives(bundleUrl);
            // if (drives && drives.length > 0) break;
            // await new Promise((resolve) => setTimeout(resolve, 10));
        // }

        console.log("Found", drives);
        let connectedRemoteDrivers = false;
        for (const drive of drives) {
            const driverData = this.parseHyperUrl(drive.url, bundleData.encryptionKey);
            if (!sharedDrive.hasDrive(driverData.key)) {
                let hd = new Hyperdrive(corestore, b4a.from(driverData.key, "hex"), {
                    encryptionKey: driverData.encryptionKey
                        ? b4a.from(driverData.encryptionKey, "hex")
                        : undefined,
                });
                await hd.ready();
                hd = await hd.checkout(Number(drive.version));
                await hd.ready();
                sharedDrive.addDrive(hd, drive.owner);
                connectedRemoteDrivers = true;
                console.log("Connected to remote driver", drive.url);
            } else {
                console.log("Already connected to remote driver", drive.url);
            }
        }

        if (connectedRemoteDrivers) {
            // wait for at least 1 peer to be online
            console.log("Waiting for peers...");
            while (true) {
                if (this.nPeers < 1) {
                    await this.discovery.refresh({
                        client: true,
                        server: true,
                    });
                    await new Promise((resolve) => setTimeout(resolve, 5000));
                } else {
                    console.log("Connected to", this.nPeers, "peers");
                    break;
                }
            }
        }
        sharedDrive.lastAccess = Date.now();
        return bundleUrl;
    }

    async get(owner: string, bundleUrl: string): Promise<SharedDrive> {
        let sharedDriver = this.drives[bundleUrl];
        if(!sharedDriver) {
            bundleUrl = await this.open(owner, bundleUrl);
            sharedDriver = this.drives[bundleUrl];
        }
        sharedDriver.lastAccess = Date.now();
        return sharedDriver;
    }

    async commit(bundleUrl: string) {
        const sharedDriver = this.drives[bundleUrl];
        if (!sharedDriver) return;
        await sharedDriver.commit();
    }

    // async close(bundleUrl: string | undefined) {
    //     if (!bundleUrl) {
    //         for (const key in this.drives) {
    //             // this.drives[key].close();
    //         }
    //         this.discovery.destroy();
    //         this.swarm.destroy();
    //         this.isClosed = true;
    //     } else {
    //         const sharedDriver = this.drives[bundleUrl];
    //         if (!sharedDriver) throw "Driver not open";
    //         // sharedDriver.close();
    //         delete this.drives[bundleUrl];
    //     }
    // }
}