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
    RpcCacheSetResponse,
    RpcDiscoverActionsRequest,
    RpcDiscoverActionsResponse,
    RpcDiscoverNearbyActionsRequest,
    RpcDiscoverNearbyActionsResponse,
    RpcDiscoverNearbyNodesRequest,
    RpcDiscoverNearbyNodesResponse,
    RpcDiscoverNodesRequest,
    RpcDiscoverNodesResponse,
    RpcDiscoverPoolsRequest,
    RpcDiscoverPoolsResponse,
    Job,
    RpcJobRequest,
    RpcPayJobRequest,
} from "openagents-grpc-proto";
import NostrConnector from "./NostrConnector";

import Fs from 'fs';
import HyperdrivePool, { SharedDrive } from "./HyperdrivePool";
import {DriverOut} from "./HyperdrivePool";
import Cache, { CacheDisk } from "./Cache";
import Logger from "./Logger";
import { kinds } from "nostr-tools";
import NWCAdapter from "./NWCAdapter";

class RpcConnector implements IPoolConnector {
    private logger = Logger.get(this.constructor.name);
    private conn: NostrConnector;
    private hyp: HyperdrivePool;
    private cache: Cache;
    constructor(conn, hyp, cache) {
        this.conn = conn;
        this.hyp = hyp;
        this.cache = cache;

        // instrument every method to print stack trace
        for (const key of Object.getOwnPropertyNames(Object.getPrototypeOf(this))) {
            const fn = this[key];
            if (typeof fn === "function") {
                this[key] = async (...args) => {
                    try {
                        return await fn.apply(this, args);
                    } catch (e) {
                        this.logger.error(e);
                        throw e;
                    }
                };
            }
        }
    }

    async sendJobRequest(request: RpcJobRequest, context: ServerCallContext): Promise<Job> {
        try {
            const nodeId = await this.getNodeId(context);
            return this.conn.sendJobRequest(nodeId, request.event, request.provider, request.encrypted);
        } catch (e) {
            this.logger.error(e);
            throw e;
        }
    }

    async discoverPools(
        request: RpcDiscoverPoolsRequest,
        context: ServerCallContext
    ): Promise<RpcDiscoverPoolsResponse> {
        const pools = await this.conn.getDiscoveredPools();
        return {
            pools: pools.map((p) => {
                return JSON.stringify(p);
            }),
        };
    }

    getKindsRange(ranges: string[]): Array<{ min: number; max: number }> | undefined {
        if (!ranges) return undefined;
        const kindRanges: Array<{ min: number; max: number }> = [];
        for (const r of ranges) {
            const [min, max] = r.split("-");
            const minN = parseInt(min);
            const maxN = parseInt(max);
            if (minN > maxN) {
                throw new Error("Invalid kind range");
            }
            kindRanges.push({ min: minN, max: maxN });
        }
        return kindRanges.length > 0 ? kindRanges : undefined;
    }

    async discoverNodes(
        request: RpcDiscoverNodesRequest,
        context: ServerCallContext
    ): Promise<RpcDiscoverNodesResponse> {
        const nodes = await this.conn.getDiscoveredNodes({
            kinds: request.filterByKinds,
            nodes: request.filterByNodes,
            pools: request.filterByPools,
            kindRanges: this.getKindsRange(request.filterByKindRanges),
        });
        return {
            nodes: nodes.map((n) => {
                return JSON.stringify(n);
            }),
        };
    }

    async discoverActions(
        request: RpcDiscoverActionsRequest,
        context: ServerCallContext
    ): Promise<RpcDiscoverActionsResponse> {
        const actions = await this.conn.getDiscoveredActions({
            kinds: request.filterByKinds,
            nodes: request.filterByNodes,
            tags: request.filterByTags,
            pools: request.filterByPools,
            kindRanges: this.getKindsRange(request.filterByKindRanges),
        });
        return {
            actions: actions.map((a) => {
                return JSON.stringify(a);
            }),
        };
    }

    async discoverNearbyNodes(
        request: RpcDiscoverNearbyNodesRequest,
        context: ServerCallContext
    ): Promise<RpcDiscoverNearbyNodesResponse> {
        const nodes = await this.conn.getNearbyDiscoveredNodes({
            kinds: request.filterByKinds,
            nodes: request.filterByNodes,
            kindRanges: this.getKindsRange(request.filterByKindRanges),
        });
        return {
            nodes: nodes.map((n) => {
                return JSON.stringify(n);
            }),
        };
    }

