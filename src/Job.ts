import { Event } from "nostr-tools";
import {Invoice as LNInvoice} from "@getalby/lightning-tools"

import { Job as _Job,  JobInput, Log, JobState, JobStatus, JobResult, JobParam, Payment,  PaymentStatus } from "openagents-grpc-proto";

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
    private logger = Logger.get(this.constructor.name);
    public id: string = "";
    public kind: number = 5003;
    public runOn: string = "";
    public expiration: number = 0;
    public timestamp: number = 0;
    public input: JobInput[] = [];
    public param: JobParam[] = [];
    public customerPublicKey: string = "";
    public description: string = "";
    public provider: string = "";
    public relays: string[] = [];
    public results: JobState[] = [];
    private maxEventDuration: number;
    public maxExecutionTime: number;
    public outputFormat: string = "application/json";
    public nodeId: string = "";
    public encrypted: boolean = false;
    public userId: string = "";
    private minWorkers: number;
    public bid?: Payment;

    toJSON() {
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
            // result: this.result,
            // state: this.state,
            maxEventDuration: this.maxEventDuration,
            maxExecutionTime: this.maxExecutionTime,
            outputFormat: this.outputFormat,
            nodeId: this.nodeId,
            encrypted: this.encrypted,
            userId: this.userId,
            results: this.results,
            minWorkers: this.minWorkers,
            bid: this.bid,
        };
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
        userId?: string,
        minWorkers: number = 2
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
        if (userId) {
            this.userId = userId;
        }

        this.bid = {
            amount: 0,
            currency: "bitcoin",
            protocol: "lightning",
        };

        if (minWorkers) this.minWorkers = minWorkers;
    }

    merge(event: Event, defaultRelays: Array<string>) {
        if (event.kind >= 5000 && event.kind <= 5999) {
            // request
            const id = event.id;

            const provider: string = Utils.getTagVars(event, ["p"])[0][0];
            if (this.provider && provider && provider != this.provider) {
                this.logger.error("Invalid provider", provider, this.provider);
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
            const minWorkers = Number(Utils.getTagVars(event, ["min-workers"])[0][0]) || 1;

            const relays: Array<string> = Utils.getTagVars(event, ["relays"])[0] || defaultRelays;
            const expectedOutputFormat: string =
                Utils.getTagVars(event, ["output"])[0][0] || "application/json";

            const bidData = Utils.getTagVars(event, ["bid"])[0] || [];

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

            let userId = Utils.getTagVars(event, ["userid"])[0][0] || "";

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
            this.userId = userId;
            this.relays = [];
            this.outputFormat = expectedOutputFormat;
            if (minWorkers) this.minWorkers = minWorkers;
            // this.results = {};
            // this.states = {};
            this.input = inputs;
            this.kind = kind;
            for (const r of relays) {
                if (!this.relays.includes(r)) {
                    this.relays.push(r);
                }
            }

            // calculate bid for each worker
            const bid = Number(bidData[0] || 0);
            const bidCurrency = bidData[1] || Utils.getTagVars(event, ["t"])[0][0] || "bitcoin";
            const bidProto = bidData[2] || "lightning";
            this.bid = {
                amount: bid / minWorkers,
                currency: bidCurrency,
                protocol: bidProto,
            };
        } else if (event.kind == 7000 || (event.kind >= 6000 && event.kind <= 6999)) {
            const e: Array<string> = Utils.getTagVars(event, ["e"])[0];
            const jobId: string = e[0];
            if (!jobId) throw new Error("No job id");
            // if (!this.id) this.id = jobId;
            // else
            if (this.id != jobId) {
                throw new Error("Invalid id " + jobId + " != " + this.id);
            }

            const provider: string = event.pubkey;
            if (this.provider && provider != this.provider) {
                this.logger.error("Invalid provider", provider, this.provider);
                return;
            }

            const content: string = event.content;
            const customerPublicKey: string = Utils.getTagVars(event, ["p"])[0][0];

            // if (!this.customerPublicKey) this.customerPublicKey = customerPublicKey;
            // else
            if (customerPublicKey != this.customerPublicKey) throw new Error("Invalid customer");

            const relayHint: string | undefined = e[1];
            if (relayHint) {
                if (!this.relays.includes(relayHint)) {
                    this.relays.push(relayHint);
                }
            }

            const timestamp = Number(event.created_at) * 1000;
            const nodeId = Utils.getTagVars(event, ["d"])[0][0] || "";
            let [
                paymentRequestAmountStr,
                paymentRequestInvoice,
                paymentRequestCurrency,
                paymentRequestProtocol,
                ..._
            ] = Utils.getTagVars(event, ["amount"])[0];

            let state = this.results.find((s) => {
                return s.acceptedByNode == nodeId && s.acceptedBy == provider;
            });

            if (!state) {
                state = {
                    logs: [],
                    status: JobStatus.PENDING,
                    acceptedAt: Date.now(),
                    acceptedBy: provider,
                    timestamp: Date.now(),
                    result: { id: "", content: "", timestamp: 0 },
                    acceptedByNode: nodeId,
                    paymentRequests: [],
                };
                this.results.push(state);
            }

            const paymentRequestAmount = Number(paymentRequestAmountStr || "0");

            if (paymentRequestAmount && !state.paymentRequests.find((p) => p.id == paymentRequestInvoice)) {
                const totalRequested = state.paymentRequests.reduce((acc, p) => acc + p.amount, 0);
                if (totalRequested + paymentRequestAmount <= this.bid.amount) {
                    state.paymentRequests.push({
                        id: paymentRequestInvoice,
                        amount: paymentRequestAmount,
                        currency: paymentRequestCurrency,
                        protocol: paymentRequestProtocol,
                        data: paymentRequestInvoice,
                        status: PaymentStatus.PAYMENT_PENDING,
                    });
                } else {
                    this.logger.error(
                        "Payment request exceeds bid amount",
                        totalRequested,
                        paymentRequestAmount,
                        this.bid.amount
                    );
                }
            }

            if (event.kind == 7000) {
                // TODO: content?
                let [status, info] = Utils.getTagVars(event, ["status"])[0];

                if (status == "payment-required"){
                    for(const state of this.results){
                        if(state.acceptedByNode == nodeId && state.acceptedBy == provider){
                            for(const pay of state.paymentRequests){
                                pay.waitForPayment = true;
                            }
                        }
                    }
                }

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
                        state.acceptedByNode = nodeId;
                        state.status = JobStatus.PROCESSING;
                    } else if (status == "error") {
                        // state.acceptedAt = 0;
                        // state.acceptedBy = "";
                        state.status = JobStatus.ERROR;
                    }
                    state.timestamp = timestamp;
                }
            } else {
                // result
                // if (content=="") return;
                if (!state.result.timestamp) {
                    const result = state.result;
                    if (result.timestamp < timestamp) {
                        result.content = content;
                        result.timestamp = timestamp;
                        result.id = event.id;
                    }
                }
            }

            // if (
            //     this.state.status == JobStatus.UNKNOWN ||
            //     (this.state.acceptedByNode == nodeId && this.state.acceptedBy == provider)
            // ) {
            //     this.state = state;
            // }
        } else if (event.kind == 7001) {
            const e: Array<string> = Utils.getTagVars(event, ["e"])[0];
            const jobId: string = e[0];
            if (!jobId) throw new Error("No job id");
            if (this.id != jobId) throw new Error("Invalid id " + jobId + " != " + this.id);

            const provider: string = Utils.getTagVars(event, ["p"])[0][0];
            if (this.provider && provider != this.provider) {
                this.logger.error("Invalid provider", provider, this.provider);
                return;
            }

            if (event.pubkey != this.customerPublicKey) {
                throw new Error("Invalid customer");
            }

            const content: string = event.content;

            const relayHint: string | undefined = e[1];
            if (relayHint) {
                if (!this.relays.includes(relayHint)) {
                    this.relays.push(relayHint);
                }
            }
            // const timestamp = Number(event.created_at) * 1000;
            // const nodeId = Utils.getTagVars(event, ["d"])[0][0] || "";

            let [status, info] = Utils.getTagVars(event, ["status"])[0];
            if (status == "payment") {
                const proofTag = Utils.getTagVars(event, ["proof"])[0];
                if (proofTag) {
                    const [amount, invoice, currency, protocol, preimage] = proofTag;
                    for (const state of this.results) {
                        const paymentRequest = state.paymentRequests.find((p) => p.id == invoice);
                        if (paymentRequest) {
                            if (protocol == "lightning") {
                                const lnInvoice = new LNInvoice({ pr: invoice, preimage });
                                this.logger.finest("Paid invoice", lnInvoice);
                                if (Math.floor(lnInvoice.satoshi * 1000) != Number(amount))
                                    this.logger.error("Invalid payment amount");
                                else if (lnInvoice.isPaid()) {
                                    paymentRequest.status = PaymentStatus.PAYMENT_RECEIVED;
                                    paymentRequest.proof = preimage;
                                    this.logger.fine("Payment received");
                                } else {
                                    this.logger.error("Payment proof is invalid!");
                                }
                            } else {
                                this.logger.error("Unsupported payment protocol");
                            }
                            break;
                        }
                    }
                }
            } else {
                if (!info && status == "log") info = content;

                if (info) {
                    this.logger.info("Customer feedback", info);
                }
            }
        }
    }

    isAvailable(nodeId: string) {
        if (this.isExpired()) return false;

        // if enough successes => not available
        let successes = 0;
        for (const state of this.results) {
            // if success by the same node => not available
            if (state.acceptedByNode == nodeId && state.acceptedBy == this.provider) return false;
            if (state.status == JobStatus.SUCCESS) {
                successes++;
            }
        }
        if (successes >= this.minWorkers) return false;

        // if enough working are processing it => not available
        let processing = 0;
        for (const state of this.results) {
            if (
                state.status == JobStatus.PROCESSING &&
                state.acceptedAt &&
                Date.now() - state.acceptedAt < this.maxExecutionTime
            ) {
                // if processing by the same node => not available
                if (state.acceptedByNode == nodeId && state.acceptedBy == this.provider) return false;
                processing++;
            }
        }
        if (processing >= this.minWorkers) return false;

        // otherwise available
        return true;
    }

    isExpired() {
        return this.expiration < Date.now();
    }

    async accept(nodeId: string): Promise<Array<EventTemplate>> {
        const t = Date.now();

        // add state immediately
        let state = this.results.find((s) => {
            return s.acceptedByNode == nodeId && s.acceptedBy == this.provider;
        });
        if (!state) {
            state = {
                logs: [],
                status: JobStatus.PENDING,
                acceptedAt: Date.now(),
                acceptedBy: this.provider,
                timestamp: Date.now(),
                result: { id: "", content: "", timestamp: 0 },
                acceptedByNode: nodeId,
                paymentRequests: [],
            };
            this.results.push(state);
        } else {
            state.status = JobStatus.PENDING;
            state.acceptedAt = Date.now();
            state.timestamp = Date.now();
        }
        ///

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
                ["userid", this.userId],
                ["expiration", "" + Math.floor(this.expiration / 1000)],
                this.encrypted ? ["encrypted", "true"] : undefined,
            ].filter((t) => t),
        };

        return [feedbackEvent];
    }

    async cancel(nodeId: string, cancelledBy: string, reason: string): Promise<Array<EventTemplate>> {
        // const state = this.state;
        // state.acceptedAt = 0;
        // state.acceptedBy = "";
        // state.status = JobStatus.ERROR;

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
            kind: this.kind + 1000,
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

    async pay(
        nodeId: string,
        amount: number,
        invoice: string,
        currency: string,
        protocol: string,
        payer: (invoice: string, amount: number, currency: string, protocol: string) => Promise<string>
    ): Promise<Array<EventTemplate>> {
        const proof = await payer(invoice, amount, currency, protocol);
        const feedbackEvent: EventTemplate = {
            kind: 7000,
            content: "",
            created_at: Math.floor(Date.now() / 1000),
            tags: [
                ["status", "payment"],
                ["e", this.id],
                this.provider ? ["p", this.provider] : undefined,
                ["expiration", "" + Math.floor(this.expiration / 1000)],
                ["d", nodeId],
                ["userid", this.userId],
                ["proof", "" + amount, invoice, currency, protocol, proof],
                this.encrypted ? ["encrypted", "true"] : undefined,
            ].filter((t) => t),
        };
        return [feedbackEvent];
    }

    async complete(
        nodeId: string,
        pk: string,
        result: any,
        info?: string,
        invoicer?: (amount: number, currency: string, protocol: string) => Promise<string>
    ): Promise<Array<EventTemplate>> {
        const events: Array<EventTemplate> = [];
        events.push(...(await this.output(nodeId, pk, result)));

        const paymentTags = [];
        if (this.bid && invoicer) {
            if (invoicer) {
                let totalPaymentRequested = 0;
                const state = this.results.find((s) => {
                    return s.acceptedByNode == nodeId && s.acceptedBy == pk;
                });
                if (state) {
                    totalPaymentRequested = state.paymentRequests.reduce((acc, p) => acc + p.amount, 0);
                }
                const amountToRequest = this.bid.amount - totalPaymentRequested;
                const invoice = await invoicer(amountToRequest, this.bid.currency, this.bid.protocol);
                paymentTags.push([
                    "amount",
                    "" + amountToRequest,
                    invoice,
                    this.bid.currency,
                    this.bid.protocol,
                ]);
            }
        }

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


        const paymentRequestEvent: EventTemplate = {
            kind: 7000,
            content: info || "",
            created_at: Math.floor(Date.now() / 1000),
            tags: [
                ["status", "request-payment"],
                ["e", this.id],
                ["p", this.customerPublicKey],
                ["expiration", "" + Math.floor(this.expiration / 1000)],
                ["d", nodeId],
                ["userid", this.userId],
                this.encrypted ? ["encrypted", "true"] : undefined,
                ...paymentTags,
            ].filter((t) => t),
        };
        events.push(paymentRequestEvent);

        // request payment
        // if(this.bid){
        // create invoice
        // const nodeNwc;
        // const payment: Payment = {
        //     id: "",
        //     amount: this.bid.amount,
        //     currency: this.bid.currency,
        //     protocol: this.bid.protocol,
        //     data: "invoice",
        //     status: PaymentStatus.PAYMENT_PENDING
        // };

        // }

        // this.state.status = JobStatus.SUCCESS;
        // this.state.timestamp = Date.now();
        return events;
    }

    // getBid(){
    // return this.bid;
    // }
    async requestPayment(
        nodeId: string,
        pk: string,
        payment: Payment,
        invoicer: (amount: number, currency: string, protocol: string) => Promise<string>,
        log: string = "payment request"
    ): Promise<Array<EventTemplate>> {
        const t = Date.now();

        let totalPaymentRequested = 0;
        const state = this.results.find((s) => {
            return s.acceptedByNode == nodeId && s.acceptedBy == pk;
        });
        if (state) {
            totalPaymentRequested = state.paymentRequests.reduce((acc, p) => acc + p.amount, 0);
        }

        const amount = Math.min(this.bid.amount - totalPaymentRequested, payment.amount);
        const currency = payment.currency;
        const protocol = payment.protocol;
        const invoice = await invoicer(amount, currency, protocol);

        const feedbackEvent: EventTemplate = {
            kind: 7000,
            content: log,
            created_at: Math.floor(t / 1000),
            tags: [
                ["status", "payment-required", log],
                ["e", this.id],
                ["p", this.customerPublicKey],
                ["expiration", "" + Math.floor(this.expiration / 1000)],
                ["d", nodeId],
                ["userid", this.userId],
                ["amount", "" + amount, invoice, currency, protocol],
                this.encrypted ? ["encrypted", "true"] : undefined,
            ].filter((t) => t),
        };

        return [feedbackEvent];
    }

    async log(nodeId: string, pk: string, log: string): Promise<Array<EventTemplate>> {
        const t = Date.now();
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
                ["min-workers", "" + this.minWorkers],
                ["d", this.nodeId],
                this.encrypted ? ["encrypted", "true"] : undefined,
                this.bid ? ["bid", "" + this.bid.amount, this.bid.currency, this.bid.protocol] : undefined,
            ].filter((t) => t),
        };
        // this.id = eventRequest.id;
        return [eventRequest];
    }


    isWaitingForPayment(nodeId?: string, pk?: string){
        for(const state of this.results){
            if(nodeId && state.acceptedByNode != nodeId ) continue;
            if(pk && state.acceptedBy != pk ) continue;
            for(const payment of state.paymentRequests){
                if (payment.status != PaymentStatus.PAYMENT_RECEIVED && payment.waitForPayment) return true;
            }
        }
        return false;
    }
}
