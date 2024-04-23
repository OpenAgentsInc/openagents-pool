import HyperdrivePool, { DriverOut, ReadableGreedy } from "./HyperdrivePool";
import { SharedDrive } from "./HyperdrivePool";
import Path from "path";
import Fs from "fs";
import Utils from "./Utils";
export class CacheDisk {
    drive: SharedDrive;
    version: number;
    constructor(drive: SharedDrive, cacheVersion: number) {
        this.drive = drive;
        this.version = cacheVersion ;

    }

    async getAsStream(path: string, requestedEntryVersion?:number): Promise<ReadableGreedy> {
        if (!(await this.drive.exists(path))) {
            console.log("Cache miss", path);
            return undefined;
        }

        const meta = JSON.parse((await this.drive.get(path + ".meta.json")).toString());
        

        if (meta.cacheVersion != this.version) {
            console.log(
                "Cache version mismatch",
                path,
                "current:",
                this.version,
                "stored:",
                meta.cacheVersion
            );
            return undefined;
        }

        if (requestedEntryVersion && requestedEntryVersion != meta.entryVersion) {
            console.log(
                "Entry version mismatch",
                path,
                "requested:",
                requestedEntryVersion,
                "stored:",
                meta.entryVersion
            );
            return undefined;
        }

        if (meta.expiration && meta.expiration < Date.now()) {
            console.log("Expired cache", path, "expiration:", meta.expiration, "now:", Date.now());
            return undefined;
        }

        return await this.drive.inputStream(path);
    }

    async setAsStream(path: string,  version?: number, expiration?: number): Promise<DriverOut> {
        const meta = {
            cacheVersion: this.version || 0,
            expiration: expiration || 0,
            entryVersion: version    
        };
        await this.drive.put(path + ".meta.json", JSON.stringify(meta));

        return await this.drive.outputStream(path);
    }

    async commit(){
        await this.drive.commit();
    }
}

export default class Cache {
    CACHES: { [key: string]: CacheDisk } = {};
    cacheUrl: string;
    drives: HyperdrivePool;
    poolId: string;
    cacheVersion: number = 0;
    constructor(cacheUrl: string, drives: HyperdrivePool, poolId: string, version?: number) {
        this.cacheUrl = cacheUrl;
        this.drives = drives;
        this.poolId = poolId;
        if(version){
            this.cacheVersion = version;
        }else{

            this.cacheVersion = Math.floor(Utils.satoshiTimestamp()/ 1000);
        }
        this._commit();
    }

    async _commit(){
        for (const cache of Object.values(this.CACHES)){
            await cache.commit();
        }
        setTimeout(()=>this._commit(),10*60000);
    }

    async get(name: string): Promise<CacheDisk> {
        if (this.CACHES[name]) {
            console.log("Cache instance found");
            return this.CACHES[name];
        }

        const bundleUrlPath = Path.join(this.cacheUrl, name + ".bundledcache");
        let bundleUrl = "";
        if (Fs.existsSync(bundleUrlPath)) {
            console.log("Freezed cache instance found. Warming up...");
            bundleUrl = await Fs.promises.readFile(bundleUrlPath, { encoding: "utf-8" });
        } else {
            console.log("Create new cache instance.");
            bundleUrl = await this.drives.create(this.poolId);
            await Fs.promises.writeFile(bundleUrlPath, bundleUrl, { encoding: "utf-8" });
        }

        let version;
        [bundleUrl, version] = await this.drives.open(this.poolId, bundleUrl);
        const drive = await this.drives.get(this.poolId, bundleUrl);
        drive.on("close", () => {
            delete this.CACHES[name];
        });
        const cacheDrive = new CacheDisk(drive, this.cacheVersion);
        this.CACHES[name] = cacheDrive;
        return cacheDrive;
    }
}