// Polls the local hardhat node's JSON-RPC endpoint until it responds,
// then exits. Plain Node (no curl/wget) so the alpine image doesn't need
// an extra package just for this one readiness check.
const http = require("http");

function ping(callback) {
  const req = http.request(
    {
      host: "127.0.0.1",
      port: 8545,
      method: "POST",
      path: "/",
      headers: { "Content-Type": "application/json" },
      timeout: 1000,
    },
    (res) => {
      res.on("data", () => {});
      res.on("end", () => callback(true));
    },
  );
  req.on("error", () => callback(false));
  req.on("timeout", () => {
    req.destroy();
    callback(false);
  });
  req.write(JSON.stringify({ jsonrpc: "2.0", method: "eth_chainId", params: [], id: 1 }));
  req.end();
}

function waitLoop() {
  ping((ok) => {
    if (ok) {
      process.exit(0);
    } else {
      setTimeout(waitLoop, 500);
    }
  });
}

waitLoop();
