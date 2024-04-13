import { Event } from "nostr-tools";
import { uuid as uuidv4 } from "uuidv4";
import Crypto from "crypto";

export default class Utils {
    static newUUID() {
        return uuidv4();
    }
    static uuidFrom(v:any):string{
        if(typeof v=="string"){
            return Crypto.createHash("sha256").update(v as string).digest("hex");
        }else{
            v=JSON.stringify(v);
            return Utils.uuidFrom(v);
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
        json=json.replace(/(")(%.+_NUMBER%)(")/gim, "$2");
        return json;     
    }
}
