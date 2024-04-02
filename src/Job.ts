import { Event } from "nostr-tools";
import { Job as _Job, JobInput, Log, JobState, Status, JobResult, JobParam } from "./proto/Protocol";
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

/**
 * A convenient abstraction over job events and handling
 * 
 */
export default class Job implements _Job {
    id: string = "";
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
        status: Status.PENDING,
        acceptedAt: 0,
        acceptedBy: "",
        timestamp: 0,
    };
    expiryAfter: number;
    maxExecutionTime: number;

    constructor(
        expiryAfter: number,
        runOn: string,
        description: string,
        input: JobInput[] | undefined,
        param: JobParam[] | undefined,
        maxExecutionTime: number,
        relays?: string[]
    ) {
        this.timestamp = Date.now();
        this.expiryAfter = expiryAfter;
        this.expiration = this.timestamp + expiryAfter;
        this.maxExecutionTime = maxExecutionTime;

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
        if(param){
            this.param.push(...param);
        }
    }

    merge(
        event: Event,
        defaultRelays: Array<string>,
        filterProvider: ((provider: string) => boolean) | undefined
    ) {
        if (event.kind == 5003) {
            // request
            const id = event.id;
            const provider: string = Utils.getTagVars(event, ["p"])[0][0];
            if (filterProvider && !filterProvider(provider)) {
                return;
            }
            const runOn: string = Utils.getTagVars(event, ["param", "run-on"])[0][0];
            const customerPublicKey: string = event.pubkey;
            const timestamp: number = Number(event.created_at) * 1000;
            const expiration: number = Math.max(
                Number(Utils.getTagVars(event, ["expiration"])[0][0] || "0") * 1000 ||
                    timestamp + this.expiryAfter,
                timestamp + this.expiryAfter
            );

            const relays: Array<string> = Utils.getTagVars(event, ["relays"])[0] || defaultRelays;
            // const bid = Utils.getTagVars(event, ["bid"], 1)[0];
            // const t = Utils.getTagVars(event, ["t"], 1)[0];
            const description: string = Utils.getTagVars(event, ["param", "description"])[0][0];

            const params: string[][] = Utils.getTagVars(event, ["param"]);
            for(const p of params){
                this.param.push({
                    key:p[0],
                    value:p.slice(1)
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
                const type = input[1] || "text";
                const data =  input[0] ;
                const marker = input[3] || "";
                inputs.push({
                    data,
                    type,
                    marker,
                });
            }

            this.id = id;
            this.runOn = runOn;
            this.expiration = expiration;
            this.timestamp = timestamp;
            this.customerPublicKey = customerPublicKey;
            this.description = description;
            this.provider = provider;
            this.relays = [];
            // this.results = {};
            // this.states = {};
            this.input = inputs;

            for (const r of relays) {
                if (!this.relays.includes(r)) {
                    this.relays.push(r);
                }
            }
        } else {
            const e: Array<string> = Utils.getTagVars(event, ["e"])[0];
            const jobId: string = e[0];
            if (!this.id) this.id = jobId;
            else if (this.id != jobId) {
                throw new Error("Invalid id " + jobId + " != " + this.id);
            }

            const provider: string = event.pubkey;
            if (filterProvider && !filterProvider(provider)) {
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

            if (event.kind == 7000) {
                // TODO: content?
                let [status, info] = Utils.getTagVars(event, ["status"])[0];
                const state = this.state;

                if (!info && status == "log") info = content;

                if (info) {
                    const log: Log = {
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
                            }
                        }
                        if (!added) logs.push(log);
                    }
                }

                if (state.timestamp < timestamp) {
                    if (status == "success") {
                        state.status = Status.SUCCESS;
                    } else if (status == "processing") {
                        state.acceptedAt = timestamp;
                        state.acceptedBy = provider;
                        state.status = Status.PROCESSING;
                    } else if (status == "error") {
                        state.acceptedAt = 0;
                        state.acceptedBy = "";
                        state.status = Status.ERROR;
                    }
                    state.timestamp = timestamp;
                }
            } else {
                // result
                const result = this.result;

                if (result.timestamp < timestamp) {
                    result.content = content;
                    result.timestamp = timestamp;
                    result.id = event.id;
                }
            }
        }
    }

    isAvailable() {
        if (this.state.status == Status.SUCCESS) return false;
        if (this.isExpired()) return false;
        if (
            this.state.status == Status.PROCESSING &&
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

    async accept(pk: string, sk: Uint8Array): Promise<Array<VerifiedEvent>> {
        const t = Date.now();
        const state = this.state;
        state.acceptedAt = t;
        state.acceptedBy = pk;
        state.status = Status.PROCESSING;

        const customerPublicKey = this.customerPublicKey;
        const feedbackEvent: EventTemplate = {
            kind: 7000,
            content: "",
            created_at: Math.floor(t / 1000),
            tags: [
                ["status", "processing"],
                ["e", this.id],
                ["p", customerPublicKey],
                ["expiration", "" + Math.floor(this.expiration / 1000)],
            ],
        };
        const events: Array<VerifiedEvent> = [];
        events.push(finalizeEvent(feedbackEvent, sk));
        return events;
    }

    async cancel(pk: string, sk: Uint8Array, reason: string): Promise<Array<VerifiedEvent>> {
        const state = this.state;
        state.acceptedAt = 0;
        state.acceptedBy = "";
        state.status = Status.ERROR;

        const customerPublicKey = this.customerPublicKey;
        const feedbackEvent: EventTemplate = {
            kind: 7000,
            content: reason,
            created_at: Math.floor(Date.now() / 1000),
            tags: [
                ["status", "error"],
                ["e", this.id],
                ["p", customerPublicKey],
                ["expiration", "" + Math.floor(this.expiration / 1000)],
            ],
        };
        const events: Array<VerifiedEvent> = [];
        events.push(finalizeEvent(feedbackEvent, sk));

        state.logs.push({
            id: events[0].id,
            timestamp: Date.now(),
            log: reason,
            level: "error",
            source: pk,
        });

        return events;
    }

    async output(pk: string, sk: Uint8Array, data: string): Promise<Array<VerifiedEvent>> {
        const t = Date.now();
        const resultEvent: EventTemplate = {
            kind: 6003,
            content: data,
            created_at: Math.floor(Date.now() / 1000),
            tags: [
                ["e", this.id],
                ["p", this.customerPublicKey],
                ["expiration", "" + Math.floor(this.expiration / 1000)],
            ],
        };
        this.result.content = data;
        this.result.timestamp = t;
        const events: Array<VerifiedEvent> = [];
        events.push(finalizeEvent(resultEvent, sk));
        this.result.id = events[0].id;
        return events;
    }

    async complete(pk: string, sk: Uint8Array, result: any, info?: string): Promise<Array<VerifiedEvent>> {
        const events: Array<VerifiedEvent> = [];
        events.push(...(await this.output(pk, sk, result)));
        const feedbackEvent: EventTemplate = {
            kind: 7000,
            content: info || "",
            created_at: Math.floor(Date.now() / 1000),
            tags: [
                ["status", "success"],
                ["e", this.id],
                ["p", this.customerPublicKey],
                ["expiration", "" + Math.floor(this.expiration / 1000)],
            ],
        };
        events.push(finalizeEvent(feedbackEvent, sk));
        this.state.status = Status.SUCCESS;
        this.state.timestamp = Date.now();
        return events;
    }

    async log(pk: string, sk: Uint8Array, log: string): Promise<Array<VerifiedEvent>> {
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
            ],
        };
        const events: Array<VerifiedEvent> = [];
        events.push(finalizeEvent(feedbackEvent, sk));
        state.logs.push({
            id: events[0].id,
            timestamp: t,
            log: log,
            level: "log",
            source: pk,
        });
        return events;
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

    async toRequest(customerSecretKey: Uint8Array): Promise<Array<VerifiedEvent>> {
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
        const eventRequest: EventTemplate = {
            kind: 5003,
            content: "",
            created_at: Math.floor(this.timestamp / 1000),
            tags: [
                ...inputs,
                // TODO provider whitelist
                // this.provider?[("p", this.provider)]:undefined,
                ["expiration", "" + Math.floor(this.expiration / 1000)],
                this.relays ? ["relays", ...this.relays] : undefined,
                ["param", "run-on", this.runOn],
                ["param", "description", this.description],
                ["output", "application/json"],
            ],
        };

        const events = [finalizeEvent(eventRequest, customerSecretKey)];
        this.id = events[0].id;

        return events;
    }
}