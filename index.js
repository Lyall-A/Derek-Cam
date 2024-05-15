// TODO: get smart plug state from octoprint api
// TODO: create images
// TODO: fix stops working randomly and times out (ffmpeg dies at around 5500 frames?)

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
        ...(config.ffmpegOutputArgs?.split(" ") || ""),
        "-c:v",
        "mjpeg",
        "-f",
        "mjpeg",
        "-"];
        
    console.log(`Starting FFmpeg instance with args '${ffmpegArgs.join(" ")}'`);
    const ffmpegInstance = childProcess.spawn(config.ffmpegPath, ffmpegArgs);

    // ffmpegInstance.stderr.on("data", data => console.log(data.toString()));
    if (config.ffmpegLog) {
        ffmpegInstance.stderr.on("data", data => {
            const string = data.toString();
            console.log(`${string.substring(0, config.ffmpegLogLength || string.length)}...`);
        });
    }
    ffmpegInstance.stdout.on("data", data => {
        // console.log("FFMPEG STDOUT DATA");

        running = true;
        clients.forEach(client => sendImg(client, data, client.isStill ? false : true));
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
    if (clients.length >= config.maxClients) {
        res.statusCode = 503;
        return res.end("Too many active clients!");
    };

    const id = genId();

    clients.push({ id, res });

    res.statusCode = 200;
    res.setHeader("Content-Type", "multipart/x-mixed-replace; boundary=stream");

    req.on("close", () => clients.splice(clients.findIndex(i => i.id == id), 1));

    res.on("error", () => { });

    if (off && offImage) sendImg(res, offImage, true); else if (!off && !running && defaultImage) sendImg(res, defaultImage, true);
});

app.get("/still", (req, res) => {
    res.statusCode = 200;
    res.setHeader("Content-Type", "image/jpeg");
    
    if (off && offImage) return sendImg(res, offImage); else if (!off && !running && defaultImage) return sendImg(res, defaultImage);

    const id = genId();

    clients.push({ id, res, isStill: true });

    req.on("close", () => clients.splice(clients.findIndex(i => i.id == id), 1));

    res.on("error", () => { });
});

app.use((req, res) => {
    res.writeHead(404).end();
});

app.listen(config.port, () => console.log(`Listening at :${config.port}`));

function sendImg(client, image, multipart) {
    if (multipart && image[0] == 0xFF && image[1] == 0xD8) {
        client.res.write(`--stream\r\n`);
        client.res.write(`Content-Type: image/jpeg\r\n`);
        client.res.write(`Content-Length: ${image.byteLength}\r\n\r\n`);
    }
    client.res.write(image);
    if (image[image.length - 2] == 0xFF && image[image.length - 1] == 0xD9) {
        if (multipart) client.res.write("\r\n\r\n"); else client.res.end();
    }
}

const idChars = [0,1,2,3,4,5,6,7,8,9];
function genId() {
    let string = "";
    for (let i = 0; i < 15; i++) string += idChars[Math.floor(Math.random() * idChars.length)];
    if (clients.find(i => i.id == string)) return genId();
    return string;
}