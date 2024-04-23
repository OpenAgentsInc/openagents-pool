import { Event, nip04, getPublicKey } from "nostr-tools";
import { uuid as uuidv4 } from "uuidv4";
import crypto from "crypto";
import { hexToBytes, bytesToHex } from "@noble/hashes/utils";

export default class Utils {
    static newUUID() {
        return uuidv4();
    }

    static async busyWaitForSomething(cb: ()=>any,onTimeoutResultGenerator: ()=>any,maxMs: number=10000, sleep: number=21): Promise<any> {
        const start = Date.now();
        return new Promise((resolve, reject) => {
            const loop =async () => {
                try {
                    const v=await cb();
                    if (v!==undefined) {
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
    static satoshiTimestamp(){
        // time in milliseconds since 3 january 2009
        const jan32009=new Date("2009-01-03").getTime();
        const now=new Date().getTime();
        return now-jan32009;
    }

    static async encryptNostr(
        text: string,
        ourPrivateKey: string | Uint8Array,
        theirPublicKey: string
    ): Promise<string> {
        return await nip04.encrypt(ourPrivateKey, theirPublicKey, text);
    }

    static async decryptNostr(text: string, ourPrivateKey: string, theirPublicKey: string): Promise<string> {
        return await nip04.decrypt(ourPrivateKey, theirPublicKey, text);
    }

    static async getHyperdriveDiscoveryKey(secret:string|Uint8Array):Promise<string> {
        if (typeof secret == "string") {
            if (secret.startsWith("hyperdrive+bundle://")) {
                secret= secret.replace("hyperdrive+bundle://", "");
            }
            secret = hexToBytes(secret);
        }
        return getPublicKey(secret);
    }
    static clamp(value, min, max) {
        return Math.min(Math.max(value, min), max);
    }

    static async encryptHyperdrive(url: string, secretKey: string | Uint8Array):Promise<{
        bundleUrl: string,
        discoveryHash: string,
        encryptedUrl: string,
    }> {
        if (!url.startsWith("hyperdrive://")) {
            throw new Error("Invalid hyperdrive url");
        }
        if (typeof secretKey == "string") {
            if (secretKey.startsWith("hyperdrive+bundle://")) {
                secretKey= secretKey.replace("hyperdrive+bundle://", "");
            }
            if(secretKey.includes("?")){
                secretKey = secretKey.split("?")[0];
            }
            if(secretKey.includes("#")){
                secretKey = secretKey.split("#")[0];
            }
            secretKey = hexToBytes(secretKey);
        }
        const publicKey = getPublicKey(secretKey);
        const encryptedUrl = await nip04.encrypt(secretKey, publicKey, url);
        const discoveryHash = publicKey;
        const bundleUrl = "hyperdrive+bundle://" + bytesToHex(secretKey);

        return {
            bundleUrl : bundleUrl,
            discoveryHash: discoveryHash,
            encryptedUrl: encryptedUrl,
        };
    }

    static async decryptHyperdrive(bundleUrl: string, encryptedUrl: string): Promise<string> {
        if (!bundleUrl.startsWith("hyperdrive+bundle://")) {
            throw new Error("Invalid hyperdrive bundle url");
        }
        bundleUrl=bundleUrl.replace("hyperdrive+bundle://", "");
        if(bundleUrl.includes("?")){
            bundleUrl = bundleUrl.split("?")[0];
        }
        if(bundleUrl.includes("#")){
            bundleUrl = bundleUrl.split("#")[0];
        }
        const secretKey = hexToBytes(bundleUrl);
        const publicKey = getPublicKey(secretKey);
        return await nip04.decrypt(secretKey, publicKey, encryptedUrl);
    }

    static encrypt(v: string, secret: string): string {
        const key = crypto.createHash("sha256").update(String(secret)).digest();
        const cipher = crypto.createCipheriv("aes-256-ecb", key, null);
        return cipher.update(v, "utf8", "hex") + cipher.final("hex");
    }
    static decrypt(v: string, secret: string): string {
        const key = crypto.createHash("sha256").update(String(secret)).digest();
        const decipher = crypto.createDecipheriv("aes-256-ecb", key, null);
        let decrypted = decipher.update(v, "hex", "utf8");
        decrypted += decipher.final("utf8");
        return decrypted;
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

    static getTagVars(event: Event, tagName: Array<string> | string): Array<Array<string>> {
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
