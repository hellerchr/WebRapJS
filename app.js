var express = require('express'),
    http = require('http'),
    socketIo = require('socket.io'),
    fs = require("fs"),
    printer = require("./printer.js"),
    settings = require("./settings.js"),
    logger = require("./logger.js"),
    EVENTS = require("./static/js/constants.js").EVENTS;

var GCODE_TEMP_FILE = './temp.gcode'
var myPrinter = new printer.Printer(settings.port, settings.baudrate);

var app = express();
var server = http.createServer(app);
var io = socketIo.listen(server, { log: false });

app.use(app.router);
app.use(express.bodyParser());
app.use(express.cookieParser());
app.use('/static', express.static(__dirname + '/static'));

app.get('/', function (req, res) {
    res.sendfile(__dirname + '/index.html');
});

function storePrint(file, fn) {
    fs.writeFile(GCODE_TEMP_FILE, file.data, "UTF-8", function (err) {
        if (err) {
            fn(false);
            logger.error("error while storing print file: " + err)
        }
        else {
            fn(true);
            logger.info("successfully stored print file.")
        }
    });
}

function getLastPrint(cb) {
    fs.exists(GCODE_TEMP_FILE, function (exists) {
        if (exists)
            fs.readFile(GCODE_TEMP_FILE, 'UTF-8', function read(err, data) {
                cb(data);
            });
    });
}

function printControl(cmd) {
    if (cmd == 'start')
        myPrinter.print(GCODE_TEMP_FILE);

    else if (cmd == 'stop')
        myPrinter.stop();
    else if (cmd == 'pause')
        myPrinter.pause();
    else if (cmd == 'resume')
        myPrinter.resume();
    else if (cmd == 'connect')
        myPrinter.connect();
    else if (cmd == 'disconnect')
        myPrinter.disconnect();
}

function executeGcode(cmd) {
    var commands = cmd.split(";");

    for (var i = 0; i < commands.length; i++) {
        var cmd = commands[i];
        myPrinter.sendCommand(cmd);
    }
}

function sendStatus(status) {
    io.sockets.emit(EVENTS.STATUS, status);
}

function sendSerialMessage(msg) {
    io.sockets.emit(EVENTS.SERIAL_MESSAGE, msg);
}

io.sockets.on('connection', function (socket) {
    socket.emit(EVENTS.BEGIN);
    socket.on(EVENTS.GET_LAST_PRINT, function (cmd, fn) {
        getLastPrint(fn);
    });
    socket.on(EVENTS.STORE_PRINT, function (file, fn) {
        storePrint(file, fn);
    });
    socket.on(EVENTS.EXECUTE_GCODE, function (cmd) {
        executeGcode(cmd);
    });
    socket.on(EVENTS.PRINT_CONTROL, printControl);
});

server.listen(5000);

myPrinter.connect(function () {
    myPrinter.setStatusPoller(function (status) {
        sendStatus(status);
    });
    myPrinter.setSerialListener(function (msg) {
        sendSerialMessage(msg);
    });
});