import * as GRPC from "@grpc/grpc-js";
import * as GPRCBackend from "@protobuf-ts/grpc-backend";
import { ReflectionService } from "@grpc/reflection";
import { loadFileDescriptorSetFromBuffer } from "@grpc/proto-loader";
import Auth from "./Auth";
import Utils from "./Utils";
 import {
    Writable,
    Readable
 }  from "stream";
import {
    RpcInputStream,
    RpcOutputStream,
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
    IPoolConnector,
    RpcCloseDiskRequest,
    RpcCloseDiskResponse,
    RpcCreateDiskRequest,
    RpcCreateDiskResponse,
    RpcDiskDeleteFileRequest,
    RpcDiskDeleteFileResponse,
    RpcDiskListFilesRequest,
    RpcDiskListFilesResponse,
    RpcDiskReadFileRequest,
    RpcDiskReadFileResponse,
    RpcDiskWriteFileRequest,
    RpcDiskWriteFileResponse,
    RpcOpenDiskRequest,
    RpcOpenDiskResponse,
    RpcCacheGetRequest,
    RpcCacheGetResponse,
    RpcCacheSetRequest,
    RpcCacheSetResponse
} from "openagents-grpc-proto";
import Job  from "./Job";
import NostrConnector from "./NostrConnector";

import Fs from 'fs';
import HyperdrivePool, { SharedDrive } from "./HyperdrivePool";
import {DriverOut} from "./HyperdrivePool";
import Cache, { CacheDisk } from "./Cache";

class RpcConnector implements IPoolConnector {
    conn: NostrConnector;
    hyp: HyperdrivePool;
    cache: Cache;
    constructor(conn, hyp, cache) {
        this.conn = conn;
        this.hyp = hyp;
        this.cache = cache;
    }

    async createDisk(
        request: RpcCreateDiskRequest,
        context: ServerCallContext
    ): Promise<RpcCreateDiskResponse> {
        try {
            const nodeId = this.getNodeId(context);
            const url = await this.hyp.create(
                nodeId,
                request.encryptionKey,
                request.includeEncryptionKeyInUrl
            );
            return {
                url,
            };
        } catch (e) {
            console.log(e);
            throw e;
        }
    }
    async openDisk(request: RpcOpenDiskRequest, context: ServerCallContext): Promise<RpcOpenDiskResponse> {
        try {
            const nodeId = this.getNodeId(context);
            const [disk, version] = await this.hyp.open(nodeId, request.url);
            return {
                success: true,
                diskId: disk,
                version: version,
            };
        } catch (e) {
            console.log(e);
            throw e;
        }
    }

    async closeDisk(request: RpcCloseDiskRequest, context: ServerCallContext): Promise<RpcCloseDiskResponse> {
        try {
            const nodeId = this.getNodeId(context);
            await this.hyp.commit(request.diskId);
            return {
                success: true,
            };
        } catch (e) {
            console.log(e);
            throw e;
        }
    }

    async diskDeleteFile(
        request: RpcDiskDeleteFileRequest,
        context: ServerCallContext
    ): Promise<RpcDiskDeleteFileResponse> {
        try {
            const nodeId = this.getNodeId(context);
            const disk = await this.hyp.get(nodeId, request.diskId);
            await disk.del(request.path);
            return {
                success: true,
            };
        } catch (e) {
            console.log(e);
            throw e;
        }
    }

    async diskListFiles(
        request: RpcDiskListFilesRequest,
        context: ServerCallContext
    ): Promise<RpcDiskListFilesResponse> {
        try {
            const nodeId = this.getNodeId(context);
            const disk = await this.hyp.get(nodeId, request.diskId);
            const files = await disk.list(request.path);
            return {
                files,
            };
        } catch (e) {
            console.log(e);
            throw e;
        }
    }

    async diskReadFile(
        request: RpcDiskReadFileRequest,
        responses: RpcInputStream<RpcDiskReadFileResponse>,
        context: ServerCallContext
    ): Promise<void> {
        try {
            const nodeId = this.getNodeId(context);
            const disk = await this.hyp.get(nodeId, request.diskId);
            const readStream = await disk.inputStream(request.path);
            for await (const chunk of readStream) {
                responses.send({ data: chunk, exists: true });
            }
            await responses.complete();
        } catch (e) {
            console.log(e);
            throw e;
        }
    }

