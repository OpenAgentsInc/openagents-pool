import { EventTemplate as NostrEventTemplate } from 'nostr-tools';
import { Node as _Node } from "openagents-grpc-proto";

import {
    SimplePool,
    Filter,
    VerifiedEvent,
    UnsignedEvent,
    finalizeEvent,
    getPublicKey,
} from "nostr-tools";
import Utils from './Utils';


// type OAEventTemplate = {
//     kind: number;
//     created_at?: string; // default
//     tags: [
//         ["param", "run-on", string],
//         ["param", "description", string],
//         ...[["i", string, string?, string?]],
//         ...[["param", string, ...string[]]],
//         ["output", string]?, // optional
//         ["expiration", string]?, // default 
//         ["relays", ...string[]]?, // optional
//         ["bid", string]?, // optional
//         ["t", string]?, // optional
//         ["tos", string]?, // optional
//         ["privacy", string]?, // optional
//         ["author", string]?, // optional
//         ["web", string]?, // optional
//         ["picture", string]?, // optional
//         ["name", string]?, // optional: if unset => use description
//     ];
// };

// type StdEventTemplate = {
//     kind: number;
//     created_at?: string;
//     tags: [
//         ["param", "description", string],
//         ...[["i", string, string?, string?]],
//         ...[["param", string, ...string[]]],
//         ["expiration", string]?, // default
//         ["output", string]?, // optional
//         ["relays", ...string[]]?, // optional
//         ["bid", string]?, // optional
//         ["t", string]?, // optional
//         ["tos", string]?, // optional
//         ["privacy", string]?, // optional
//         ["author", string]?, // optional
//         ["web", string]?, // optional
//         ["picture", string]?, // optional
//         ["name", string]?, // optional: if unset => use description
//     ];
// };

// type EventTemplate = OAEventTemplate | StdEventTemplate;

type EventTemplateRegistration = {
    uuid: string;
    eventId: number;
    timestamp: number;  
    kind: number;
}

export default class Node implements _Node {
    id: string;
    iconUrl: string = "";
    name: string = "";
    description: string = "";
    eventTemplates: string[] = [];
    eventRegistration: EventTemplateRegistration[] = [];
    timestamp: number;
    announcementTimeout: number;
    updateNeeded: boolean = false;
    lastUpdate: number = 0;

    constructor(
        id: string,
        name: string,
        iconUrl: string,
        description: string,
        announcementTimeout: number
    ) {
        this.id = id;
        this.name = name;
        this.iconUrl = iconUrl;
        this.description = description;
        this.timestamp = Date.now();
        this.announcementTimeout = announcementTimeout;
    }

    getId() {
        return this.id;
    }

    isExpired() {
        return Date.now() - this.timestamp > this.announcementTimeout*1.5;
    }

    refresh(name?: string, iconUrl?: string, description?: string): number {
        if (name&&this.name!==name) {
            this.name = name;
            this.updateNeeded = true;
        }
        if (iconUrl&&this.iconUrl !== iconUrl) {
            this.iconUrl = iconUrl;
            this.updateNeeded = true;
        }
        if (description&&this.description !== description) {
            this.description = description;
            this.updateNeeded = true;
        }
        this.timestamp = Date.now();
        return this.announcementTimeout;
    }

    registerTemplate(template: string) : number{
        const uuid = Utils.uuidFrom(template);
        const existingReg = this.eventRegistration.find((reg) => reg.uuid === uuid);
        if (!existingReg) {
            const eventObject: NostrEventTemplate = JSON.parse(template) ;
            const kind = eventObject.kind;
            this.eventRegistration.push({
                uuid,
                eventId: this.eventTemplates.length,
                timestamp: Date.now(),
                kind
            });
            this.eventTemplates.push(template);
            this.updateNeeded = true;
        } else {
            existingReg.timestamp = Date.now();
        }
        return this.announcementTimeout;
    }

    isUpdateNeeded() {
        return this.updateNeeded||Date.now() - this.lastUpdate > this.announcementTimeout*0.5;
    }

    clearUpdateNeeded(){
        this.updateNeeded=false;
        this.lastUpdate=Date.now();
    }


    toEvent(secretKey: Uint8Array) {
        // remove expired templates
        const now = Date.now();
        this.eventRegistration = this.eventRegistration.filter((reg) => {
            if (now - reg.timestamp > this.announcementTimeout) {
                this.eventTemplates[reg.eventId] = null;
                return false;
            }
            return true;
        });
        this.eventTemplates = this.eventTemplates.filter((t) => t !== null);

        // build announcement event
        
        const ks = [];
        for (const ev of this.eventRegistration) {
            if (!ks.find((k) => k[1] === ev.kind)) {
                ks.push(["k", ""+ev.kind]);
            }
        }

        const event: NostrEventTemplate = {
            kind: 31990,
            created_at: Math.floor(Date.now() / 1000),
            content: JSON.stringify(
                {
                    name: this.name,
                    picture: this.iconUrl || "",
                    about: this.description,
                    eventTemplates: this.eventTemplates.map((e) => {
                        try{
                            let ev: any = JSON.parse(e);
                            ev.created_at = "%TIMESTAMP_SECONDS_NUMBER%";
                            ev.tags = ev.tags.filter((t) => t[0] !== "expiration") as any;
                            ev.tags.push(["expiration", "%EXPIRATION_TIMESTAMP_SECONDS%"]);
                            return ev;
                        }catch(e){
                            return undefined;
                        }
                    }).filter((e) => e),
                },
                null, 2
            ),
            tags: [["d", this.id], ...ks],
        };

        const events = [finalizeEvent(event, secretKey)];
        return events;
    }
}