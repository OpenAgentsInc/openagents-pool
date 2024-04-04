import { Event } from "nostr-tools";
import { uuid as uuidv4 } from "uuidv4";

export default class Utils {
    static newUUID(){
        return uuidv4();
    }
    static getTagVars(
        event: Event,
        tagName: Array<string> | string
    ): Array<Array<string>> {
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
        if(results.length==0){
            results.push([]);
        }
        return results;
    }

}