    async diskWriteFile(
        requests: RpcOutputStream<RpcDiskWriteFileRequest>,
        context: ServerCallContext
    ): Promise<RpcDiskWriteFileResponse> {
        try {
            const nodeId = this.getNodeId(context);

            let diskId: string | undefined;
            let outputStream: DriverOut | undefined;
            for await (const request of requests) {
                try {
                    if (!diskId) {
                        diskId = request.diskId;
                        const disk = await this.hyp.get(nodeId, diskId);
                        outputStream = await disk.outputStream(request.path);
                    } else if (diskId !== request.diskId) {
                        throw new Error("Cannot write to multiple disks");
                    }
                    await outputStream.write(request.data);
                } catch (e) {
                    console.log(e);
                    throw e;
                }
            }
            await outputStream.flushAndWait();
            return {
                success: true,
            };
        } catch (e) {
            console.log(e);
            throw e;
        }
    }

    async cacheSet(
        requests: RpcOutputStream<RpcCacheSetRequest>,
        context: ServerCallContext
    ): Promise<RpcCacheSetResponse> {
        try {
            const nodeId = this.getNodeId(context);
            const cache = await this.getCache(context);
            let outputStream: DriverOut | undefined;
            for await (const request of requests) {
                try {
                    if (!outputStream) {
                        outputStream = await cache.setAsStream(
                            request.key,
                            request.version,
                            request.expireAt || 0
                        );
                    }
                    await outputStream.write(request.data);
                } catch (e) {
                    console.log(e);
                    throw e;
                }
            }
            await outputStream.flushAndWait();
            return {
                success: true,
            };
        } catch (e) {
            console.log(e);
            throw e;
        }
    }

    async cacheGet(
        request: RpcCacheGetRequest,
        responses: RpcInputStream<RpcCacheGetResponse>,
        context: ServerCallContext
    ): Promise<void> {
        try {
            const nodeId = this.getNodeId(context);
            const cache = await this.getCache(context);
            const readStream = await cache.getAsStream(request.key, request.lastVersion);
            if (!readStream) {
                await responses.send({ data: Buffer.from([]), exists: false });
                await responses.complete();
            } else {
                for await (const chunk of readStream) {
                    await responses.send({ data: chunk, exists: true });
                }
                await responses.complete();
            }
        } catch (e) {
            console.log(e);
            throw e;
        }
    }

    async diskWriteSmallFile(
        request: RpcDiskWriteFileRequest,
        context: ServerCallContext
    ): Promise<RpcDiskWriteFileResponse> {
        try {
            const nodeId = this.getNodeId(context);
            const disk = await this.hyp.get(nodeId, request.diskId);
            await disk.put(request.path, request.data);
            return {
                success: true,
            };
        } catch (e) {
            console.log(e);
            throw e;
        }
    }

    async diskReadSmallFile(
        request: RpcDiskReadFileRequest,
        context: ServerCallContext
    ): Promise<RpcDiskReadFileResponse> {
        try {
            const nodeId = this.getNodeId(context);
            const disk = await this.hyp.get(nodeId, request.diskId);
            const data = await disk.get(request.path);
            return {
                data,
                exists: true,
            };
        } catch (e) {
            console.log(e);
            throw e;
        }
    }

    getNodeId(context: ServerCallContext): string {
        return context.headers["nodeid"] as string;
    }

    async getCache(context: ServerCallContext): Promise<CacheDisk> {
        const cacheId = context.headers["cacheid"] as string;
        return this.cache.get(cacheId);
    }

    async getJob(request: RpcGetJob, context: ServerCallContext): Promise<Job> {
        try {
            const nodeId = this.getNodeId(context);
            const id = request.jobId;
            let job = undefined;
            if (request.wait) {
                job = await Utils.busyWaitForSomething(
                    async () => {
                        try {
                            job = await this.conn.getJob(nodeId, id);    
                            const isDone = job && job.state.status == JobStatus.SUCCESS && job.result.timestamp;
                            if (isDone) return job;
                        } catch (e) {}
                        return undefined;
                    }, () => {
                        return job; // return last fetched job
                    },
                    request.wait
                );
            } 
            if(!job) job = await this.conn.getJob(nodeId, id);    
            return job;
        } catch (e) {
            console.log(e);
            throw e;
        }
    }

