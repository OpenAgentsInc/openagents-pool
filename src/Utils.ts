import { Event, nip04, nip47, getPublicKey, generateSecretKey, EventTemplate } from "nostr-tools";
import { uuid as uuidv4 } from "uuidv4";
import crypto from "crypto";
import { hexToBytes, bytesToHex } from "@noble/hashes/utils";
import Logger from "./Logger";
import * as secp256k1 from "@noble/secp256k1";
import Crypto from "crypto";
export default class Utils {

    static parseNWC(nwc:string):{
        pubkey:string,
        relay:string,
        secret:string
    }{
        nwc = nwc.replace("nostr+walletconnect://", "nostr+walletconnect:");
        const nwcData = nip47.parseConnectionString(nwc);
        return {
            pubkey: nwcData.pubkey,
            relay: nwcData.relay,
            secret: nwcData.secret
        };
    }
    
    static generateSecretKey(seed?:string):Uint8Array{
        try{
            if(seed){
                const seedBuffer = Buffer.from(seed, "utf8");
                const hashSeedHex = Crypto.createHash("sha512").update(seedBuffer).digest("hex");
                return secp256k1.etc.hashToPrivateKey(hashSeedHex);
            }else{
                return generateSecretKey();
            }
        }catch(e){
            Logger.get(this.constructor.name).error("Can't generate secret key from seed "+seed,e);
            throw e;
        }
    }

    static getPublicKey(secretKey: string | Uint8Array): string {
        if (typeof secretKey == "string") {
            secretKey = hexToBytes(secretKey);
        }
        return getPublicKey(secretKey);
    }

    static newUUID() {
        return uuidv4();
    }

    static async busyWaitForSomething(
        cb: () => any,
        onTimeoutResultGenerator: () => any,
        maxMs: number = 10000,
        sleep: number = 21
    ): Promise<any> {
        const start = Date.now();
        return new Promise((resolve, reject) => {
            const loop = async () => {
                try {
                    const v = await cb();
                    if (v !== undefined) {
                        resolve(v);
                    } else {
                        const now = Date.now();
                        if (now - start > maxMs) {
                            resolve(await onTimeoutResultGenerator());
                        } else {
                            setTimeout(loop, sleep);
                        }
                    }
                } catch (e) {
                    reject(e);
                }
            };
            loop();
        });
    }
    static satoshiTimestamp() {
        // time in milliseconds since 3 january 2009
        const jan32009 = new Date("2009-01-03").getTime();
        const now = new Date().getTime();
        return now - jan32009;
    }

    static async encrypt(
        text: string,
        ourPrivateKey: string | Uint8Array,
        theirPublicKey: string
    ): Promise<string> {
        return await nip04.encrypt(ourPrivateKey, theirPublicKey, text);
    }

    static async decrypt(text: string, ourPrivateKey: string, theirPublicKey: string): Promise<string> {
        return await nip04.decrypt(ourPrivateKey, theirPublicKey, text);
    }

    static async decryptEvent(event: Event, secret: string | Uint8Array): Promise<Event> {
        try {
            const kind = event.kind;
            if (kind >= 5000 && kind < 6000) {
                // job request
                const encryptedPayload = event.content;
                const decryptedPayload = await nip04.decrypt(secret, event.pubkey, encryptedPayload);
                const decryptedTags = JSON.parse(decryptedPayload);
                event.tags.push(...decryptedTags);
                event.content = "";
            } else if (kind >= 6000 && kind <= 6999) {
                // job response
                const encryptedPayload = event.content;
                const decryptedPayload = await nip04.decrypt(secret, event.pubkey, encryptedPayload);
                event.content = decryptedPayload;
            } else if (kind == 7000) {
                const encryptedPayload = event.content;
                const decryptedPayload = await nip04.decrypt(secret, event.pubkey, encryptedPayload);
                event.content = decryptedPayload;
            }

            // event.tags=event.tags.filter(t=>t[0]!="encrypted");
        } catch (e) {
            Logger.get(this.constructor.name).error(e);
        }
        return event;
    }

