import { Event } from "nostr-tools";

import { Job as _Job, JobInput, Log, JobState, JobStatus, JobResult, JobParam } from "openagents-grpc-proto";

import Utils from "./Utils";
import {
    SimplePool,
    EventTemplate,
    Filter,
    VerifiedEvent,
    UnsignedEvent,
    finalizeEvent,
    getPublicKey,
} from "nostr-tools";

import Logger from "./Logger";

/**
 * A convenient abstraction over job events and handling
 *
 */
export default class Job implements _Job {
    logger = Logger.get(this.constructor.name);
    id: string = "";
    kind: number = 5003;
    runOn: string = "";
    expiration: number = 0;
    timestamp: number = 0;
    input: JobInput[] = [];
    param: JobParam[] = [];
    customerPublicKey: string = "";
    description: string = "";
    provider: string = "";
    relays: string[] = [];
    result: JobResult = {
        id: "",
        content: "",
        timestamp: 0,
    };
    state: JobState = {
        logs: [],
        status: JobStatus.PENDING,
        acceptedAt: 0,
        acceptedBy: "",
        timestamp: 0,
    };
    maxEventDuration: number;
    maxExecutionTime: number;
    outputFormat: string = "application/json";
    nodeId: string = "";
    assignedTo: string[] = [];
    encrypted: boolean = false;
    userId: string = "";

    toJSON(){
        return {
            id: this.id,
            kind: this.kind,
            runOn: this.runOn,
            expiration: this.expiration,
            timestamp: this.timestamp,
            input: this.input,
            param: this.param,
            customerPublicKey: this.customerPublicKey,
            description: this.description,
            provider: this.provider,
            relays: this.relays,
            result: this.result,
            state: this.state,
            maxEventDuration: this.maxEventDuration,
            maxExecutionTime: this.maxExecutionTime,
            outputFormat: this.outputFormat,
            nodeId: this.nodeId,
            assignedTo: this.assignedTo,
            encrypted: this.encrypted,
            userId: this.userId
        }
    }
    constructor(
        maxEventDuration: number,
        runOn: string,
        description: string,
        input: JobInput[] | undefined,
        param: JobParam[] | undefined,
        maxExecutionTime: number,
        relays?: string[],
        kind?: number,
        outputFormat?: string,
        nodeId?: string,
        provider?: string,
        encrypted: boolean = false,
        userId?: string
    ) {
        this.timestamp = Date.now();
        this.maxEventDuration = maxEventDuration;
        this.expiration = this.timestamp + maxEventDuration;
        this.maxExecutionTime = maxExecutionTime;
        this.nodeId = nodeId || "";
        if (this.maxExecutionTime <= 5000) throw new Error("Invalid max execution time");
        if (this.maxEventDuration <= 5000) throw new Error("Invalid max event duration");

        if (outputFormat) {
            this.outputFormat = outputFormat;
        }

        if (kind) {
            this.kind = kind;
        }

        if (relays) {
            this.relays.push(...relays);
        }
        if (runOn) {
            this.runOn = runOn;
        }
        if (description) {
            this.description = description;
        }
        if (input) {
            this.input.push(...input);
        }
        if (param) {
            this.param.push(...param);
        }
        if (provider) {
            this.provider = provider;
            this.encrypted = !!encrypted;
        } else {
            if (encrypted) {
                throw new Error("Provider is required for encrypted jobs");
            }
        }
        if(userId){
            this.userId = userId;
        }
    }

