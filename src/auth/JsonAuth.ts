import Auth from "../Auth";
import {Event} from "nostr-tools";
import Logger from "../Logger";
type AuthCache = {
    id: string;
    methodName: string;
    authorized: boolean;
    timestamp: number;
}
export default class JsonAuth extends Auth {
    private baseUrl: string;
    private authCache: AuthCache[] = [];
    private poolPublicKey: string;

    constructor(baseUrl: string, poolPublicKey: string) {
        super();
        this.baseUrl = baseUrl;
        this.poolPublicKey = poolPublicKey;
    }

    async _getAuth(methodName: string, nodeId: string): Promise<AuthCache> {
        let auth = undefined;
        for (let i = 0; i < this.authCache.length; i++) {
            const cache = this.authCache[i];
            if (cache.id === nodeId && cache.methodName === methodName) {
                if (Date.now() - cache.timestamp < 1000 * 60 * 15) {
                    auth = cache.authorized;
                } else {
                    this.authCache.splice(i, 1);
                }
                break;
            }
        }

        if (typeof auth == "undefined") {
            let lastException = undefined;
            for (let retry = 0; retry < 10; retry++) {
                try {
                    const url = `${this.baseUrl}/?id=${nodeId}&method=${methodName}`;
                    const response = await fetch(url);
                    const data = await response.json();
                    const authorized =
                        data &&
                        data[nodeId] &&
                        data[nodeId][methodName] &&
                        data[nodeId][methodName] &&
                        data[nodeId][methodName]["authorized"]
                            ? true
                            : false;
                    auth = {
                        id: nodeId,
                        methodName: methodName,
                        authorized: authorized,
                        timestamp: Date.now(),
                    };
                    this.authCache.push(auth);
                    lastException = undefined;
                    this.logger.finer("Loaded auth", auth);
                    break;
                } catch (e) {
                    lastException = e;
                    this.logger.log(e);
                    await new Promise((resolve) => setTimeout(resolve, 1000));
                }
            }
            if (lastException) {
                this.logger.log("Error getting auth", lastException);
                throw lastException;
            }
        }

        return auth;
    }

    async isEventAuthorized(event: Event): Promise<boolean> {
        if(event.pubkey==this.poolPublicKey) return true;
        const kind = event.kind;
        let jobEvent=false;
        if (kind >= 5000 && kind <= 5999) {
            jobEvent=true;
            if(await  this.isNodeAuthorized("submitJobRequestEvent", event.pubkey))return true;
        }
        if(kind>=6000 && kind<=6999){
            jobEvent = true;
            if(await  this.isNodeAuthorized("submitJobResponseEvent", event.pubkey))return true;
        }
        if(kind==7000){
            jobEvent = true;
            if(await  this.isNodeAuthorized("submitJobFeedbackEvent", event.pubkey))return true;
        }
        if(jobEvent){
            if(await  this.isNodeAuthorized("submitJobEvent", event.pubkey))return true;
        }
        return this.isNodeAuthorized("submitEvent", event.pubkey);
        
    }

    async isNodeAuthorized(methodName: string, nodeId: string): Promise<boolean> {
        if(nodeId==this.poolPublicKey) return true;
        const auth = await this._getAuth(methodName, nodeId);
        if (auth) return true;
        const allAuth = await this._getAuth(methodName, "*");
        if (allAuth) return true;
        const authAllMethods = await this._getAuth("*", nodeId);
        if (authAllMethods) return true;
        const allAuthAllMethods = await this._getAuth("*", "*");
        if (allAuthAllMethods) return true;
        return false;
    }
}