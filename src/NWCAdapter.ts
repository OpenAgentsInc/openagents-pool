import * as GRPC from "@grpc/grpc-js";
import Utils from "./Utils";
import { generateSecretKey, getPublicKey, Event } from "nostr-tools";
import Logger from "./Logger";
import { bytesToHex, hexToBytes } from "@noble/hashes/utils";
import NostrConnector from "./NostrConnector";

export default class NWCAdapter {
    protected logger = Logger.get(this.constructor.name);
    private conn: NostrConnector;
    constructor(conn:NostrConnector) {
        this.conn=conn;
    }

    
    adaptNodeService(
        poolPublicKey: string,
        data: [GRPC.ServiceDefinition, GRPC.UntypedServiceImplementation]
    ): [GRPC.ServiceDefinition, GRPC.UntypedServiceImplementation] {
        let [def, impl] = data;

        impl = Object.fromEntries(
            Object.entries(impl).map(([methodName, methodImplementation]: [any, any]) => [
                methodName,
                async (call, callback) => {
                    try {
                        const metadata = call.metadata.getMap();
                        const nwc: string = metadata["nwc"] || "";
                        if (nwc) {
                            const nwcData = Utils.parseNWC(nwc);
                            if (nwcData){
                                call.metadata.set("nwc-data", JSON.stringify(nwcData));
                                if (nwcData.relay) this.conn.addExtraRelays([nwcData.relay]);                       
                            }
                        }                      
                        methodImplementation(call, callback);
                    } catch (e) {
                        this.logger.error("Error", e);
                        throw e;
                    }
                },
            ])
        );

        return [def, impl];
    }
}