    async discoverNearbyActions(
        request: RpcDiscoverNearbyActionsRequest,
        context: ServerCallContext
    ): Promise<RpcDiscoverNearbyActionsResponse> {
        const actions = await this.conn.getNearbyDiscoveredActions({
            kinds: request.filterByKinds,
            nodes: request.filterByNodes,
            tags: request.filterByTags,
            kindRanges: this.getKindsRange(request.filterByKindRanges),
        });
        const out = {
            actions: actions.map((a) => {
                return JSON.stringify(a);
            }),
        };
        return out;
    }

    async createDisk(
        request: RpcCreateDiskRequest,
        context: ServerCallContext
    ): Promise<RpcCreateDiskResponse> {
        try {
            const nodeId = await this.getNodeId(context);
            const url = await this.hyp.create(
                nodeId,
                request.encryptionKey,
                request.includeEncryptionKeyInUrl
            );
            return {
                url,
            };
        } catch (e) {
            this.logger.error(e);
            throw e;
        }
    }
    async openDisk(request: RpcOpenDiskRequest, context: ServerCallContext): Promise<RpcOpenDiskResponse> {
        try {
            const nodeId = await this.getNodeId(context);
            const [disk, version] = await this.hyp.open(nodeId, request.url);
            return {
                success: true,
                diskId: disk,
                version: version,
            };
        } catch (e) {
            this.logger.error(e);
            throw e;
        }
    }

    async closeDisk(request: RpcCloseDiskRequest, context: ServerCallContext): Promise<RpcCloseDiskResponse> {
        try {
            const nodeId = await this.getNodeId(context);
            await this.hyp.commit(request.diskId);
            return {
                success: true,
            };
        } catch (e) {
            this.logger.error(e);
            throw e;
        }
    }

    async diskDeleteFile(
        request: RpcDiskDeleteFileRequest,
        context: ServerCallContext
    ): Promise<RpcDiskDeleteFileResponse> {
        try {
            const nodeId = await this.getNodeId(context);
            const disk = await this.hyp.get(nodeId, request.diskId);
            await disk.del(request.path);
            return {
                success: true,
            };
        } catch (e) {
            this.logger.error(e);
            throw e;
        }
    }

    async diskListFiles(
        request: RpcDiskListFilesRequest,
        context: ServerCallContext
    ): Promise<RpcDiskListFilesResponse> {
        try {
            const nodeId = await this.getNodeId(context);
            const disk = await this.hyp.get(nodeId, request.diskId);
            const files = await disk.list(request.path);
            return {
                files,
            };
        } catch (e) {
            this.logger.error(e);
            throw e;
        }
    }

    async diskReadFile(
        request: RpcDiskReadFileRequest,
        responses: RpcInputStream<RpcDiskReadFileResponse>,
        context: ServerCallContext
    ): Promise<void> {
        try {
            const nodeId = await this.getNodeId(context);
            const disk = await this.hyp.get(nodeId, request.diskId);
            const readStream = await disk.inputStream(request.path);
            for await (const chunk of readStream) {
                responses.send({ data: chunk, exists: true });
            }
            await responses.complete();
        } catch (e) {
            this.logger.error(e);
            throw e;
        }
    }

