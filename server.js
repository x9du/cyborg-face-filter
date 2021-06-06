const express = require("express");
const app = express();
const server = app.listen(process.env.PORT || 3000);
app.use(express.static("public"));

/*const socket = require("socket.io");
const io = socket(server);
io.sockets.on("connection", newConnection);

function newConnection(socket) {
    console.log("new connection: " + socket.id);

    socket.on("mouse", mouseMsg);
    function mouseMsg(data) {
        // Broadcast data to every other socket except this one
        socket.broadcast.emit("mouse", data);

        // Broadcast data to every socket including this one
        // io.sockets.emit("mouse", data);
    }
}*/