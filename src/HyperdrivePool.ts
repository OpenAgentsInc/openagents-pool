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


export type DriverOut = {
    flushAndWait:()=>Promise<void>
    write:(data:Buffer|string|Uint8Array)=>void
};
export type ReadableGreedy = Readable & {readAll:()=>Promise<Buffer>};
export class SharedDrive {
    drives: Hyperdrive[] = [];
    groupDiscoveryKey: string;
    lastAccess: number;
    isClosed: boolean = false;
    constructor(groupDiscoveryKey: string) {
        this.groupDiscoveryKey = groupDiscoveryKey;
        this.lastAccess = Date.now();
    }

    addDrive(drive: Hyperdrive, owner: string) {
        drive._instanceOwner = owner;
        this.lastAccess = Date.now();
        this.drives.push(drive);
    }

    hasDrive(key: string): boolean {
        return this.drives.some((drive) => drive.key.toString("hex") === key);
    }


    async put(path: string, data: string|Uint8Array) {
        for (const drive of this.drives) {
            if (drive.writable) {
                await drive.put(path, data);
            }
        }
    }

    async get(path: string) : Promise<Buffer> {
        // TODO: Pick newer
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
        for (const drive of this.drives) {
            if (await drive.exists(path)) {
                return true;
            }
        }
        this.lastAccess = Date.now();
        return false;
    }

    async list(path: string) {
        const files = [];
        for (const drive of this.drives) {
            for await (const entry of drive.list(path)) {
                const path = entry.key;
                if (!files.includes(path)) files.push(path);
            }
        }
        this.lastAccess = Date.now();
        return files;
    }

    async inputStream(path: string): Promise<ReadableGreedy> {
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
        this.lastAccess = Date.now();
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
        for (const drive of this.drives) {
            if (drive.writable) {
                await drive.del(key);
            }
        }
        this.lastAccess = Date.now();
    }

    async close() {
        for (const drive of this.drives) {
            await drive.close();
        }
        this.isClosed = true;
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
    constructor(storagePath: string, conn: NostrConnector, topic: string= "OpenAgentsBlobStore") {
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
            if(this.isClosed) return;
            this.swarm.destroy()
        });

        this.conn = conn;

        let topic32bytes = Buffer.alloc(32);
        topic32bytes.write(topic);
        this.discovery = this.swarm.join(topic32bytes, {
            server: true,
            client: true
        });