    async diskWriteFile(
        requests: RpcOutputStream<RpcDiskWriteFileRequest>,
        context: ServerCallContext
    ): Promise<RpcDiskWriteFileResponse> {
        try {
            const nodeId = await this.getNodeId(context);

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
                    this.logger.error(e);
                    throw e;
                }
            }
            if (outputStream) await outputStream.flushAndWait();
            return {
                success: true,
            };
        } catch (e) {
            this.logger.error(e);
            throw e;
        }
    }

    async cacheSet(
        requests: RpcOutputStream<RpcCacheSetRequest>,
        context: ServerCallContext
    ): Promise<RpcCacheSetResponse> {
        try {
            const nodeId = await this.getNodeId(context);
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
                    this.logger.error(e);
                    throw e;
                }
            }
            if (outputStream) await outputStream.flushAndWait();
            return {
                success: true,
            };
        } catch (e) {
            this.logger.error(e);
            throw e;
        }
    }

    async cacheGet(
        request: RpcCacheGetRequest,
        responses: RpcInputStream<RpcCacheGetResponse>,
        context: ServerCallContext
    ): Promise<void> {
        try {
            const nodeId = await this.getNodeId(context);
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
            this.logger.error(e);
            throw e;
        }
    }

    async diskWriteSmallFile(
        request: RpcDiskWriteFileRequest,
        context: ServerCallContext
    ): Promise<RpcDiskWriteFileResponse> {
        try {
            const nodeId = await this.getNodeId(context);
            const disk = await this.hyp.get(nodeId, request.diskId);
            await disk.put(request.path, request.data);
            return {
                success: true,
            };
        } catch (e) {
            this.logger.error(e);
            throw e;
        }
    }

    async diskReadSmallFile(
        request: RpcDiskReadFileRequest,
        context: ServerCallContext
    ): Promise<RpcDiskReadFileResponse> {
        try {
            const nodeId = await this.getNodeId(context);
            const disk = await this.hyp.get(nodeId, request.diskId);
            const data = await disk.get(request.path);
            return {
                data,
                exists: true,
            };
        } catch (e) {
            this.logger.error(e);
            throw e;
        }
    }

    async getNWCData(context: ServerCallContext): Promise<
        | {
              pubkey: string;
              relay: string;
              secret: string;
          }
        | undefined
    > {
        const nwc = (await context.headers["nwc-data"]) as string;
        if (!nwc) return undefined;
        const nwcData = JSON.parse(nwc);
        return {
            pubkey: nwcData.pubkey,
            relay: nwcData.relay,
            secret: nwcData.secret,
        };
    }

    async getNodeId(context: ServerCallContext): Promise<string> {
        return (await context.headers["nodeid"]) as string;
    }

    async getCache(context: ServerCallContext): Promise<CacheDisk> {
        const cacheId = context.headers["cacheid"] as string;
        return this.cache.get(cacheId);
    }

    async getJob(request: RpcGetJob, context: ServerCallContext): Promise<Job> {
        try {
            const nodeId = await this.getNodeId(context);
            const id = request.jobId;
            let job = undefined;
            const nResults = request.nResultsToWait || 1;
            if (request.wait) {
                job = await Utils.busyWaitForSomething(
                    async () => {
                        try {
                            job = await this.conn.getJob(nodeId, id);
                            let results = 0;
                            let errors = 0;
                            for (const state of job.results) {
                                if (state.status == JobStatus.SUCCESS && state.result.timestamp) {
                                    results++;
                                } else if (state.status == JobStatus.ERROR) {
                                    errors++;
                                }
                            }

                            const isDone = results >= nResults;
                            if (isDone) return job;
                        } catch (e) {}
                        return undefined;
                    },
                    () => {
                        return job; // return last fetched job
                    },
                    request.wait
                );
            }
            if (!job) job = await this.conn.getJob(nodeId, id);
            return job;
        } catch (e) {
            this.logger.error(e);
            throw e;
        }
    }

    async getPendingJobs(request: RpcGetPendingJobs, context: ServerCallContext): Promise<PendingJobs> {
        try {
            const nodeId = await this.getNodeId(context);
            const jobIdFilter: RegExp = new RegExp(request.filterById || ".*");
            const customerFilter: RegExp = new RegExp(request.filterByCustomer || ".*");
            const runOnFilter: RegExp = new RegExp(request.filterByRunOn || ".*");
            const descriptionFilter: RegExp = new RegExp(request.filterByDescription || ".*");
            const kindFilter: RegExp = new RegExp(request.filterByKind || ".*");
            const excludeIds: string[] = request.excludeId || [];

            const findJobs = async () => {
                return await this.conn.findJobs(
                    nodeId,
                    jobIdFilter,
                    runOnFilter,
                    descriptionFilter,
                    customerFilter,
                    kindFilter,
                    true,
                    excludeIds
                );
            };

            let jobs = [];
            if (request.wait) {
                jobs = await Utils.busyWaitForSomething(
                    async () => {
                        const j = await findJobs();
                        if (j.length > 0) return j;
                    },
                    () => {
                        return [];
                    },
                    request.wait
                );
            } else [(jobs = await findJobs())];

            const pendingJobs: PendingJobs = {
                jobs,
            };
            return pendingJobs;
        } catch (e) {
            this.logger.error(e);
            throw e;
        }
    }

    async isJobDone(request: RpcGetJob, context: ServerCallContext): Promise<RpcIsJobDone> {
        try {
            const nodeId = await this.getNodeId(context);
            let isDone = false;
            if (request.wait) {
                isDone = await Utils.busyWaitForSomething(
                    async () => {
                        try {
                            const job = await this.getJob(request, context);
                            const isDone =
                                job && job.state.status == JobStatus.SUCCESS && job.result.timestamp;
                            if (isDone) return true;
                        } catch (e) {}
                        return undefined;
                    },
                    () => {
                        return false;
                    },
                    request.wait
                );
            } else {
                const job = await this.getJob(request, context);
                isDone = job && job.state.status == JobStatus.SUCCESS && job.result.timestamp > 0;
            }
            return {
                isDone,
            };
        } catch (e) {
            this.logger.error(e);
            throw e;
        }
    }

    async acceptJob(request: RpcAcceptJob, context: ServerCallContext): Promise<Job> {
        try {
            const nodeId = await this.getNodeId(context);
            return this.conn.acceptJob(nodeId, request.jobId);
        } catch (e) {
            this.logger.error(e);
            throw e;
        }
    }

    async cancelJob(request: RpcCancelJob, context: ServerCallContext): Promise<Job> {
        try {
            const nodeId = await this.getNodeId(context);
            return this.conn.cancelJob(nodeId, request.jobId, request.reason);
        } catch (e) {
            this.logger.error(e);
            throw e;
        }
    }

    async outputForJob(request: RpcJobOutput, context: ServerCallContext): Promise<Job> {
        try {
            const nodeId = await this.getNodeId(context);
            return this.conn.outputForJob(nodeId, request.jobId, request.output);
        } catch (e) {
            this.logger.error(e);
            throw e;
        }
    }

    async payJob(request: RpcPayJobRequest, context: ServerCallContext): Promise<Job> {
        try {
            const nodeId = await this.getNodeId(context);
            const nwc = await this.getNWCData(context);
            return await this.conn.payJob(
                nodeId,
                nwc,
                request.jobId,
                request.amount,
                request.currency,
                request.protocol
            );
        } catch (e) {
            this.logger.error(e);
            throw e;
        }
    }

    async completeJob(request: RpcJobComplete, context: ServerCallContext): Promise<Job> {
        try {
            const nodeId = await this.getNodeId(context);
            const nwc = await this.getNWCData(context);
            return this.conn.completeJob(nodeId, nwc, request.jobId, request.output);
        } catch (e) {
            this.logger.error(e);
            throw e;
        }
    }

    async logForJob(request: RpcJobLog, context: ServerCallContext): Promise<Job> {
        try {
            const nodeId = await this.getNodeId(context);
            return this.conn.logForJob(nodeId, request.jobId, request.log);
        } catch (e) {
            this.logger.error(e);
            throw e;
        }
    }

    async requestJob(request: RpcRequestJob, context: ServerCallContext): Promise<Job> {
        try {
            const nodeId = await this.getNodeId(context);
            return this.conn.requestJob(
                nodeId,
                request.runOn,
                request.expireAfter,
                request.input,
                request.param,
                request.description,
                request.kind,
                request.outputFormat,
                request.requestProvider,
                request.encrypted,
                request.userId,
                request.minWorkers
            );
        } catch (e) {
            this.logger.error(e);
            throw e;
        }
    }

    async sendSignedEvent(
        request: RpcSendSignedEventRequest,
        context: ServerCallContext
    ): Promise<RpcSendSignedEventResponse> {
        try {
            const nodeId = await this.getNodeId(context);
            await this.conn.sendSignedEvent(request.event);
            return {
                groupId: request.groupId,
                success: true,
            } as RpcSendSignedEventResponse;
        } catch (e) {
            this.logger.error(e);
            throw e;
        }
    }

    async subscribeToEvents(
        request: RpcSubscribeToEventsRequest,
        context: ServerCallContext
    ): Promise<RpcSubscribeToEventsResponse> {
        try {
            const nodeId = await this.getNodeId(context);
            const subId = await this.conn.openCustomSubscription(request.groupId, request.filters);
            return {
                groupId: request.groupId,
                subscriptionId: subId,
            };
        } catch (e) {
            this.logger.error(e);
            throw e;
        }
    }

    async getEvents(request: RpcGetEventsRequest, context: ServerCallContext): Promise<RpcGetEventsResponse> {
        try {
            const nodeId = await this.getNodeId(context);
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
            this.logger.error(e);
            throw e;
        }
    }

    async unsubscribeFromEvents(
        request: RpcUnsubscribeFromEventsRequest,
        context: ServerCallContext
    ): Promise<RpcUnsubscribeFromEventsResponse> {
        try {
            const nodeId = await this.getNodeId(context);
            await this.conn.closeCustomSubscription(request.groupId, request.subscriptionId);
            return {
                success: true,
            };
        } catch (e) {
            this.logger.error(e);
            throw e;
        }
    }

    async announceNode(
        request: RpcAnnounceNodeRequest,
        context: ServerCallContext
    ): Promise<RpcAnnounceNodeResponse> {
        try {
            const nodeId = await this.getNodeId(context);

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
            this.logger.error(e);
            throw e;
        }
    }

    async announceEventTemplate(
        request: RpcAnnounceTemplateRequest,
        context: ServerCallContext
    ): Promise<RpcAnnounceTemplateResponse> {
        try {
            const nodeId = await this.getNodeId(context);
            const node = this.conn.getNode(nodeId);
            if (!node) throw new Error("Node not found");
            const timeout = node.registerTemplate(request.meta, request.template, request.sockets);
            return {
                success: true,
                refreshInterval: timeout,
            };
        } catch (e) {
            this.logger.error(e);
            throw e;
        }
    }
}


