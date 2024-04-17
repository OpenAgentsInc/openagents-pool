


export default class WebHooks {
    hooks: string[];
    constructor(hooks: string[]) {
        this.hooks = hooks;
    }

    async call(obj: any) {
        const res = await Promise.allSettled(
            this.hooks.map((hook) => {
                return fetch(hook, {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                    },
                    body: JSON.stringify(obj),
                });
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