import { EventTemplate as NostrEventTemplate } from 'nostr-tools';

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
    meta: {[key:string]:string|number};
    template: string;   
    sockets: {};
}

export default class Node  {
    id: string;
    iconUrl: string = "";
    name: string = "";
    description: string = "";
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

    registerTemplate(meta: string, template: string, sockets: string) : number{
        const uuid = Utils.uuidFrom(template);
        const existingReg = this.eventRegistration.find((reg) => reg.uuid === uuid);
        if (!existingReg) {
            this.eventRegistration.push({
                uuid,
                eventId: this.eventRegistration.length,
                timestamp: Date.now(),
                meta: JSON.parse(meta),
                template,
                sockets: JSON.parse(sockets)
            });
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
                return false;
            }
            return true;
        });

        // build announcement event
        
        const ks = [];
        for (const ev of this.eventRegistration) {
            if (ev.meta.king&&!ks.find((k) => k[1] === ev.meta.king)) {
                ks.push(["k", ""+ev.meta.kind]);
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
                    tools: this.eventRegistration.map((e) => {
                        try{                            
                            return {
                                template: e.template,
                                sockets: e.sockets,
                                meta: e.meta,
                            };
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