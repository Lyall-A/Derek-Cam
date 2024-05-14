const childProcess = require("child_process");
const App = require("./utils/HTTP/App");

const config = require("./config.json");

const clients = [];
let running = false;

(function startStream() {
    const ffmpegArgs = [
        "-i",
        ...(config.ffmpegInputArgs?.split(" ") || ""),
        config.path,
        ...(config.ffmpegArgs?.split(" ") || ""),
        "-c:v",
        "mjpeg",
        "-f",
        "mjpeg",
        "-"];
        
    console.log(`Starting FFmpeg instance!`);
    const ffmpegInstance = childProcess.spawn(config.ffmpegPath, ffmpegArgs);

    ffmpegInstance.stderr.on("data", data => {
        running = true;
        console.log("m");
        clients.forEach(client => {
            // client.write(data); // TODO: multipart
            client.write(`--stream\r\n`);
            client.write(`Content-Type: image/jpeg\r\n\r\n`);
            client.write(data);
        });
    });

    ffmpegInstance.on("close", () => {
        running = false;
        console.log(`FFmpeg instance closed!`);
        setTimeout(() => startStream(), config.retryDelay);
    });
})();

const app = new App();

app.get("/", (req, res) => {
    // TODO: show printer stats
});

app.get("/stream", (req, res, next) => {
    console.log(clients.length);
    const clientIndex = clients.push(res);

    res.statusCode = 200;
    res.setHeader("Content-Type", "multipart/x-mixed-replace; boundary=stream");

    req.on("close", () => {
        delete clients[clientIndex-1];
    });
});

app.use((req, res) => {
    res.writeHead(404).end();
});

app.listen(config.port, () => console.log(`Listening at :${config.port}`))