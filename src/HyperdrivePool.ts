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
import Fs from "fs";
import Path from "path";
import { EventEmitter } from "events";
import Logger from "./Logger";
import { hexToBytes, bytesToHex } from "@noble/hashes/utils";
import * as secp256k1 from "@noble/secp256k1";

export type DriverOut = {
    flushAndWait:()=>Promise<void>
    write:(data:Buffer|string|Uint8Array)=>void
};
export type ReadableGreedy = Readable & {readAll:()=>Promise<Buffer>};
export class SharedDrive extends EventEmitter {
    logger = Logger.get(this.constructor.name);
    drives: Hyperdrive[] = [];
    bundleUrl: string;
    lastAccess: number;
    isClosed: boolean = false;
    conn: NostrConnector;
    constructor(bundleUrl: string, conn: NostrConnector) {
        super();
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

    getVersion(): number {
        let version = 0;
        for (const drive of this.drives) {
            if (drive.version > version) {
                version = drive.version;
            }
        }
        return version;
    }

    async put(path: string, data: string | Uint8Array) {
        if (!path.startsWith("/")) {
            path = "/" + path;
        }
        this.lastAccess = Date.now();
        let atLeastOneDrive = false;
        for (const drive of this.drives) {
            if (drive.writable) {
                await drive.put(path, data);
                atLeastOneDrive = true;
            }
        }
        if (!atLeastOneDrive) throw "No writable drives";
    }

    async get(path: string): Promise<Buffer> {
        if (!path.startsWith("/")) path = "/" + path;
        // TODO: Pick newer
        this.lastAccess = Date.now();
        let data = undefined;
        for (const drive of this.drives) {
            if (await drive.exists(path)) {
                this.logger.log("Found file ",path," in drive", drive.key.toString("hex"));
                data = drive.get(path);
            }
        }
        if (data) return data;

        throw "File not found";
    }

    async outputStream(path: string): Promise<DriverOut> {
        const streams = [];
        let atLeastOneDrive = false;
        for (const drive of this.drives) {
            if (drive.writable) {
                streams.push(drive.createWriteStream(path));
                atLeastOneDrive = true;
            }
        }
        if (!atLeastOneDrive) throw "No writable drives";
        this.lastAccess = Date.now();
    
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
        if (!path.startsWith("/")) path = "/" + path;
        this.lastAccess = Date.now();
        // let f=await this.list(path);
        // return f.length>0;
        for (const drive of this.drives) {
            if (await drive.exists(path)) return true;
        }
        // console.log("File not found", path);
        return false;
    }

    async list(path: string = "/") {
        if (!path.startsWith("/")) path = "/" + path;
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

    async close() {
        this.emit("close");
        try {
            await this.conn.unannounceHyperdrive(this.bundleUrl);
        } catch (e) {
            this.logger.log("Error unannouncing", e);
        }
        for (const drive of this.drives) {
            await drive.close();
        }
        this.isClosed = true;
    }

    async commit() {
        this.lastAccess = Date.now();
        for (const drive of this.drives) {
            if (!drive._instanceLocal) {
                this.logger.log("Skip commit of remote drive", drive.key.toString("hex"));
                continue;
            }
            const version = drive.version;
            const diskUrl = "hyperdrive://" + drive.key.toString("hex");
            this.logger.log("Commit local clone", diskUrl);
            await this.conn.announceHyperdrive(drive._instanceOwner, this.bundleUrl, diskUrl, version);
        }
        // for (const drive of this.drives) {
        //     await drive.close();
        // }
        // this.isClosed = true;
    }
}

export default class HyperdrivePool {
    logger = Logger.get(this.constructor.name);

    storagePath: string;
    secretKey: string;
    store: Corestore;
    drives: { [key: string]: SharedDrive } = {};
    conn: NostrConnector;
    swarm: Hyperswarm;
    discovery: any;
    nPeers: number = 0;
    isClosed: boolean = false;
    constructor(storagePath: string, conn: NostrConnector, topic: string = "OpenAgentsBlobStore") {
        this.store = new Corestore(storagePath, {
            secretKey: conn.sk,
        });
        const foundPeers = this.store.findingPeers();

        this.swarm = new Hyperswarm();
        this.swarm.on("connection", (conn) => {
            const name = b4a.toString(conn.remotePublicKey, "hex");
            this.logger.finer("* got a connection from:", name, "*");
            conn.on("error", (e) => this.logger.log(`Connection error: ${e}`));
            this.store.replicate(conn);
            this.nPeers++;
            conn.once("close", () => {
                this.logger.log("* connection closed from:", name, "*");
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
        includeEncryptionKeyInUrl: boolean = false,
        secret: string | undefined = undefined
    ): Promise<string> {
        try{
            // await this.discovery.flushed();
            const secretKey = !secret ? generateSecretKey() : secp256k1.etc.hashToPrivateKey(secret);

            const bundleUrl =
                "hyperdrive+bundle://" +
                bytesToHex(secretKey) +
                (includeEncryptionKeyInUrl && encryptionKey
                    ? `?encryptionKey=${encodeURIComponent(encryptionKey)}`
                    : "");

            const bundleNamespace = bundleUrl.replace(/[^a-zA-Z0-9]/g, "_");
            const corestore = this.store.namespace(bundleNamespace);

            const drive = new Hyperdrive(corestore, {
                encryptionKey: encryptionKey ? b4a.from(encryptionKey, "hex") : undefined,
            });
            await drive.ready();

            this.drives[bundleUrl] = new SharedDrive(bundleUrl, this.conn);
            this.drives[bundleUrl].addDrive(drive, owner, true);

            // const diskUrl = "hyperdrive://" + drive.key.toString("hex");
            // console.log("Announce driver", diskUrl);
            // await this.conn.announceHyperdrive(owner, bundleUrl, diskUrl);
            // await Fs.promises.writeFile(Path.join(this.storagePath, bundleNamespace + ".lstatep"), "true");
            return bundleUrl;
        }catch(e){
            this.logger.error("Error creating hyperdrive",e);
            throw e;
        }
    }

    async open(owner: string, bundleUrl: string, encryptionKey?: string): Promise<[string, number]> {
        if (!bundleUrl.startsWith("hyperdrive+bundle://")) {
            bundleUrl = "hyperdrive+bundle://" + bundleUrl;
        }

        // await this.discovery.flushed();
        const bundleData = this.parseHyperUrl(bundleUrl, encryptionKey);

        const corestore = this.store.namespace(bundleUrl.replace(/[^a-zA-Z0-9]/g, "_"));
        let sharedDrive = this.drives[bundleUrl];
        if (!sharedDrive) {
            this.logger.log("Create local disk", bundleUrl);
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

        drives = await this.conn.findAnnouncedHyperdrives(bundleUrl);
        this.logger.log("Found", drives, "remote disks");

        let connectedRemoteDrivers = false;
        const waitList = [];
        for (const drive of drives) {
            const driverData = this.parseHyperUrl(drive.url, bundleData.encryptionKey);
            if (!sharedDrive.hasDrive(driverData.key)) {
                let hd = new Hyperdrive(corestore, b4a.from(driverData.key, "hex"), {
                    encryptionKey: driverData.encryptionKey
                        ? b4a.from(driverData.encryptionKey, "hex")
                        : undefined,
                });
                waitList.push(
                    (async () => {
                        await hd.ready();
                        hd = await hd.checkout(Number(drive.version));
                        await hd.ready();
                        sharedDrive.addDrive(hd, drive.owner);
                    })()
                );
                connectedRemoteDrivers = true;
                this.logger.log("Connected to remote disk", drive.url);
            } else {
                this.logger.log("Already connected to remote disk", drive.url);
            }
        }
        if (waitList.length > 0) await Promise.all(waitList);

        if (connectedRemoteDrivers) {
            // wait for at least 1 peer to be online
            this.logger.log("Waiting for peers...");
            while (true) {
                if (this.nPeers < 1) {
                    await this.discovery.refresh({
                        client: true,
                        server: true,
                    });
                    await new Promise((resolve) => setTimeout(resolve, 100));
                } else {
                    this.logger.log("Connected to", this.nPeers, "peers");
                    break;
                }
            }
        }
        sharedDrive.lastAccess = Date.now();
        return [bundleUrl, await sharedDrive.getVersion()];
    }

    async get(owner: string, bundleUrl: string): Promise<SharedDrive> {
        let sharedDriver = this.drives[bundleUrl];
        if (!sharedDriver) {
            bundleUrl = (await this.open(owner, bundleUrl))[0];
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
}