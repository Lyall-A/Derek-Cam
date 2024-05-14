// TODO: get smart plug state from octoprint api
// TODO: create images

const childProcess = require("child_process");
const fs = require("fs");
const App = require("./utils/HTTP/App");

const config = require("./config.json");
const secret = JSON.parse(fs.readFileSync("./.secret", "utf-8"));

const offImage = config.offImagePath ? fs.readFileSync(config.offImagePath) : null;
const defaultImage = config.defaultImagePath ? fs.readFileSync(config.defaultImagePath) : null;

const clients = [];

let running = false;
let off = false;

(function startStream() {
    const ffmpegArgs = [
        ...(config.ffmpegInputArgs?.split(" ") || ""),
        "-i",
        config.path,
        ...(config.ffmpegArgs?.split(" ") || ""),
        "-c:v",
        "mjpeg",
        "-f",
        "mjpeg",
        "-"];
        
    console.log(`Starting FFmpeg instance!`);
    const ffmpegInstance = childProcess.spawn(config.ffmpegPath, ffmpegArgs);

    // ffmpegInstance.stderr.on("data", data => console.log(data.toString()));
    ffmpegInstance.stdout.on("data", data => {
        running = true;
        clients.filter(i => i).forEach(client => {
            if (data[0] == 0xFF && data[1] == 0xD8 && !client.isStill) {
                client.write(`--stream\r\n`);
                client.write(`Content-Type: image/jpeg\r\n\r\n`);
            }

            client.write(data);

            if (data[data.length - 2] == 0xFF && data[data.length - 1] == 0xD9) {
                if (client.isStill) client.end(); else client.write("\r\n\r\n");
            }
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
    res.statusCode = 307;
    res.setHeader("Location", "/stream");
    res.end();
});

app.get("/stream", (req, res) => {
    if (clients.filter(i => i && !i?.isStill).length >= config.maxClients) return;

    const clientIndex = clients.push(res);

    res.statusCode = 200;
    res.setHeader("Content-Type", "multipart/x-mixed-replace; boundary=stream");

    req.on("close", () => {
        delete clients[clientIndex-1];
    });

    if (off && offImage) {
        res.write(`--stream\r\n`);
        res.write(`Content-Type: image/jpeg\r\n\r\n`);
        res.write(offImage);
        res.write("\r\n\r\n");
    } else if (!off && !running && defaultImage) {
        res.write(`--stream\r\n`);
        res.write(`Content-Type: image/jpeg\r\n\r\n`);
        res.write(defaultImage);
        res.write("\r\n\r\n");
    }
});

app.get("/still", (req, res) => {
    if (off && offImage) {
        res.write(`--stream\r\n`);
        res.write(`Content-Type: image/jpeg\r\n\r\n`);
        res.write(offImage);
    } else if (!off && !running && defaultImage) {
        res.write(`--stream\r\n`);
        res.write(`Content-Type: image/jpeg\r\n\r\n`);
        res.write(defaultImage);
    }

    res.isStill = true;

    const clientIndex = clients.push(res);

    res.statusCode = 200;
    res.setHeader("Content-Type", "image/jpeg");

    req.on("close", () => {
        delete clients[clientIndex-1];
    });
});

app.use((req, res) => {
    res.writeHead(404).end();
});

app.listen(config.port, () => console.log(`Listening at :${config.port}`));