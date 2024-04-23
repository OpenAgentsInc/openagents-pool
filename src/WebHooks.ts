
import Fs from "fs";

export default class WebHooks {
    hooks: string[];
    constructor(hooks: string[]) {
        this.hooks = hooks.filter((hook) => hook )
    }

    async call(obj: any) {
        const res = await Promise.allSettled(
            this.hooks.map((hook) => {
                if(hook.startsWith("file")){
                    console.info("Fake hook called\n", JSON.stringify(obj, null, 2));
                    if(hook.includes("://")){
                        const file = hook.split("://")[1];
                        if(file){
                            // create if not exists
                            if (!Fs.existsSync(file)) {
                                Fs.writeFileSync(file, "");
                            }
                            Fs.appendFileSync(file,"\n\nNew event:"+Date.now()+"\n\n"+ JSON.stringify(obj, null, 2) + "\n");
                        }
                    }
                }else{
                    return fetch(hook, {
                        method: "POST",
                        headers: {
                            "Content-Type": "application/json",
                        },
                        body: JSON.stringify(obj),
                    });
                }
            })
        );
        for (let i = 0; i < this.hooks.length; i++) {
            if (res[i].status === "rejected") {
                console.error(`Error in hook ${this.hooks[i]}: ${res[i]}`);
            }
        }
        return res;
    }
}