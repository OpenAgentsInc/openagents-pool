import goodbye from "graceful-goodbye";
import util from "util"; 
enum LogLevel {
    finest = "finest",
    finer = "finer",
    fine = "fine",
    debug = "debug",
    info = "info",
    warn = "warn",
    error = "error"
}

type OpenObserveOptions = {
    stream: string;
    org: string;
    baseUrl: string;
    batchSize: number;
    auth?:
        | {
              username: string;
              password: string;
          }
        | string;
    flushInterval?: number;
    meta?: {
        [key: string]: any;
    };
    level?: string;
};

class OpenObserveLogger {
    private opts: OpenObserveOptions;
    private buffer: any[] = [];
    private flusherLoop: any;
    private closed: boolean = false;

    constructor(opts: OpenObserveOptions) {
        this.opts = opts;
        this.flushLoop();
        goodbye(async () => {
            await this.close();
        });
    }

    async close() {
        this.closed = true;
        if(this.flusherLoop)clearTimeout(this.flusherLoop);
        const buffer = this.buffer;
        this.buffer = [];
        await this.flush(buffer);
    }

    private async flushLoop() {
        if (this.closed) return;
        const buffer = this.buffer;
        this.buffer = [];
        await this.flush(buffer);
        this.flusherLoop=setTimeout(() => this.flushLoop(), this.opts.flushInterval || 5000);
    }

    async log(level:string, message:string, timestamp:number) {
        const kv = typeof message == "object" ? JSON.parse(JSON.stringify(message)) : {};
        const meta = this.opts.meta ? this.opts.meta : {};
        const logEntry = {
            _timestamp: timestamp,
            level: level,
            log: typeof message === "string" ? message : kv.log ? kv.log : JSON.stringify(message),
            ...kv,
            ...meta,
        };
        this.buffer.push(logEntry);
        if (this.buffer.length >= this.opts.batchSize) {
            const buffer = this.buffer;
            this.buffer = [];
            this.flush(buffer);
        }
    }

  

    async flush(buffer: any[]) {
        if (buffer.length == 0) return;

        let basicAuth = this.opts.auth;
        if (typeof basicAuth == "object" && basicAuth.username && basicAuth.password) {
            basicAuth = Buffer.from(`${basicAuth.username}:${basicAuth.password}`).toString("base64");
        }
        if (typeof basicAuth != "string") basicAuth = undefined;

        const url = `${this.opts.baseUrl}/api/${this.opts.org}/${this.opts.stream}/_json`;
        return fetch(url, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: basicAuth ? `Basic ${basicAuth}` : undefined,
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
    name: string;
    version: string;
    runnerLogger: (log: string) => void;
    logLevel: number;
    oobsLogLevel: number;
    oobsLogger: OpenObserveLogger;
    jobId?: string;

    constructor(
        name: string,
        version: string,
        jobId?: string,
        runnerLogger?: (log: string) => void,
        level?: string,
        enableOobs: boolean = true
    ) {
        this.name = name || "main";
        this.runnerLogger = runnerLogger;
        this.version = version;
        const logLevelName = process.env.LOG_LEVEL || (process.env.PRODUCTION ? "info" : "finer");
        this.logLevel = this.levelToValue(logLevelName);
        this.oobsLogLevel = this.levelToValue(process.env.OPENOBSERVE_LOGLEVEL || "info");
        this.jobId = jobId;

        if (level && this.levelToValue(level) > this.logLevel) {
            this.logLevel = this.levelToValue(level);
        }

        if (level && this.levelToValue(level) > this.oobsLogLevel) {
            this.oobsLogLevel = this.levelToValue(level);
        }

        const oobsEndPoint = process.env.OPENOBSERVE_ENDPOINT;
        if (enableOobs && oobsEndPoint) {
            this.oobsLogger = new OpenObserveLogger({
                baseUrl: oobsEndPoint,
                org: process.env.OPENOBSERVE_ORG || "default",
                stream: process.env.OPENOBSERVE_STREAM || "default",
                auth: process.env.OPENOBSERVE_BASICAUTH || {
                    username: process.env.OPENOBSERVE_USERNAME,
                    password: process.env.OPENOBSERVE_PASSWORD,
                },
                batchSize: parseInt(process.env.OPENOBSERVE_BATCHSIZE || "21"),
                flushInterval: parseInt(process.env.OPENOBSERVE_FLUSHINTERVAL || "0"),
                meta: {
                    appName: this.name,
                    appVersion: this.version,
                    jobId: jobId
                },
            });
        }
    }

    levelToValue(level: string) {
        return LogLevel[level] ? LogLevel[level] : LogLevel.debug;
    }

    log(level:string, ...args) {
        let message = "";
        for (const arg of args) {
            if (typeof arg == "object") {
                message += util.inspect(arg) + "\n";
            } else {
                message += arg+" ";
            }
        }
        message = message.trim();
        const levelV = this.levelToValue(level);
        const minLevel = this.logLevel;
        const minObsLevel = this.oobsLogLevel;
        const minNostrLevel = this.levelToValue("info");
        if (levelV >= minLevel) {
            const date = new Date().toISOString();
            console.log(`${date} [${this.name}:${this.version}] `+(this.jobId?`(${this.jobId})`:"")+`: ${level} : ${message}`);
        }
        if (this.oobsLogger && levelV >= minObsLevel) {
            this.oobsLogger.log(level, message, Date.now());
        }
        if (this.runnerLogger && levelV >= minNostrLevel) {
            this.runnerLogger(message);
        }
    }

    info(...args) {
        this.log("info", ...args);
    }

    warn(...args) {
        this.log("warn", ...args);
    }

    error(...args) {
        this.log("error", ...args);
        console.error(args,new Error().stack);
    }

    debug(...args) {
        this.log("debug", ...args);
    }

    fine(...args) {
        this.log("fine", ...args);
    }

    finer(...args) {
        this.log("finer", ...args);
    }

    finest(...args) {
        this.log("finest", ...args);
    }

    async close():Promise<void> {
        if (this.oobsLogger) {
            await this.oobsLogger.close();
        }
    }



    private static defaultName: string = "main";
    private static defaultVersion: string = "0.0.0";
    private static defaultLevel: string = "info";
    private static defaultEnableOobs: boolean = true;
    private static loggers: { [key: string]: Logger } = {};
    static init(
        name: string,
        version: string,
        level?: string,
        enableOobs: boolean = true
    ): void {
        Logger.defaultName = name;
        Logger.defaultVersion = version;
        Logger.defaultLevel = level || "info";
        Logger.defaultEnableOobs = enableOobs;
    }


    static get(name?:string): Logger {
        name = name || Logger.defaultName;
        if (!Logger.loggers[name]) {
            Logger.loggers[name] = new Logger(
                name,
                Logger.defaultVersion,
                undefined,
                undefined,
                Logger.defaultLevel,
                Logger.defaultEnableOobs
            );
        }
        return Logger.loggers[name];
    }
}