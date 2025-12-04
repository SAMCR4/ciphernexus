
(async function () {
    const PUBLIC_KEY_PEM = `-----BEGIN PUBLIC KEY-----
MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAno5xN/IKt2RAxUqmv75Q
jNMcSLgQEUe2F4mDP17namp4Qg62dAf5JvabzwwM3Y4yknb2wDM0sqnhOgmQafBP
locXXFySMlLynrruyEVp+VnkorYkWdpvi9UbOsCj25L0oftow5pcLk+TEQL/dsbm
bKFzy51SQ+0Ql27CQun3H7j1AIuTKESb4sTGo2jmOB7VCB1VWZTyka1k0TXWx7NB
GV32DNruWT8pG9teWAild7FNhLn47+1mwjB2jCdDNjaw8YnKjaVZxBSkuKVyLS1v
w5PWvqkPTOdMU3zguBL/QAkkxMLH4ilW4nmOxJu14Z0kgW/aplZoS0icfS+pbOBJ
/QIDAQAB
-----END PUBLIC KEY-----`;

    async function importPublicKey(pem) {
        const b64 = pem.replace(/-----BEGIN PUBLIC KEY-----/, "").replace(/-----END PUBLIC KEY-----/, "").replace(/\s+/g, "");
        const raw = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)).buffer;
        return crypto.subtle.importKey("spki", raw, { name: "RSA-PSS", hash: "SHA-256" }, false, ["verify"]);
    }
    async function verifySignature(publicKey, data, signatureB64) {
        const sigBytes = Uint8Array.from(atob(signatureB64), c => c.charCodeAt(0));
        return crypto.subtle.verify({ name: "RSA-PSS", saltLength: 32 }, publicKey, sigBytes, data);
    }
    try {
        const [bundleResp, sigResp] = await Promise.all([fetch("/dist/bundle.min.js"), fetch("/dist/bundle.sha256.sig")]);
        const bundleText = await bundleResp.text();
        const sigText = (await sigResp.text()).trim();
        const enc = new TextEncoder();
        const bundleBytes = enc.encode(bundleText);
        const pubKey = await importPublicKey(PUBLIC_KEY_PEM);
        const ok = await verifySignature(pubKey, bundleBytes, sigText);
        if (!ok) { alert("❌ Security Error: Bundle signature invalid. App stopped."); console.error("Signature verification failed"); return; }
        const blob = new Blob([bundleText], { type: "text/javascript" });
        const url = URL.createObjectURL(blob);
        await import(url);
        URL.revokeObjectURL(url);
    } catch (err) {
        alert("Critical loader error – cannot load application.");
        console.error(err);
    }
})();
