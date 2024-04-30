
import winston, { error, info } from "winston";
import Transport from "winston-transport";
import goodbye from "graceful-goodbye";

type OpenObserveOptions= {
    stream: string;
    org: string;
    baseUrl: string;
    batchSize: number;
    auth?: {
        username: string;
        password: string;
    } | string;
    flushInterval?: number;    
    meta?: {
        [key: string]: any;
    },
    level?: string;
};

class OpenObserveTransport extends Transport {
    private opts: OpenObserveOptions;
    private buffer: any[] = [];

    constructor(opts: OpenObserveOptions) {
        super();
        this.opts = opts;
        this.format = winston.format.combine(winston.format.timestamp(), winston.format.json());
        this.level=this.opts.level||"debug";
     
        this.flushLoop();
    }

    async close(){
        const buffer=this.buffer;
        this.buffer = [];
        await this.flush(buffer);
    }

    private async flushLoop(){
        const buffer=this.buffer;
        this.buffer = [];
        await this.flush(buffer);        
        setTimeout(()=>this.flushLoop(), this.opts.flushInterval||5000);
    }

    log(info: any, callback: any) {
        const message=info.message;
        const kv=typeof message == "object" ? JSON.parse(JSON.stringify(message)) : {};
        const meta=this.opts.meta?this.opts.meta:{};
        const logEntry = {
            _timestamp: info.timestamp,
            level: info.level,
            log: typeof message === "string" ? message : kv.log? kv.log: JSON.stringify(message),
            ...kv,
            ...meta
        };
        this.buffer.push(logEntry);
        if(this.buffer.length>=this.opts.batchSize){
            const buffer=this.buffer;
            this.buffer = [];
            this.flush(buffer);            
        }
        callback();
    }

    async flush(buffer: any[]){
        if(!buffer)buffer=this.buffer;
        if(buffer.length==0)return;
        
        let basicAuth = this.opts.auth;
        if(typeof basicAuth=="object"&&basicAuth.username&&basicAuth.password){
            basicAuth = Buffer.from(`${basicAuth.username}:${basicAuth.password}`).toString("base64");
        }
        if(typeof basicAuth!="string")basicAuth=undefined;

        const url=`${this.opts.baseUrl}/api/${this.opts.org}/${this.opts.stream}/_json`;
        return fetch(url, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": basicAuth ? `Basic ${basicAuth}`: undefined
            },
            body: JSON.stringify(buffer),
        }).then((response) => {
            if (!response.ok) {
                console.error("Error sending logs", response);
            }
            return response;
        });
    }

}
export default class Logger {
    static logger: any;

    static  async init(appName: string, appVersion: string, 
        logLevel:string="debug",
        oobs_endpoint: string | undefined, 
        oobs_org: string|undefined, 
        oobs_stream:string|undefined,
        oobs_auth: string|{username:string, password:string}|undefined,
        oobs_batch_size:number|undefined,
        oobs_flush_interval:number|undefined,
        obs_log_level?:string
    ) {
        if (Logger.logger) return;
        goodbye(async () => {
            await Logger.close();
        });

        const cnvLogLevel=(lv)=>{
            if(lv=="error")return "error";
            if(lv=="warn")return "warn";
            if(lv=="info")return "info";
            if(lv == "verbose") return "verbose";
            if(lv=="debug")return "debug";
            if(lv=="fine")return "debug";
            else return "silly";
        }
        const transports = [];
        if (oobs_endpoint){
            if(!oobs_org)oobs_org="default";
            if(!oobs_stream)oobs_stream = "default";
            if(!oobs_batch_size) oobs_batch_size = 21;
            const transport = new OpenObserveTransport({
                baseUrl: oobs_endpoint,
                org: oobs_org,
                stream: oobs_stream,
                batchSize: oobs_batch_size,
                auth: oobs_auth,
                flushInterval: oobs_flush_interval,
                level: obs_log_level?cnvLogLevel(obs_log_level):cnvLogLevel(logLevel),
                meta: {
                    appName,
                    appVersion,
                }
            });
            transports.push(transport);
        }

        // console transport
        const transport = new winston.transports.Console({
            level: cnvLogLevel(logLevel),
            format: winston.format.combine(
                winston.format.prettyPrint(),
                winston.format.timestamp(),
                winston.format.colorize(),
                winston.format.printf(({ level, message, module, timestamp }) => {
                    const appInfo = `${appName}:${appVersion}`;
                    return `${timestamp} [${appInfo}] [${module || "main"}] ${level}: ${message}`;
                })
            ),
        });
        transports.push(transport);


        Logger.logger = winston.createLogger({
            transports
        });
        
    }

    static async close(){
        for(const transport of Logger.logger.transports){
            if (transport.close) {
                await transport.close();
            }
        }
        
    }

    static get(namespace?: string): any {
        
        return {
            l(level: string, ...args: any[]) {
                let logString="";
                for(const arg of args){
                    
                    if(arg instanceof Error){
                        logString+=arg.toString();
                        logString+=arg.stack+"\n"+arg.message;
                    } else if(typeof arg=="object"){
                        logString+=JSON.stringify(arg, null, 2);
                    } else{
                        logString+=arg.toString();
                    }
                    logString+=" ";
                }
                if(!Logger.logger){
                    if(level=="error"){
                        console.error(logString);
                    }else if(level=="warn"){
                        console.warn(logString);
                    }else if(level=="info"){
                        console.info(logString);
                    }else{
                        console.log(logString);
                    }
                }else{
                    let logger;
                    if (namespace) {
                        logger = Logger.logger.child({ module: namespace });
                    }else{
                        logger = Logger.logger;
                    }
                    logger.log(level, logString);
                }
            },
            fatal(...args: any[]) {
                this.l("error", ...args);
            },
            error(...args: any[]) {
                this.l("error", ...args);
            },
            warn(...args: any[]) {
                this.l("warn", ...args);
            },
            info(...args: any[]) {
                this.l("info", ...args);
            },
            log(...args: any[]) {
                this.l("verbose", ...args);
            },
            debug(...args: any[]) {
                this.l("debug", ...args);
            },
            fine(...args: any[]) {
                this.l("debug", ...args);
            },
            finer(...args: any[]) {
                this.l("silly", ...args);
            },
            finest(...args: any[]) {
                this.l("silly", ...args);
            },
        };
        
    }
}
