import * as GRPC from "@grpc/grpc-js";
import Utils from "./Utils";
import { generateSecretKey, getPublicKey } from "nostr-tools";

export default class Auth {


    static isAuthorized(methodName: string, nodeId: string): boolean {
        return true;
    }

    static adaptService(
        poolSecretKey: string,
        data: [GRPC.ServiceDefinition, GRPC.UntypedServiceImplementation]): [GRPC.ServiceDefinition, GRPC.UntypedServiceImplementation]{
        let [def, impl] = data;

           impl = Object.fromEntries(
               Object.entries(impl).map(([methodName, methodImplementation]: [any, any]) => [
                   methodName,
                   (call, callback) => {
                       const metadata = call.metadata.getMap();
                       const token: string = metadata["authorization"] || Utils.uuidFrom(call.getPeer());
                       const id = Utils.uuidFrom(token);
                       call.metadata.set("nodeid", id);
                       if (this.isAuthorized(methodName, id)) {
                           methodImplementation(call, callback);
                       } else {
                           callback({
                               code: GRPC.status.UNAUTHENTICATED,
                               message: "Invalid token",
                           });
                       }
                   },
               ])
           );

              return [def, impl];

    }
}