    async getPendingJobs(request: RpcGetPendingJobs, context: ServerCallContext): Promise<PendingJobs> {
        try {
            const nodeId = this.getNodeId(context);
            const jobIdFilter: RegExp = new RegExp(request.filterById || ".*");
            const customerFilter: RegExp = new RegExp(request.filterByCustomer || ".*");
            const runOnFilter: RegExp = new RegExp(request.filterByRunOn || ".*");
            const descriptionFilter: RegExp = new RegExp(request.filterByDescription || ".*");
            const kindFilter: RegExp = new RegExp(request.filterByKind || ".*");

            const findJobs=async ()=>{
                return await this.conn.findJobs(
                    nodeId,
                    jobIdFilter,
                    runOnFilter,
                    descriptionFilter,
                    customerFilter,
                    kindFilter,
                    true
                );
            };

            let jobs = [];
            if(request.wait){
                jobs=await Utils.busyWaitForSomething(async ()=>{
                    const j = await findJobs();
                    if(j.length>0)return j;
                },()=>{
                    return [];
                },request.wait);
            }else[
                jobs=await findJobs()
            ]

            const pendingJobs: PendingJobs = {
                jobs,
            };
            return pendingJobs;
        } catch (e) {
            console.log(e);
            throw e;
        }
    }

    async isJobDone(request: RpcGetJob, context: ServerCallContext): Promise<RpcIsJobDone> {
        try {
            const nodeId = this.getNodeId(context);
            let isDone=false
            if(request.wait){
                isDone=await Utils.busyWaitForSomething(async ()=>{
                    try{
                        const job = await this.getJob(request, context);
                        const isDone=job && job.state.status == JobStatus.SUCCESS &&job.result.timestamp;
                        if(isDone)return true;
                    }catch(e){
                    }
                    return undefined;
                },()=>{
                    return false;
                },request.wait);
            }else{
                const job = await this.getJob(request, context);
                isDone=job && job.state.status == JobStatus.SUCCESS && job.result.timestamp>0;
            }            
            return {
                isDone
            };
           
        } catch (e) {
            console.log(e);
            throw e;
        }
    }

    acceptJob(request: RpcAcceptJob, context: ServerCallContext): Promise<Job> {
        try {
            const nodeId = this.getNodeId(context);
            return this.conn.acceptJob(nodeId, request.jobId);
        } catch (e) {
            console.log(e);
            throw e;
        }
    }

    cancelJob(request: RpcCancelJob, context: ServerCallContext): Promise<Job> {
        try {
            const nodeId = this.getNodeId(context);
            return this.conn.cancelJob(nodeId, request.jobId, request.reason);
        } catch (e) {
            console.log(e);
            throw e;
        }
    }

    outputForJob(request: RpcJobOutput, context: ServerCallContext): Promise<Job> {
        try {
            const nodeId = this.getNodeId(context);
            return this.conn.outputForJob(nodeId, request.jobId, request.output);
        } catch (e) {
            console.log(e);
            throw e;
        }
    }

    completeJob(request: RpcJobComplete, context: ServerCallContext): Promise<Job> {
        try {
            const nodeId = this.getNodeId(context);
            return this.conn.completeJob(nodeId, request.jobId, request.output);
        } catch (e) {
            console.log(e);
            throw e;
        }
    }

    logForJob(request: RpcJobLog, context: ServerCallContext): Promise<Job> {
        try {
            const nodeId = this.getNodeId(context);
            return this.conn.logForJob(nodeId, request.jobId, request.log);
        } catch (e) {
            console.log(e);
            throw e;
        }
    }

    requestJob(request: RpcRequestJob, context: ServerCallContext): Promise<Job> {
        try {
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
        } catch (e) {
            console.log(e);
            throw e;
        }
    }

    async sendSignedEvent(
        request: RpcSendSignedEventRequest,
        context: ServerCallContext
    ): Promise<RpcSendSignedEventResponse> {
        try {
            const nodeId = this.getNodeId(context);
            await this.conn.sendSignedEvent(request.event);
            return {
                groupId: request.groupId,
                success: true,
            } as RpcSendSignedEventResponse;
        } catch (e) {
            console.log(e);
            throw e;
        }
    }

