const childProcess = require("child_process");
const App = require("./utils/HTTP/App");

const config = require("./config.json");

const clients = [];
let running = false;

(function startStream() {
    const ffmpegArgs = [
        "-i",
        config.path,
        ...(config.ffmpegArgs?.split(" ") || ""),
        "-f",
        "mjpeg",
        "-"];
        
    console.log(`Starting FFmpeg instance!`);
    const ffmpegInstance = childProcess.spawn(config.ffmpegPath, ffmpegArgs);

    ffmpegInstance.stderr.on("data", data => {
        running = true;
        clients.forEach(client => {
            client.write(data); // TODO: multipart
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
    const clientIndex = clients.push(res);
    // TODO: show cam

    req.on("close", () => {
        delete clients[clientIndex-1];
    });
});

app.get("*", (req, res) => {
    res.writeHead(404).end();
});

app.listen(config.port, () => console.log(`Listening at :${config.port}`))