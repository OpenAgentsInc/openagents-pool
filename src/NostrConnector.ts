import {
    SimplePool,
    EventTemplate,
    Filter,
    Event,
    SubCloser,
    UnsignedEvent,
    finalizeEvent,
    getPublicKey,
    VerifiedEvent,
    useWebSocketImplementation,
    verifiedSymbol,
} from "nostr-tools";
import Utils from './Utils';
import Job  from "./Job";

import {  hexToBytes } from '@noble/hashes/utils' ;
import { JobInput, JobParam } from "./proto/Protocol";
import Ws from "ws";
useWebSocketImplementation(Ws);
type CustomSubscription = {
    filters: Filter[];
    subscriptionId: string;
    subCloser: SubCloser;   
    parentJobId: string;
    events: Event[];
}

export default class NostrConnector {
    relays: Array<string>;
    pool: SimplePool;
    jobs: Array<Job>;
    sk: Uint8Array;
    pk: string;
    customSubscriptions: Map<string,Array<CustomSubscription>>;

    maxEventDuration: number;
    maxJobExecutionTime: number;
    since: number;
    filterProvider: ((provider: string) => boolean) | undefined;

    // TODO: support other kinds
    constructor(
        secretKey: string,
        relays: Array<string>,
        filterProvider: ((provider: string) => boolean) | undefined,
        maxEventDuration: number = 1000 * 60 * 60,
        maxJobExecutionTime: number = 1000 * 60 * 10,
        
    ) {
        this.jobs=[];
        this.customSubscriptions = new Map();
        
        this.sk = hexToBytes(secretKey);
        this.pk = getPublicKey(this.sk);
        this.relays = relays;
        this.pool = new SimplePool();
        this.maxEventDuration = maxEventDuration;
        this.maxJobExecutionTime = maxJobExecutionTime;
        this.filterProvider = filterProvider;
        this.since=(Date.now() - maxEventDuration);
        this._loop();
        this.pool.subscribeMany(
            this.relays,
            [
                {
                    kinds: [5003, 6003, 7000],
                    since: Math.floor(this.since / 1000),
                },
            ],
            {
                onevent: (event) => {
                    try {
                        console.log("Received event",event);
                        switch (event.kind) {
                            case 5003: {
                                this.getJob(event.id, true).then((job) => {
                                    if (!job) return;
                                    job.merge(event, this.relays,  this.filterProvider);
                                    this.addExtraRelays(job.relays);
                                });
                                break;
                            }
                            case 6003:
                            case 7000: {
                                const e: string = Utils.getTagVars(event, ["e"])[0][0];
                                if (!e) throw new Error("Event missing e tag");
                                this.getJob(e, true).then((job) => {
                                    if (!job) return;
                                    job.merge(event, this.relays,  this.filterProvider);
                                    this.addExtraRelays(job.relays);
                                });
                                break;
                            }
                        }
                    } catch (e) {
                        console.error("Error processing event" + JSON.stringify(event) + "\n" + e);
                    }
                },
            }
        );

    }

    async openCustomSubscription(   
        parentJob: string,
        filters: string[]
    ): Promise<string>{
        const parsedFilters: Filter[] = filters.map((filter) => {
            return JSON.parse(filter) as Filter;
        });

        const subId = Utils.newUUID();
        const process = async (sub: SubCloser, event: Event | undefined) => {
            let customSubs: CustomSubscription[] | undefined = this.customSubscriptions.get(parentJob);
            if (!customSubs) {
                customSubs = [];
                this.customSubscriptions.set(parentJob, customSubs);
            }
            let customSub: CustomSubscription | undefined = customSubs.find(
                (customSub) => customSub.subscriptionId === subId
            );
            if (!customSub) {
                customSub = {
                    filters:parsedFilters,
                    subscriptionId: subId,
                    subCloser: sub,
                    parentJobId: parentJob,
                    events: []
                };
                customSubs.push(customSub);
            }
            if(event) customSub.events.push(event);
        };

        const sub = this.pool.subscribeMany(this.relays, parsedFilters, {
            onevent: (event) => {
                process(sub, event);
            },
            oneose: () => {
                process(sub, undefined);
            },
        });

        return subId;
    }

    async closeCustomSubscription(parentJob: string, subscriptionId: string){
        let customSubs: CustomSubscription[] | undefined = this.customSubscriptions.get(parentJob);
        if (!customSubs) {
            return;
        }
        const customSub: CustomSubscription | undefined = customSubs.find(
            (customSub) => customSub.subscriptionId === subscriptionId
        );
        if (!customSub) {
            return;
        }
        customSub.subCloser.close();
        customSubs = customSubs.filter((customSub) => customSub.subscriptionId !== subscriptionId);
        this.customSubscriptions.set(parentJob, customSubs);
    }

    async closeAllCustomSubscriptions(parentJob: string){
        let customSubs: CustomSubscription[] | undefined = this.customSubscriptions.get(parentJob);
        if (!customSubs) {
            return;
        }
        for(const customSub of customSubs){
            customSub.subCloser.close();
        }
        customSubs = [];
        this.customSubscriptions.set(parentJob, customSubs);
    }

    async getAndConsumeCustomEvents(parentJob: string, subscriptionId: string, limit:number): Promise<string[]>{
        let customSubs: CustomSubscription[] | undefined = this.customSubscriptions.get(parentJob);
        if (!customSubs) return [];
        const customSub: CustomSubscription | undefined = customSubs.find(
            (customSub) => customSub.subscriptionId === subscriptionId
        );
        if (!customSub) return [];        
        const events: Event[] = customSub.events.splice(0, limit);
        return events.map((event) => JSON.stringify(event));
    }

