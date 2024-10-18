const fs = require("fs");
const childProcess = require("child_process");
const Server = require("./http/Server");

const config = require("./config.json");
const streams = [];

// FFmpeg

// Create streams
for (let index = 0; index < config.streams.length; index++) {
    const stream = {
        ...config.defaultOptions,
        ...config.streams[index],
    }

    if (!stream.fullName) stream.fullName = stream.name ? `${stream.name} (${index})` : index;
    stream.id = index;
    stream.logs = "";
    stream.clients = [];
    stream.active = false;
    stream.log = (...msg) => console.log(`[${stream.fullName}]`, ...msg);
    stream.start = () => {
        stream.processArgs = [
            ...(stream.inputArgs || []),
            "-i", stream.input,
            ...(stream.outputArgs || []),
            "-c:v", "mjpeg",
            "-f", "mjpeg",
            "-"
        ];

        console.log(`Setting up stream '${stream.fullName}' with args '${stream.processArgs.map(i => i.includes(" ") ? `"${i}"` : i).join(" ")}'...`);

        stream.process = childProcess.spawn(config.ffmpegPath, stream.processArgs);

        stream.active = true;

        // FFmpeg data
        let frame;
        stream.process.stdout.on("data", data => {
            if (data[0] === 0xFF && data[1] === 0xD8) {
                frame = data;
            } else {
                frame = Buffer.concat([frame, data]);
            }

            if (data[data.byteLength - 2] === 0xFF && data[data.byteLength - 1] === 0xD9) stream.handleFrame(frame);
        });

        // FFmpeg logs
        stream.process.stderr.on("data", data => {
            const log = data.toString();
            const logs = `${stream.logs}${log}`;
            stream.logs = logs.substring(logs.length - config.ffmpegLogSize);
        });

        // Process error
        stream.process.on("error", err => {
            if (!stream.active) return;
            stream.active = false;
            stream.log(err);
            if (stream.logs) stream.log(stream.logs);
            const respawnOn = stream.respawnOnError;
            const respawnDelay = stream.respawnDelayError ?? stream.respawnDelay;
            if (typeof respawnDelay === "number" && respawnOn) {
                stream.log(`Respawning in ${respawnDelay} seconds...`);
                setTimeout(() => createStream(stream), respawnDelay * 1000);
            }
        });

        // FFmpeg closed
        stream.process.on("close", code => {
            if (!stream.active) return;
            stream.active = false;
            stream.log(`Closed with code ${code}!`);
            if (stream.logs) stream.log(stream.logs);
            const isError = code > 0;
            const respawnOn = isError ? stream.respawnOnError : stream.respawnOnClose;
            const respawnDelay = (isError ? stream.respawnDelayError : stream.respawnDelayClose) ?? stream.respawnDelay;
            if (typeof respawnDelay === "number" && respawnOn) {
                stream.log(`Respawning in ${respawnDelay} seconds...`);
                setTimeout(() => createStream(stream), respawnDelay * 1000);
            }
        });
    }
    stream.stop = () => {
        console.log(`Stopping stream '${stream.fullName}'...`);
        if (stream.active) {
            stream.active = false;
            stream.process.kill("SIGKILL");
        }
    }
    stream.handleFrame = (frame) => {
        stream.lastFrame = frame;

        stream.clients.forEach(client => {
            if (!client) return;
            const [req, res] = client;

            res.writeLarge(`--stream\r\nContent-Type: image/jpeg\r\nContent-Length: ${frame.byteLength}\r\n\r\n`);
            res.writeLarge(frame);
            res.writeLarge("\r\n\r\n");
        });
    }
    if (stream.script) eval(fs.readFileSync(stream.script, "utf-8"));

    if (stream.disabled) continue;

    stream.start();

    streams.push(stream);
}

// Handle clients
function handleClient(client, stream) {
    const [req, res] = client;

    res.setStatus(200);
    res.setHeader("Content-Type", "multipart/x-mixed-replace; boundary=stream");

    const clientIndex = stream.clients.push(client) - 1;

    req.on("close", () => stream.clients[clientIndex] = null); // NOTE: doesn't get fired when using Bun 1.1.24
    req.on("error", () => { });
}

// HTTP

const indexHtml = fs.readFileSync("./index.html", "utf-8");

const server = new Server({ routerOptions: [{ ignoreRoot: ["/api/*", "/stream/*", "/still/*"] }, { root: "/api" }, { root: "/stream" }, { root: "/still" }] });
const [app, api, stream, still] = server.routers;

// App
app.get("/", (req, res) => res.html(indexHtml));
app.any("*", (req, res) => res.sendStatus(404));

// Stream
stream.get("/:id", (req, res, next, params) => {
    const id = parseInt(params.id);
    const stream = streams.find(i => i.id === id);
    if (!stream) return next();
    if (!stream.active) return res.setStatus(404).send("Stream is not active!");

    handleClient([req, res], stream);
});
stream.get("/:name", (req, res, next, params) => {
    const name = params.name;
    const stream = streams.find(i => i.name === name);
    if (!stream) return next();
    if (!stream.active) return res.setStatus(404).send("Stream is not active!");

    handleClient([req, res], stream);
});
stream.any("/*", (req, res) => res.redirect("/"));

// Still
still.get("/:id", (req, res, next, params) => {
    const id = parseInt(params.id);
    const stream = streams.find(i => i.id === id);
    if (!stream) return next();
    if (!stream.active) return res.setStatus(404).send("Stream is not active!");
    if (!stream.lastFrame) return res.setStatus(404).send("No frame");

    res.setStatus(200);
    res.send(stream.lastFrame, "image/jpeg");
});
still.get("/:name", (req, res, next, params) => {
    const name = params.name;
    const stream = streams.find(i => i.name === name);
    if (!stream) return next();
    if (!stream.active) return res.setStatus(404).send("Stream is not active!");
    if (!stream.lastFrame) return res.setStatus(404).send("No frame");

    res.setStatus(200);
    res.send(stream.lastFrame, "image/jpeg");
});
still.any("/*", (req, res) => res.redirect("/"));

// API
api.get("/streams", (req, res) => res.json(streams.map(stream => ({
    id: stream.id,
    name: stream.name,
    active: stream.active,
    fullName: stream.fullName
}))));
api.any("/*", (req, res) => res.setStatus(404).json({ error: "404" }));

server.listen(config.port, () => console.log(`Listening at :${config.port}`));