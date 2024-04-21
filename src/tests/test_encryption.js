import {
    nip04,

    generateSecretKey,
    getPublicKey,

} from "nostr-tools";

import { hexToBytes, bytesToHex } from '@noble/hashes/utils';


async function main1(){
    const sk = generateSecretKey();
    const pk = getPublicKey(sk);
    const text="Hello World!";

    const sk2= generateSecretKey();
    const pk2 = getPublicKey(sk2);
    const encrypted=await nip04.encrypt(sk, pk2, text);
    const decrypted=await nip04.decrypt(sk2, pk, encrypted);
    console.log("Original text: ", text);
    console.log("Encrypted text: ", encrypted);
    console.log("Decrypted text: ", decrypted);
}


async function main2(){
    console.log("\n\nTest 2")
    const privateKey = generateSecretKey();
    const publicKey = getPublicKey(privateKey);

    const realUrl = "hyperdrive://" + (bytesToHex(generateSecretKey()));
    console.log("Hyperdrive part URL: ", realUrl)

    const encryptedRealUrl = await nip04.encrypt(privateKey, publicKey, realUrl);
    console.log("Encrypted Hyperdrive part URL: ", encryptedRealUrl);

    const discoveryHash = publicKey;
    console.log("Discovery hash: ", discoveryHash);

    const revealingUrl = "hyperdrive+bundle://" + bytesToHex(privateKey);
    console.log("Bundle URL: ", revealingUrl);


    const privateKeyFromRevealingUrl = hexToBytes(revealingUrl.split("hyperdrive+bundle://")[1]);
    console.log("Private key from revealing URL: ", bytesToHex(privateKeyFromRevealingUrl));

    const discoveryHashFromRevealingUrl = getPublicKey(privateKeyFromRevealingUrl);
    console.log("Discovery hash from revealing URL: ", discoveryHashFromRevealingUrl);

       
    const decryptedRealUrl = await nip04.decrypt(privateKeyFromRevealingUrl, discoveryHash, encryptedRealUrl);
    console.log("Hyperdrive part URL: ", decryptedRealUrl);





    
}

async function main() {
    await main1();
    await main2();
}


main();