    async addExtraRelays(relays: string[]) {
        for (const relay of relays) {
            try{
                console.log("Ensure connection to", relay  );
                await this.pool.ensureRelay(relay);
            }catch(e){
                console.error("Error connecting to relay", relay, e);
            }
        }
    }
    async sendSignedEvent(ev: string | Event) {
        return this.sendEvent(ev, false);
    }
    async sendEvent(ev: string | Event, sign: boolean = true) {
        let event: VerifiedEvent;
        if(typeof ev === "string"){
            event = JSON.parse(ev);
        }else {
            if((ev as Event)[verifiedSymbol]){
                event = ev as VerifiedEvent;
            }else{
                if(!sign){
                    throw new Error("Event must be signed");
                }
                event = finalizeEvent(ev, this.sk);
            }
        } 
        console.log("Publishing event\n", event, "\n To", this.relays);
        this.pool.publish(this.relays, event);
    }


    async _loop(){
        await this.evictExpired();
        setTimeout(this._loop.bind(this), 1000);
    }

    async evictExpired(){
        for(let i= 0;i<this.jobs.length;i++){
            const job= this.jobs[i];
            await this.closeAllCustomSubscriptions(job.id);
            if(job.isExpired()){
                this.jobs.splice(i,1);
                i--;
            }
        }
    }

    async _resolveJobInputs(job: Job) {
        await job.resolveInputs(async (res: string,type: string) => {
            switch(type){
                case "event":{
                    const event:Event = (await this.pool.querySync(this.relays, {ids: [res], since: Math.floor(this.since/1000)}))[0]
                    if(event){
                        return JSON.stringify(event);
                    }
                    return undefined;
                }
                case "job":{
                    const job = await this.getJob(res,false);
                    return job.result.content
                }
            }
        });
    }

    async findJobs(
        jobIdFilter: RegExp,
        runOnFilter: RegExp,
        descriptionFilter: RegExp,
        customerFilter: RegExp,
        isAvailable: boolean
    ): Promise<Array<Job>> {
        const jobs: Array<Job> = [];
        for (const job of this.jobs) {
            if (!job.isAvailable() && isAvailable) {
                continue;
            }
            if (
                jobIdFilter.test(job.id) &&
                runOnFilter.test(job.runOn) &&
                descriptionFilter.test(job.description) &&
                customerFilter.test(job.customerPublicKey)
            ) {
                jobs.push(job);
            }
        }
        for(const job of jobs){
            await this._resolveJobInputs(job);
        }
        return jobs.filter((job) => job.areInputsAvailable());
    }

    async getJob(id: string, createIfMissing: boolean = false): Promise<Job | undefined> {
        let job:Job|undefined = this.jobs.find((job) => job.id === id);
        if (!job && createIfMissing) {
            job = new Job( this.maxEventDuration, "", "", [],[], this.maxJobExecutionTime);
            this.jobs.push(job);
        }
        if(job){
            await this._resolveJobInputs(job);
            if(!job.areInputsAvailable()){
                return undefined;
            }
        }
        return job;
    }

    async acceptJob(id: string) {
        const job = await this.getJob(id);
        if (!job) {
            throw new Error("Job not found");
        }
        if (job.isAvailable() ) {
            job.accept(this.pk, this.sk);
        } else {
            throw new Error("Job already assigned");
        }
        await this._resolveJobInputs(job);
        if(!job.areInputsAvailable()){
            throw new Error("Inputs not available");
        }

        return job;
    }

    async cancelJob(id: string, reason: string) {
        const job = await this.getJob(id);
        if (!job) {
            throw new Error("Job not found");
        }
        if (job.isAvailable()) {
            throw new Error("Job not assigned");
        }
        const eventQueue: VerifiedEvent[] = await job.cancel(this.pk, this.sk, reason);
        for (const event of eventQueue) this.sendEvent(event);
        this.closeAllCustomSubscriptions(id);
        
        return job;
    }

    async outputForJob(id: string, output: any) {
        const job = await this.getJob(id);
        if (!job) {
            throw new Error("Job not found");
        }
        if (job.isAvailable()) {
            throw new Error("Job not assigned");
        }
        const eventQueue: VerifiedEvent[] = await job.output(this.pk, this.sk, output);
        for (const event of eventQueue) this.sendEvent(event);
        return job;
    }

    async completeJob(id: string, result: string) {
        const job = await this.getJob(id);
        if (!job) {
            throw new Error("Job not found");
        }
        if (job.isAvailable()) {
            throw new Error("Job not assigned");
        }
        const eventQueue: VerifiedEvent[] = await job.complete(this.pk, this.sk, result);
        for (const event of eventQueue) this.sendEvent(event);
        this.closeAllCustomSubscriptions(id);
        return job;
    }

    async logForJob(id: string, log: string) {
        const job = await this.getJob(id);
        if (!job) {
            throw new Error("Job not found");
        }
        if (job.isAvailable()) {
            throw new Error("Job not assigned");
        }
        const eventQueue: VerifiedEvent[] = await job.log(this.pk, this.sk, log);
        for (const event of eventQueue) this.sendEvent(event);
        return job;
    }

    

    async requestJob(
        runOn: string,
        expiryAfter: number,
        input: Array<JobInput>,
        param: Array<JobParam>,
        description = ""
    ): Promise<Job> {
        let sk: Uint8Array = this.sk;
        const job = new Job(expiryAfter, runOn, description, input,param,  this.maxJobExecutionTime, this.relays);
        const events: Array<VerifiedEvent> = await job.toRequest(sk);
        for (const event of events) this.sendEvent(event);
        return job;
    }
}