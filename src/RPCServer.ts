import * as GRPC from "@grpc/grpc-js";
import * as GPRCBackend from "@protobuf-ts/grpc-backend";
import { ReflectionService } from "@grpc/reflection";
import { loadFileDescriptorSetFromBuffer } from "@grpc/proto-loader";
import Auth from "./Auth";

 
import {
  ServerCallContext,
} from "@protobuf-ts/runtime-rpc";

import {
    PoolConnector,
    RpcAnnounceNodeRequest,
    RpcAnnounceTemplateRequest,
    RpcAnnounceTemplateResponse,
    RpcSendSignedEventResponse,
    RpcGetEventsResponse,
    RpcGetEventsRequest,
    RpcSubscribeToEventsResponse,
    RpcSubscribeToEventsRequest,
    RpcSendSignedEventRequest,
    RpcIsJobDone,
    PendingJobs,
    RpcGetPendingJobs,
    RpcGetJob,
    RpcRequestJob,
    RpcAcceptJob,
    RpcCancelJob,
    RpcJobOutput,
    RpcUnsubscribeFromEventsRequest,
    RpcUnsubscribeFromEventsResponse,
    RpcJobComplete,
    RpcJobLog,
    RpcAnnounceNodeResponse,
    JobStatus,
    IPoolConnector
} from "openagents-grpc-proto";
import Job  from "./Job";
import NostrConnector from "./NostrConnector";

import Fs from 'fs';

class RpcConnector implements IPoolConnector {
    conn: NostrConnector;
    constructor(conn) {
        this.conn = conn;
    }

    getNodeId(context: ServerCallContext): string {
        return context.headers["nodeid"] as string;
    }

    async getJob(request: RpcGetJob, context: ServerCallContext): Promise<Job> {
        const nodeId = this.getNodeId(context);
        const id = request.jobId;
        const job = await this.conn.getJob(nodeId, id);
        return job;
    }

    async getPendingJobs(request: RpcGetPendingJobs, context: ServerCallContext): Promise<PendingJobs> {
        const nodeId = this.getNodeId(context);
        const jobIdFilter: RegExp = new RegExp(request.filterById || ".*");
        const customerFilter: RegExp = new RegExp(request.filterByCustomer || ".*");
        const runOnFilter: RegExp = new RegExp(request.filterByRunOn || ".*");
        const descriptionFilter: RegExp = new RegExp(request.filterByDescription || ".*");
        const kindFilter: RegExp = new RegExp(request.filterByKind || ".*");
        const jobs = await this.conn.findJobs(
            nodeId,
            jobIdFilter,
            runOnFilter,
            descriptionFilter,
            customerFilter,
            kindFilter,
            true
        );
        const pendingJobs: PendingJobs = {
            jobs,
        };
        return pendingJobs;
    }

    async isJobDone(request: RpcGetJob, context: ServerCallContext): Promise<RpcIsJobDone> {
        const nodeId = this.getNodeId(context);
        const job = await this.getJob(request, context);
        if (job && job.state.status == JobStatus.SUCCESS) {
            return {
                isDone: true,
            };
        } else {
            return {
                isDone: false,
            };
        }
    }

    acceptJob(request: RpcAcceptJob, context: ServerCallContext): Promise<Job> {
        const nodeId = this.getNodeId(context);
        return this.conn.acceptJob(nodeId, request.jobId);
    }

    cancelJob(request: RpcCancelJob, context: ServerCallContext): Promise<Job> {
        const nodeId = this.getNodeId(context);
        return this.conn.cancelJob(nodeId, request.jobId, request.reason);
    }

    outputForJob(request: RpcJobOutput, context: ServerCallContext): Promise<Job> {
        const nodeId = this.getNodeId(context);
        return this.conn.outputForJob(nodeId, request.jobId, request.output);
    }

    completeJob(request: RpcJobComplete, context: ServerCallContext): Promise<Job> {
        const nodeId = this.getNodeId(context);
        return this.conn.completeJob(nodeId, request.jobId, request.output);
    }

    logForJob(request: RpcJobLog, context: ServerCallContext): Promise<Job> {
        const nodeId = this.getNodeId(context);
        return this.conn.logForJob(nodeId, request.jobId, request.log);
    }

    requestJob(request: RpcRequestJob, context: ServerCallContext): Promise<Job> {
        const nodeId = this.getNodeId(context);
        return this.conn.requestJob(
            nodeId,
            request.runOn,
            request.expireAfter,
            request.input,
            request.param,
            request.description,
            request.kind,
            request.outputFormat
        );
    }

