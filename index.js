const childProcess = require("child_process");
const fs = require("fs");

const config = require("./config.json");
const streams = require("./streams.json");

streams.forEach((stream, index) => {
    streams[index].clients = [ ];
    startStream(stream, index);
});

function startStream(stream, index) {
    const ffmpegArgs = [
        "-i",
        stream.path,
        ...(config.ffmpegArgs?.split(" ") || ""),
        "-f",
        "mjpeg",
        "-"];

    const ffmpegInstance = childProcess.spawn(config.ffmpegPath, ffmpegArgs);

    streams[index].ffmpegArgs = ffmpegArgs;
    streams[index].ffmpegInstance = ffmpegInstance;

    ffmpegInstance.stderr.on("data", data => {
        streams[index].clients.forEach(client => {
            client.write(data); // TODO: multipart
        });
    });
}