import * as GRPC from "@grpc/grpc-js";
import Utils from "./Utils";
import { generateSecretKey, getPublicKey,Event } from "nostr-tools";
import Logger from "./Logger";
export default class Auth {
    logger=Logger.get(this.constructor.name);

    async isEventAuthorized(event: Event): Promise<boolean> {
        return true;
    }

    async isNodeAuthorized(methodName: string, nodeId: string): Promise<boolean> {
        return true;
    }

    adaptNodeService(
        poolSecretKey: string,
        data: [GRPC.ServiceDefinition, GRPC.UntypedServiceImplementation]): [GRPC.ServiceDefinition, GRPC.UntypedServiceImplementation]{
        let [def, impl] = data;

           impl = Object.fromEntries(
               Object.entries(impl).map(([methodName, methodImplementation]: [any, any]) => [
                   methodName,
                   (call, callback) => {
                       try {
                           const metadata = call.metadata.getMap();
                           const token: string = metadata["authorization"] || Utils.uuidFrom(call.getPeer());
                           const id = Utils.uuidFrom(token);
                            call.metadata.set("nodeid", id);
                            call.metadata.set("cacheid", call.metadata.get("nodeid"));
                           

                           if (this.isNodeAuthorized(methodName, id)) {
                               methodImplementation(call, callback);
                           } else {
                               callback({
                                   code: GRPC.status.UNAUTHENTICATED,
                                   message: "Invalid token",
                               });
                           }
                       } catch (e) {
                        this.logger.error(e);
                        throw e;
                        }
                   },
               ])
           );

              return [def, impl];

    }
}