        this._cleanup();
    }

 

    _cleanup(){
        if(this.isClosed) return;
        const now = Date.now();
        for (const key in this.drives) {
            const sharedDrive = this.drives[key];
            if (sharedDrive.isClosed || now-sharedDrive.lastAccess>this.driverTimeout) {
                sharedDrive.close();
                delete this.drives[key];
            }
        }
        setTimeout(()=>this._cleanup(),1000*60*5);        
    }

    createHyperUrl(diskName: string, diskKey: string, encryptionKey?: string) {
        diskName = diskName.replace(/[^a-zA-Z0-9]/g, "_");
        diskKey = diskKey.replace(/[^a-zA-Z0-9]/g, "_");
        encryptionKey = encryptionKey?encodeURIComponent(encryptionKey):undefined;
        return `hyperblob://${diskName}@${diskKey}` + (encryptionKey ? `?encryptionKey=${encryptionKey}` : "");
    }

    parseHyperUrl(url: string, encryptionKey?: string) {
        if (url.startsWith("hyperblob://")) url = url.slice("hyperblob://".length);
        const out = {
            name: url,
            key: url,
            encryptionKey: encryptionKey,
        };
        const urlAndParams = url.split("?");
        
            const urlParts = urlAndParams[0].split("@");
            out.name = urlParts[0];
            out.key = urlParts[1];
        
        if (urlAndParams.length > 1) {
            const params = urlAndParams[1].split("&");
            for (const param of params) {
                const [key, value] = param.split("=");
                if (key === "encryptionKey") {
                    out.encryptionKey = decodeURIComponent(value);
                }
            }
        }
        out.name = out.name.replace(/[^a-zA-Z0-9]/g, "_");
        out.key = out.key.replace(/[^a-zA-Z0-9]/g, "_");
        return out;
    }

    async create(
        owner: string,
        encryptionKey?: string,
        includeEncryptionKeyInUrl: boolean = false,
        diskName?: string
    ) {
        await this.discovery.flushed();
        const name = diskName || (Utils.secureUuidFrom(Date.now() + "_" + Crypto.randomBytes(32).toString("hex")));

        const corestore = this.store.namespace(name);

        const drive = new Hyperdrive(corestore, {
            encryptionKey: encryptionKey ? b4a.from(encryptionKey, "hex") : undefined,
        });
        await drive.ready();

        const diskUrl = this.createHyperUrl(name, drive.key.toString("hex"));
        const metaDiscoveryKey = Crypto.randomBytes(32).toString("hex");
        await this.conn.announceHyperdrive(owner, metaDiscoveryKey, diskUrl);
        console.log("Announce driver",  diskUrl);

        const metaDiscoveryUrl = this.createHyperUrl(
            name,
            metaDiscoveryKey,
            includeEncryptionKeyInUrl ? encryptionKey : undefined
        );
        
        this.drives[name] = new SharedDrive(metaDiscoveryKey);
        this.drives[name].addDrive(drive, owner);



        return metaDiscoveryUrl;
    }

    async get(diskId:string): Promise<SharedDrive>{
        const sharedDriver =  this.drives[diskId];
        if(!sharedDriver) throw "Driver not open";
        sharedDriver.lastAccess=Date.now();
        return sharedDriver;        
    }

    async close(diskId:string|undefined){
        if(!diskId) {
            for (const key in this.drives) {
                this.drives[key].close();
            }
            this.discovery.destroy();
            this.swarm.destroy();
            this.isClosed=true;
        
        }else{
            const sharedDriver =  this.drives[diskId];
            if(!sharedDriver) throw "Driver not open";
            sharedDriver.close();
            delete this.drives[diskId];
        }
    }
    
    async open(owner: string, metaDiscoveryUrl: string, encryptionKey?: string): Promise<string> {
        await this.discovery.flushed();
        const metaData = this.parseHyperUrl(metaDiscoveryUrl, encryptionKey);

        const corestore = this.store.namespace(metaData.name);
        const name = metaData.name;

        let sharedDrive = this.drives[name];
        if (!sharedDrive) {
            const drive = new Hyperdrive(corestore, {
                encryptionKey: metaData.encryptionKey ? b4a.from(metaData.encryptionKey, "hex") : undefined,
            });
            await drive.ready();
            const diskUrl = this.createHyperUrl(metaData.name, drive.key.toString("hex"));
            await this.conn.announceHyperdrive(owner, metaData.key, diskUrl);
            console.log("Announce local clone", diskUrl);

            sharedDrive = new SharedDrive(metaData.key);
            sharedDrive.addDrive(drive, owner);
            this.drives[name] = sharedDrive;
        }
        let drives;
        while(true){
            drives = await this.conn.findAnnouncedHyperdrives(sharedDrive.groupDiscoveryKey);
            if(drives&&drives.length>0) break;
            await new Promise((resolve) => setTimeout(resolve, 10));
        }
        
        console.log("Found", drives);
        let connectedRemoteDrivers = false;
        for (const drive of drives) {
            const driverData = this.parseHyperUrl(drive.url, metaData.encryptionKey);
            if (!sharedDrive.hasDrive(driverData.key)) {

                const hd = new Hyperdrive(corestore, b4a.from(driverData.key, "hex"), {
                    encryptionKey: driverData.encryptionKey
                        ? b4a.from(driverData.encryptionKey, "hex")
                        : undefined,
                });
                await hd.ready();
                sharedDrive.addDrive(hd, drive.owner);
                connectedRemoteDrivers=true;
                console.log("Connected to remote driver", drive.url);
            }
          
        }
        if (connectedRemoteDrivers) {
            // wait for at least 1 peer to be online
            console.log("Waiting for peers...");
            while(true){
                if (this.nPeers<1){ 
                    await this.discovery.refresh({
                        client:true,
                        server:true
                    });                    
                    await new Promise((resolve) => setTimeout(resolve, 5000));
                }else{
                    console.log("Connected to", this.nPeers, "peers");
                    break;
                }
            }
        }
        sharedDrive.lastAccess=Date.now();
        return name;
    }
}