    static async encryptEvent(event: Event|EventTemplate, secret: string | Uint8Array): Promise<Event|EventTemplate> {
        const p = Utils.getTagVars(event, ["p"])[0][0];
        if (!p) {
            Logger.get(this.constructor.name).warn("No public key found in event. Can't encrypt");
            return event;
        }

        const encryptedTag = Utils.getTagVars(event, ["encrypted"])[0][0];

        const kind = event.kind;
        if (kind >= 5000 && kind < 6000) {
            // job request
            const tags = event.tags;
            const tagsToEncrypt = [];
            for (let i = 0; i < tags.length; i++) {
                if (tags[i][0] == "i" || tags[i][0] == "param") {
                    tagsToEncrypt.push(tags[i]);
                    tags.splice(i, 1);
                    i--;
                }
            }
            const encryptedTags = await nip04.encrypt(secret, p, JSON.stringify(tagsToEncrypt));
            event.content = encryptedTags;
        } else if (kind >= 6000 && kind <= 6999) {
            // job response
            const encryptedPayload = await nip04.encrypt(secret, p, event.content || "");
            event.content = encryptedPayload;
        } else {
            const encryptedPayload = await nip04.encrypt(secret, p, event.content || "");
            event.content = encryptedPayload;
        }

        if (!encryptedTag) {
            event.tags.push(["encrypted", "true"]);
        }
        return event;
    }

    static async getHyperdriveDiscoveryKey(secret: string | Uint8Array): Promise<string> {
        if (typeof secret == "string") {
            if (secret.startsWith("hyperdrive+bundle://")) {
                secret = secret.replace("hyperdrive+bundle://", "");
            }
            secret = hexToBytes(secret);
        }
        return getPublicKey(secret);
    }
    static clamp(value, min, max) {
        return Math.min(Math.max(value, min), max);
    }

    static async encryptHyperdrive(
        url: string,
        secretKey: string | Uint8Array
    ): Promise<{
        bundleUrl: string;
        discoveryHash: string;
        encryptedUrl: string;
    }> {
        if (!url.startsWith("hyperdrive://")) {
            throw new Error("Invalid hyperdrive url");
        }
        if (typeof secretKey == "string") {
            if (secretKey.startsWith("hyperdrive+bundle://")) {
                secretKey = secretKey.replace("hyperdrive+bundle://", "");
            }
            if (secretKey.includes("?")) {
                secretKey = secretKey.split("?")[0];
            }
            if (secretKey.includes("#")) {
                secretKey = secretKey.split("#")[0];
            }
            secretKey = hexToBytes(secretKey);
        }
        const publicKey = getPublicKey(secretKey);
        const encryptedUrl = await nip04.encrypt(secretKey, publicKey, url);
        const discoveryHash = publicKey;
        const bundleUrl = "hyperdrive+bundle://" + bytesToHex(secretKey);

        return {
            bundleUrl: bundleUrl,
            discoveryHash: discoveryHash,
            encryptedUrl: encryptedUrl,
        };
    }

    static async decryptHyperdrive(bundleUrl: string, encryptedUrl: string): Promise<string> {
        if (!bundleUrl.startsWith("hyperdrive+bundle://")) {
            throw new Error("Invalid hyperdrive bundle url");
        }
        bundleUrl = bundleUrl.replace("hyperdrive+bundle://", "");
        if (bundleUrl.includes("?")) {
            bundleUrl = bundleUrl.split("?")[0];
        }
        if (bundleUrl.includes("#")) {
            bundleUrl = bundleUrl.split("#")[0];
        }
        const secretKey = hexToBytes(bundleUrl);
        const publicKey = getPublicKey(secretKey);
        return await nip04.decrypt(secretKey, publicKey, encryptedUrl);
    }


    static uuidFrom(v: any): string {
        if (typeof v == "string") {
            return crypto
                .createHash("sha256")
                .update(v as string)
                .digest("hex");
        } else {
            v = JSON.stringify(v);
            return Utils.uuidFrom(v);
        }
    }
    static secureUuidFrom(v: any): string {
        if (typeof v == "string") {
            return crypto
                .createHash("sha256")
                .update(v as string)
                .digest("hex");
        } else {
            v = JSON.stringify(v);
            return Utils.secureUuidFrom(v);
        }
    }

    static sha512(v: any): string {
       if (typeof v == "string") {
           return crypto
               .createHash("sha512")
               .update(v as string)
               .digest("hex");
       } else {
           v = JSON.stringify(v);
           return Utils.secureUuidFrom(v);
       }
    }

    static getTagVars(event: Event|EventTemplate, tagName: Array<string> | string): Array<Array<string>> {
        const results = new Array<Array<string>>();
        for (const t of event.tags) {
            let isMatch = true;
            if (Array.isArray(tagName)) {
                for (let i = 0; i < tagName.length; i++) {
                    if (t[i] !== tagName[i]) {
                        isMatch = false;
                        break;
                    }
                }
            } else {
                isMatch = t[0] === tagName;
            }
            if (!isMatch) continue;
            const values: Array<string> = t.slice(Array.isArray(tagName) ? tagName.length : 1);
            results.push(values);
        }
        if (results.length == 0) {
            results.push([]);
        }
        return results;
    }

    static fixParameterizedJSON(json: string): string {
        json = json.replace(/(")(%.+_NUMBER%)(")/gim, "$2");
        return json;
    }
}
