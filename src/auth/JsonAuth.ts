import Auth from "../Auth";
import {Event} from "nostr-tools";
type AuthCache = {
    id: string;
    methodName: string;
    authorized: boolean;
    timestamp: number;
}
export default class JsonAuth extends Auth {
    baseUrl: string;
    authCache: AuthCache[] = [];

    constructor(baseUrl: string) {
        super();
        this.baseUrl = baseUrl;
    }

    async _getAuth(methodName: string ,nodeId:string): Promise<AuthCache>{
        let auth = undefined;
        for(let i=0; i<this.authCache.length; i++){
            const cache = this.authCache[i];
            if(cache.id === nodeId && cache.methodName === methodName){
                if(Date.now() - cache.timestamp < 1000*60*5){
                    auth = cache.authorized;
                }else{
                    this.authCache.splice(i,1);
                }
                break;
            }
        }
        
        if(!auth){
            let lastException=undefined;
            for(let retry=0;retry<10;retry++){
                try{
                    const url = `${this.baseUrl}/?id=${nodeId}&method=${methodName}`;
                    const response = await fetch(url);
                    const data = await response.json();
                    const authorized =
                        data && data[nodeId] && data[nodeId][methodName] && data[nodeId][methodName].authorized;
                    auth = {
                        id: nodeId,
                        methodName: methodName,
                        authorized: authorized,
                        timestamp: Date.now(),
                    };
                    this.authCache.push(auth);
                    lastException=undefined;
                    break;
                }catch(e){
                    lastException = e;
                    console.log(e);
                    await new Promise((resolve) => setTimeout(resolve, 1000));
                }
            }
            if(lastException){
                throw lastException;
            }
        }
        
        return auth;

    }

    async isEventAuthorized(event: Event): Promise<boolean> {
        const kind = event.kind;
        if(kind < 5000|| kind > 5999)return true;
        return this.isNodeAuthorized("submitEvent", event.pubkey);
    }

    async isNodeAuthorized(methodName: string, nodeId: string): Promise<boolean> {
        const auth = await this._getAuth(methodName, nodeId);
        if (auth.authorized) return true;
        const allAuth = await this._getAuth(methodName, "*");
        if (allAuth.authorized) return true;
        const authAllMethods = await this._getAuth("*", nodeId);
        if (authAllMethods.authorized) return true;
        const allAuthAllMethods = await this._getAuth("*", "*");
        if (allAuthAllMethods.authorized) return true;
        return false;        
    }
}