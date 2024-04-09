import * as GRPC from "@grpc/grpc-js";
import * as GPRCBackend from "@protobuf-ts/grpc-backend";
import { ReflectionService } from "@grpc/reflection";
import { loadFileDescriptorSetFromBuffer } from "@grpc/proto-loader";

import { INostrConnector } from "./proto/rpc.server";
import { NostrConnector as NostrConnectorType, RpcSendSignedEventResponse } from "./proto/rpc";
import {
  ServerCallContext,
} from "@protobuf-ts/runtime-rpc";

import {
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
} from "./proto/rpc";
import Job  from "./Job";
import NostrConnector from "./NostrConnector";
import { JobStatus } from "./proto/JobStatus";
import Fs from 'fs';

class RpcNostrConnector implements INostrConnector {
    conn: NostrConnector;
    constructor(conn){
        this.conn = conn;
    }

    async getJob(request: RpcGetJob, context: ServerCallContext): Promise<Job> {
        const id = request.jobId;
        const job = await this.conn.getJob(id);
        return job;
    }

    async getPendingJobs(request: RpcGetPendingJobs, context: ServerCallContext): Promise<PendingJobs> {
        const jobIdFilter: RegExp = new RegExp(request.filterById || ".*");
        const customerFilter: RegExp = new RegExp(request.filterByCustomer || ".*");
        const runOnFilter: RegExp = new RegExp(request.filterByRunOn || ".*");
        const descriptionFilter: RegExp = new RegExp(request.filterByDescription || ".*");
        const kindFilter: RegExp = new RegExp(request.filterByKind || ".*");
        const jobs = await this.conn.findJobs(
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
        return this.conn.acceptJob(request.jobId);
    }

    cancelJob(request: RpcCancelJob, context: ServerCallContext): Promise<Job> {
        return this.conn.cancelJob(request.jobId, request.reason);
    }

    outputForJob(request: RpcJobOutput, context: ServerCallContext): Promise<Job> {
        return this.conn.outputForJob(request.jobId, request.output);
    }

    completeJob(request: RpcJobComplete, context: ServerCallContext): Promise<Job> {
        return this.conn.completeJob(request.jobId, request.output);
    }

    logForJob(request: RpcJobLog, context: ServerCallContext): Promise<Job> {
        return this.conn.logForJob(request.jobId, request.log);
    }

    requestJob(request: RpcRequestJob, context: ServerCallContext): Promise<Job> {
        return this.conn.requestJob(
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
        await this.conn.sendSignedEvent(request.event);
        return {
            parentJob: request.parentJob,
            success: true,
        } as RpcSendSignedEventResponse;
    }

    async subscribeToEvents(
        request: RpcSubscribeToEventsRequest,
        context: ServerCallContext
    ): Promise<RpcSubscribeToEventsResponse> {
        const subId = await this.conn.openCustomSubscription(request.parentJob, request.filters);
        return {
            parentJob: request.parentJob,
            subscriptionId: subId,
        };
    }


    async getEvents(request: RpcGetEventsRequest, context: ServerCallContext): Promise<RpcGetEventsResponse> {
        const events: string[] = await this.conn.getAndConsumeCustomEvents(
            request.parentJob,
            request.subscriptionId,
            request.limit
        );
        return {
            parentJob: request.parentJob,
            subscriptionId: request.subscriptionId,
            count: events.length,
            events,
        };
    }

    async unsubscribeFromEvents(
        request: RpcUnsubscribeFromEventsRequest,
        context: ServerCallContext
    ): Promise<RpcUnsubscribeFromEventsResponse> {
        await this.conn.closeCustomSubscription(request.parentJob, request.subscriptionId);
        return {
            success: true,
        };
    }
}


export default class RPCServer {
    addr: string;
    port: number;
    descriptorPath: string;
    nostrConnector: NostrConnector;
    constructor(addr:string, port:number, descriptorPath:string,nostrConnector: NostrConnector) {
        this.addr = addr;
        this.port = port;
        this.descriptorPath = descriptorPath;
        this.nostrConnector=nostrConnector;
    }

    async start() {
        return new Promise((resolve, reject) => {
            
            const server = new GRPC.Server({
                interceptors: [],
            });

            server.addService(...GPRCBackend.adaptService(NostrConnectorType, new RpcNostrConnector(this.nostrConnector)));
            if(Fs.existsSync(this.descriptorPath)){
                const descriptorSetBuffer = Fs.readFileSync(this.descriptorPath);
                const pkg = loadFileDescriptorSetFromBuffer(descriptorSetBuffer); 
                const reflection = new ReflectionService(pkg);
                reflection.addToServer(server);
            }
            server.bindAsync(
                `${this.addr}:${this.port}`,
                GRPC.ServerCredentials.createInsecure(),
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

