import * as GRPC from "@grpc/grpc-js";
import Utils from "./Utils";
import { generateSecretKey, getPublicKey, Event } from "nostr-tools";
import Logger from "./Logger";
import { bytesToHex, hexToBytes } from "@noble/hashes/utils";
type ActiveAuth = {
    timestamp: number;
    token: string;
    publicToken: string;
}
export default class Auth {
    logger = Logger.get(this.constructor.name);
    activeAuthsList: { [key: string]: ActiveAuth } = {};

    constructor() {
        this.cleanup();
    }

    async cleanup(){
        const now = Date.now();
        for (const [token, conn] of Object.entries(this.activeAuthsList)){
            if(now-conn.timestamp>1000*60*60){
                delete this.activeAuthsList[token];
            }
        }
        setTimeout(()=>this.cleanup(),1000*60*30);
    }

    async isEventAuthorized(event: Event): Promise<boolean> {
        return true;
    }

    async isNodeAuthorized(methodName: string, nodeId: string): Promise<boolean> {
        return true;
    }

    adaptNodeService(
        poolSecretKey: string,
        data: [GRPC.ServiceDefinition, GRPC.UntypedServiceImplementation]
    ): [GRPC.ServiceDefinition, GRPC.UntypedServiceImplementation] {
        let [def, impl] = data;
        
        impl = Object.fromEntries(
            Object.entries(impl).map(([methodName, methodImplementation]: [any, any]) => [
                methodName,
                (call, callback) => {
                    try {
                        const metadata = call.metadata.getMap();
                        const token: string =
                            metadata["authorization"] || bytesToHex(Utils.generateSecretKey(call.getPeer()));

                        let conn=this.activeAuthsList[token] ;
                        if(!conn){
                            const tokenBytes = hexToBytes(token);
                            const id = Utils.getPublicKey(tokenBytes);
                            this.activeAuthsList[token] = conn = {
                                timestamp: Date.now(),
                                token: token,
                                publicToken: id,
                            };
                            this.logger.info("Incoming new connection from ", id);
                        }else{
                            conn.timestamp = Date.now();
                        }
                        

                        call.metadata.set("nodeid", conn.publicToken);
                        call.metadata.set("cacheid", call.metadata.get("nodeid"));

                        if (this.isNodeAuthorized(methodName, conn.publicToken)) {
                            methodImplementation(call, callback);
                        } else {
                            callback({
                                code: GRPC.status.UNAUTHENTICATED,
                                message: "Invalid token",
                            });
                        }
                    } catch (e) {
                        this.logger.error("Error",e);
                        throw e;
                    }
                },
            ])
        );

        return [def, impl];
    }
}