    async sendSignedEvent(
        request: RpcSendSignedEventRequest,
        context: ServerCallContext
    ): Promise<RpcSendSignedEventResponse> {
        const nodeId = this.getNodeId(context);
        await this.conn.sendSignedEvent(request.event);
        return {
            groupId: request.groupId,
            success: true,
        } as RpcSendSignedEventResponse;
    }

    async subscribeToEvents(
        request: RpcSubscribeToEventsRequest,
        context: ServerCallContext
    ): Promise<RpcSubscribeToEventsResponse> {
        const nodeId = this.getNodeId(context);
        const subId = await this.conn.openCustomSubscription(request.groupId, request.filters);
        return {
            groupId: request.groupId,
            subscriptionId: subId,
        };
    }

    async getEvents(request: RpcGetEventsRequest, context: ServerCallContext): Promise<RpcGetEventsResponse> {
        const nodeId = this.getNodeId(context);
        const events: string[] = await this.conn.getAndConsumeCustomEvents(
            request.groupId,
            request.subscriptionId,
            request.limit
        );
        return {
            groupId: request.groupId,
            subscriptionId: request.subscriptionId,
            count: events.length,
            events,
        };
    }

    async unsubscribeFromEvents(
        request: RpcUnsubscribeFromEventsRequest,
        context: ServerCallContext
    ): Promise<RpcUnsubscribeFromEventsResponse> {
        const nodeId = this.getNodeId(context);
        await this.conn.closeCustomSubscription(request.groupId, request.subscriptionId);
        return {
            success: true,
        };
    }

    async announceNode(
        request: RpcAnnounceNodeRequest,
        context: ServerCallContext
    ): Promise<RpcAnnounceNodeResponse> {
        const nodeId = this.getNodeId(context);
        const [node, timeout] = await this.conn.registerNode(
            nodeId,
            request.name,
            request.iconUrl,
            request.description
        );
        return {
            success: true,
            node: node,
            refreshInterval: timeout,
        };
    }

    async announceEventTemplate(
        request: RpcAnnounceTemplateRequest,
        context: ServerCallContext
    ): Promise<RpcAnnounceTemplateResponse> {
        const nodeId = this.getNodeId(context);
        const node = this.conn.getNode(nodeId);
        if (!node) throw new Error("Node not found");
        const timeout = node.registerTemplate(request.eventTemplate);
        return {
            success: true,
            node: node,
            refreshInterval: timeout,
        };
    }
}


export default class RPCServer {
    addr: string;
    port: number;
    descriptorPath: string;
    nostrConnector: NostrConnector;
    caCrt: Buffer | undefined;
    serverCrt: Buffer | undefined;
    serverKey: Buffer | undefined;
    constructor(
        addr: string,
        port: number,
        descriptorPath: string,
        nostrConnector: NostrConnector,
        caCrt?: Buffer,
        serverCrt?: Buffer,
        serverKey?: Buffer
    ) {
        this.addr = addr;
        this.port = port;
        this.descriptorPath = descriptorPath;
        this.nostrConnector = nostrConnector;
        this.caCrt = caCrt;
        this.serverCrt = serverCrt;
        this.serverKey = serverKey;
    }

    async start() {
       
        return new Promise((resolve, reject) => {
            const server = new GRPC.Server({
                interceptors: [],
            });

           
            
            server.addService(
                ...Auth.adaptService(
                    GPRCBackend.adaptService(PoolConnector, new RpcConnector(this.nostrConnector))
                )
            );

            if (Fs.existsSync(this.descriptorPath)) {
                const descriptorSetBuffer = Fs.readFileSync(this.descriptorPath);
                const pkg = loadFileDescriptorSetFromBuffer(descriptorSetBuffer);
                const reflection = new ReflectionService(pkg);
                reflection.addToServer(server);
            }
            server.bindAsync(
                `${this.addr}:${this.port}`,
                this.caCrt && this.serverCrt && this.serverKey
                    ? GRPC.ServerCredentials.createSsl(
                          this.caCrt,
                          [
                              {
                                  private_key: this.serverKey,
                                  cert_chain: this.serverCrt,
                              },
                          ],
                          false
                      )
                    : GRPC.ServerCredentials.createInsecure(),
                (err: Error | null, port: number) => {
                    if (err) {
                        reject(err);
                        console.error(`Server error: ${err.message}`);
                    } else {
                        resolve(true);
                        console.log(`Server bound on port: ${port}`);
                    }
                }
            );
        });
    }
}

