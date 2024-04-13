async function main() {
    const s=JSON.stringify({
        "test": "%SOMETHING%",
        "test2": "%SOMETHING_NUMBER%",
        a: {
            b: "%SOMETHING_NUMBER%",
            c: "%SOMETHING%",
        }
    }, null, 2);
    console.log(s.replace(/(")(%.+_NUMBER%)(")/gmi, "$2"));

}

main();