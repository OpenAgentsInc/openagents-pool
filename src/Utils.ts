import { Event, nip04 } from "nostr-tools";
import { uuid as uuidv4 } from "uuidv4";
import crypto from "crypto";

export default class Utils {
    static newUUID() {
        return uuidv4();
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