export default class RPCServer {
    private logger = Logger.get(this.constructor.name);
    private addr: string;
    private port: number;
    private descriptorPath: string;
    private nostrConnector: NostrConnector;
    private caCrt: Buffer | undefined;
    private serverCrt: Buffer | undefined;
    private serverKey: Buffer | undefined;
    private hyperdrivePool: HyperdrivePool;
    private poolSecretKey: string;
    private cache: Cache;
    private auth: Auth;
    private poolPublicKey: string;
    private nwc: NWCAdapter;

    constructor(
        poolPublicKey: string,
        poolSecretKey: string,
        addr: string,
        port: number,
        descriptorPath: string,
        nostrConnector: NostrConnector,
        hyperdrivePool: HyperdrivePool,
        auth: Auth,
        cache: Cache,
        caCrt?: Buffer,
        serverCrt?: Buffer,
        serverKey?: Buffer,
        nwc?: NWCAdapter
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
        this.poolPublicKey = poolPublicKey;
        this.auth = auth;
        this.nwc = nwc;
    }

    async start() {
        return new Promise((resolve, reject) => {
            const server = new GRPC.Server({
                interceptors: [],
                // 20 MB
                "grpc.max_send_message_length": 20 * 1024 * 1024,
                "grpc.max_receive_message_length": 20 * 1024 * 1024,
                // "grpc.max_concurrent_streams": -1,
            });

            let service = GPRCBackend.adaptService(
                PoolConnector,
                new RpcConnector(this.nostrConnector, this.hyperdrivePool, this.cache)
            );
            
            if (this.auth) {
                service = this.auth.adaptNodeService(this.poolPublicKey, service);
            }

            if(this.nwc){
                service = this.nwc.adaptNodeService(this.poolPublicKey, service);
            }

            server.addService(...service);

            if (Fs.existsSync(this.descriptorPath)) {
                const descriptorSetBuffer = Fs.readFileSync(this.descriptorPath);
                const pkg = loadFileDescriptorSetFromBuffer(descriptorSetBuffer);
                const reflection = new ReflectionService(pkg);
                reflection.addToServer(server);
            }
            const useSecure = this.caCrt || this.serverCrt || this.serverKey;
            if (useSecure) {
                this.logger.log("Using secure connection");
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
                        this.logger.error(`Server error: ${err.message}`);
                    } else {
                        resolve(true);
                        this.logger.log(`Server bound on port: ${port}`);
                    }
                }
            );
        });
    }
}

