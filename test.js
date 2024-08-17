const http = require("http");
const server = http.createServer();

server.on("request", (req, res) => {
    req.on("close", () => console.log("closed")); // doesnt fire with bun...
    res.end("hi");
});

server.listen(5001);