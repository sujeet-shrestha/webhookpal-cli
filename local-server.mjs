import http from "node:http";

http
  .createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      console.log("\n--- Webhook received ---");
      console.log(req.method, req.url);
      for (const [k, v] of Object.entries(req.headers)) {
        if (k.startsWith("webhookpal-")) console.log(k + ":", v);
      }
      console.log("body:", body);
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
    });
  })
  .listen(3000, () => console.log("listening on http://localhost:3000"));