    async subscribeToEvents(
        request: RpcSubscribeToEventsRequest,
        context: ServerCallContext
    ): Promise<RpcSubscribeToEventsResponse> {
        try {
            const nodeId = this.getNodeId(context);
            const subId = await this.conn.openCustomSubscription(request.groupId, request.filters);
            return {
                groupId: request.groupId,
                subscriptionId: subId,
            };
        } catch (e) {
            console.log(e);
            throw e;
        }
    }

    async getEvents(request: RpcGetEventsRequest, context: ServerCallContext): Promise<RpcGetEventsResponse> {
        try {
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
        } catch (e) {
            console.log(e);
            throw e;
        }
    }

    async unsubscribeFromEvents(
        request: RpcUnsubscribeFromEventsRequest,
        context: ServerCallContext
    ): Promise<RpcUnsubscribeFromEventsResponse> {
        try {
            const nodeId = this.getNodeId(context);
            await this.conn.closeCustomSubscription(request.groupId, request.subscriptionId);
            return {
                success: true,
            };
        } catch (e) {
            console.log(e);
            throw e;
        }
    }

    async announceNode(
        request: RpcAnnounceNodeRequest,
        context: ServerCallContext
    ): Promise<RpcAnnounceNodeResponse> {
        try {
            const nodeId = this.getNodeId(context);
            const [node, timeout] = await this.conn.registerNode(
                nodeId,
                request.name,
                request.iconUrl,
                request.description
            );
            return {
                success: true,
                refreshInterval: timeout,
            };
        } catch (e) {
            console.log(e);
            throw e;
        }
    }

    async announceEventTemplate(
        request: RpcAnnounceTemplateRequest,
        context: ServerCallContext
    ): Promise<RpcAnnounceTemplateResponse> {
        try {
            const nodeId = this.getNodeId(context);
            const node = this.conn.getNode(nodeId);
            if (!node) throw new Error("Node not found");
            const timeout = node.registerTemplate(request.meta, request.template, request.sockets);
            return {
                success: true,
                refreshInterval: timeout,
            };
        } catch (e) {
            console.log(e);
            throw e;
        }
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
    hyperdrivePool: HyperdrivePool;
    poolSecretKey: string;
    cache: Cache;
    constructor(
        poolSecretKey: string,
        addr: string,
        port: number,
        descriptorPath: string,
        nostrConnector: NostrConnector,
        hyperdrivePool: HyperdrivePool,
        cache: Cache,
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
        this.hyperdrivePool = hyperdrivePool;
        this.cache = cache;
        this.poolSecretKey = poolSecretKey;
    }

    async start() {
        return new Promise((resolve, reject) => {
            const server = new GRPC.Server({
                interceptors: [],
            });

            server.addService(
                ...Auth.adaptService(
                    this.poolSecretKey,
                    GPRCBackend.adaptService(
                        PoolConnector,
                        new RpcConnector(this.nostrConnector, this.hyperdrivePool, this.cache)
                    )
                )
            );

            if (Fs.existsSync(this.descriptorPath)) {
                const descriptorSetBuffer = Fs.readFileSync(this.descriptorPath);
                const pkg = loadFileDescriptorSetFromBuffer(descriptorSetBuffer);
                const reflection = new ReflectionService(pkg);
                reflection.addToServer(server);
            }
            const useSecure = this.caCrt || this.serverCrt || this.serverKey;
            if(useSecure){
                console.log("Using secure connection");
            }
            server.bindAsync(
                `${this.addr}:${this.port}`,
                useSecure
                    ? GRPC.ServerCredentials.createSsl(
                          this.caCrt || null,
                          [
                              {
                                  private_key: this.serverKey || null,
                                  cert_chain: this.serverCrt || null,
                              },
                          ],
                          false
                      )
                    : GRPC.ServerCredentials.createInsecure(),
                (err: Error | null, port: number) => {
                    if (err) {
                        reject(err);
                        console.log(`Server error: ${err.message}`);
                    } else {
                        resolve(true);
                        console.log(`Server bound on port: ${port}`);
                    }
                }
            );
        });
    }
}