    merge(event: Event, defaultRelays: Array<string>) {
        if (event.kind >= 5000 && event.kind <= 5999) {
            // request
            const id = event.id;

            const provider: string = Utils.getTagVars(event, ["p"])[0][0];
            if (this.provider && provider && provider != this.provider) {
                this.logger.error("Invalid provider");
                return;
            }

            const kind: number = event.kind;
            const runOn: string = Utils.getTagVars(event, ["param", "run-on"])[0][0] || "generic";
            const customerPublicKey: string = event.pubkey;
            const timestamp: number = Number(event.created_at) * 1000;
            const expiration: number = Math.max(
                Math.min(
                    Number(Utils.getTagVars(event, ["expiration"])[0][0] || "0") * 1000 ||
                        timestamp + this.maxEventDuration,
                    timestamp + this.maxEventDuration
                ),
                timestamp + 60000
            );
            const nodeId = Utils.getTagVars(event, ["d"])[0][0] || "";
            const encrypted = Utils.getTagVars(event, ["encrypted"])[0][0] == "true";

            const relays: Array<string> = Utils.getTagVars(event, ["relays"])[0] || defaultRelays;
            const expectedOutputFormat: string =
                Utils.getTagVars(event, ["output"])[0][0] || "application/json";
            // const bid = Utils.getTagVars(event, ["bid"], 1)[0];
            // const t = Utils.getTagVars(event, ["t"], 1)[0];
            const description: string =
                Utils.getTagVars(event, ["about"])[0][0] ||
                Utils.getTagVars(event, ["param", "description"])[0][0] ||
                "";

            const params: string[][] = Utils.getTagVars(event, ["param"]);
            for (const p of params) {
                this.param.push({
                    key: p[0],
                    value: p.slice(1),
                });
            }

            const rawInputs = Utils.getTagVars(event, ["i"]);

            // collect relays
            for (const rawInput of rawInputs) {
                if (rawInput[2]) {
                    relays.push(rawInput[2]);
                }
            }

            const mainInput = rawInputs.find((i) => i[3] == "main") || rawInputs[0];
            if (!mainInput) throw new Error("No main input");

            const secondaryInputs = rawInputs.filter((i) => i != mainInput);

            const inputs: JobInput[] = [];
            for (const input of [mainInput, ...secondaryInputs]) {
                const type = input[1] || "text"; // text/plain?
                const data = input[0];
                const marker = input[3] || "";
                inputs.push({
                    data,
                    type,
                    marker,
                });
            }

            let userId=Utils.getTagVars(event,["userid"])[0][0]||"";


            if (!this.id) this.id = id;
            this.provider = provider;
            this.nodeId = nodeId;
            this.id = id;
            this.runOn = runOn;
            this.expiration = expiration;
            this.timestamp = timestamp;
            this.customerPublicKey = customerPublicKey;
            this.description = description;
            this.encrypted = encrypted;
            this.userId=userId;
            this.relays = [];
            this.outputFormat = expectedOutputFormat;
            // this.results = {};
            // this.states = {};
            this.input = inputs;
            this.kind = kind;
            for (const r of relays) {
                if (!this.relays.includes(r)) {
                    this.relays.push(r);
                }
            }
        } else if (event.kind == 7000 || (event.kind >= 6000 && event.kind <= 6999)) {
            const e: Array<string> = Utils.getTagVars(event, ["e"])[0];
            const jobId: string = e[0];
            if (!jobId) throw new Error("No job id");
            if (!this.id) this.id = jobId;
            else if (this.id != jobId) {
                throw new Error("Invalid id " + jobId + " != " + this.id);
            }

            const provider: string = event.pubkey;
            if (this.provider && provider != this.provider) {
                this.logger.error("Invalid provider");
                return;
            }
            const content: string = event.content;
            const customerPublicKey: string = Utils.getTagVars(event, ["p"])[0][0];
            if (!this.customerPublicKey) this.customerPublicKey = customerPublicKey;
            else if (customerPublicKey != this.customerPublicKey) {
                throw new Error("Invalid customer");
            }

            const relayHint: string | undefined = e[1];
            if (relayHint) {
                if (!this.relays.includes(relayHint)) {
                    this.relays.push(relayHint);
                }
            }

            const timestamp = Number(event.created_at) * 1000;
            const nodeId = Utils.getTagVars(event, ["d"])[0][0] || "";
            if (event.kind == 7000) {
                // TODO: content?
                let [status, info] = Utils.getTagVars(event, ["status"])[0];
                const state = this.state;

                if (!info && status == "log") info = content;

                if (info) {
                    const log: Log = {
                        nodeId,
                        id: event.id,
                        timestamp,
                        log: info,
                        level: status == "error" ? "error" : "info",
                        source: provider,
                    };

                    const logs = state.logs;
                    if (!logs.find((l) => l.id == log.id)) {
                        let added = false;
                        for (let i = 0; i < logs.length; i++) {
                            if (logs[i].timestamp > timestamp) {
                                logs.splice(i, 0, log);
                                added = true;
                                break;
                            }
                        }
                        if (!added) logs.push(log);
                    }
                }

                if (state.status != JobStatus.SUCCESS) {
                    if (status == "success") {
                        state.status = JobStatus.SUCCESS;
                    } else if (status == "processing") {
                        state.acceptedAt = timestamp;
                        state.acceptedBy = provider;
                        state.status = JobStatus.PROCESSING;
                    } else if (status == "error") {
                        state.acceptedAt = 0;
                        state.acceptedBy = "";
                        state.status = JobStatus.ERROR;
                    }
                    state.timestamp = timestamp;
                }
            } else {
                // result
                // if (content=="") return;
                if (!this.result.timestamp) {
                    const result = this.result;

                    if (result.timestamp < timestamp) {
                        result.content = content;
                        result.timestamp = timestamp;
                        result.id = event.id;
                    }
                }
            }
        }
    }

    isAvailable() {
        if (this.state.status == JobStatus.SUCCESS) return false;
        if (this.isExpired()) return false;
        if (
            this.state.status == JobStatus.PROCESSING &&
            this.state.acceptedAt &&
            Date.now() - this.state.acceptedAt < this.maxExecutionTime
        ) {
            return false;
        }
        return true;
    }

    isExpired() {
        return this.expiration < Date.now();
    }

    async accept(nodeId: string, acceptedBy: string): Promise<Array<EventTemplate>> {
        const t = Date.now();
        const state = this.state;
        state.acceptedAt = t;
        state.acceptedBy = acceptedBy;
        state.status = JobStatus.PROCESSING;

        const customerPublicKey = this.customerPublicKey;
        let feedbackEvent: EventTemplate = {
            kind: 7000,
            content: "",
            created_at: Math.floor(t / 1000),
            tags: [
                ["status", "processing"],
                ["e", this.id],
                ["p", customerPublicKey],
                ["d", nodeId],
                ["userid",this.userId],
                ["expiration", "" + Math.floor(this.expiration / 1000)],
                this.encrypted ? ["encrypted", "true"] : undefined,
            ].filter((t) => t),
        };

        return [feedbackEvent];
    }

