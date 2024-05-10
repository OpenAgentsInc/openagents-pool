import Auth from "../Auth";
import { Event } from "nostr-tools";
import Logger from "../Logger";

export default class NoAuth extends Auth {
    logger = Logger.get(this.constructor.name);

    constructor() {
        super();
    }

  
    async isEventAuthorized(event: Event): Promise<boolean> {
       return true;
    }

    async isNodeAuthorized(methodName: string, nodeId: string): Promise<boolean> {
       
        return true;
    }
}