    async cancel(nodeId: string, cancelledBy: string, reason: string): Promise<Array<EventTemplate>> {
        const state = this.state;
        state.acceptedAt = 0;
        state.acceptedBy = "";
        state.status = JobStatus.ERROR;

        const customerPublicKey = this.customerPublicKey;
        const feedbackEvent: EventTemplate = {
            kind: 7000,
            content: reason,
            created_at: Math.floor(Date.now() / 1000),
            tags: [
                ["status", "error", reason],
                ["e", this.id],
                ["p", customerPublicKey],
                ["d", nodeId],
                ["userid", this.userId],
                ["expiration", "" + Math.floor(this.expiration / 1000)],
                this.encrypted ? ["encrypted", "true"] : undefined,
            ].filter((t) => t),
        };

        return [feedbackEvent];
    }

    async output(nodeId: string, outputBy: string, data: string): Promise<Array<EventTemplate>> {
        // const t = Date.now();
        const resultEvent: EventTemplate = {
            kind: 6003,
            content: data,
            created_at: Math.floor(Date.now() / 1000),
            tags: [
                ["e", this.id],
                ["p", this.customerPublicKey],
                ["expiration", "" + Math.floor(this.expiration / 1000)],
                ["d", nodeId],
                ["userid", this.userId],
                this.encrypted ? ["encrypted", "true"] : undefined,
            ].filter((t) => t),
        };
        // this.result.content = data;
        // this.result.timestamp = t;
        // const events: Array<EventTemplate> = [];
        // events.push(resultEvent);
        // this.result.id = events[0].id;
        return [resultEvent];
    }

    async complete(nodeId: string, pk: string, result: any, info?: string): Promise<Array<EventTemplate>> {
        const events: Array<EventTemplate> = [];
        events.push(...(await this.output(nodeId, pk, result)));
        const feedbackEvent: EventTemplate = {
            kind: 7000,
            content: info || "",
            created_at: Math.floor(Date.now() / 1000),
            tags: [
                ["status", "success"],
                ["e", this.id],
                ["p", this.customerPublicKey],
                ["expiration", "" + Math.floor(this.expiration / 1000)],
                ["d", nodeId],
                ["userid", this.userId],
                this.encrypted ? ["encrypted", "true"] : undefined,
            ].filter((t) => t),
        };
        events.push(feedbackEvent);
        // this.state.status = JobStatus.SUCCESS;
        // this.state.timestamp = Date.now();
        return events;
    }

    async log(nodeId: string, pk: string, log: string): Promise<Array<EventTemplate>> {
        const t = Date.now();
        const state = this.state;
        const feedbackEvent: EventTemplate = {
            kind: 7000,
            content: log,
            created_at: Math.floor(t / 1000),
            tags: [
                ["status", "log", log],
                ["e", this.id],
                ["p", this.customerPublicKey],
                ["expiration", "" + Math.floor(this.expiration / 1000)],
                ["d", nodeId],
                ["userid", this.userId],
                this.encrypted ? ["encrypted", "true"] : undefined,
            ].filter((t) => t),
        };

        return [feedbackEvent];
    }

    async resolveInputs(resolver: (ref: string, type: string) => Promise<string | undefined>): Promise<void> {
        for (const input of this.input) {
            if (!input.data && input.ref) {
                const data = await resolver(input.ref, input.type);
                if (data) {
                    input.data = data;
                }
            }
        }
    }

    areInputsAvailable() {
        for (const input of this.input) {
            if (!input.data && input.ref) {
                return false;
            }
        }
        return true;
    }

    async toRequest(): Promise<Array<EventTemplate>> {
        const t = Date.now();
        const inputs: string[][] = [];
        for (const iinput of this.input) {
            const input: string[] = ["i"];
            input.push((iinput.ref || iinput.data)!);
            input.push(iinput.type);
            input.push(iinput.source || "");
            input.push(iinput.marker);
            inputs.push(input);
        }
        const params: string[][] = [];
        for (const p of this.param) {
            const param: string[] = ["param", p.key];
            param.push(...p.value);
            params.push(param);
        }
        const eventRequest: EventTemplate = {
            kind: this.kind,
            content: "",
            created_at: Math.floor(this.timestamp / 1000),
            tags: [
                ...inputs,
                ...params,
                this.provider ? ["p", this.provider] : undefined,
                ["expiration", "" + Math.floor(this.expiration / 1000)],
                this.relays ? ["relays", ...this.relays] : undefined,
                ["param", "run-on", this.runOn],
                ["about", this.description],
                ["output", this.outputFormat],
                ["userid", this.userId],
                ["d", this.nodeId],
                this.encrypted ? ["encrypted", "true"] : undefined,
            ].filter((t) => t),
        };
        // this.id = eventRequest.id;
        return [eventRequest];
    }
}
