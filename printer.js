var serialport = require("serialport"),
    SerialPort = serialport.SerialPort,
    async = require("async"),
    fs = require("fs"),
    logger = require("./logger.js");

//constants
var PRINT_TEMPERATURE_REGEX = /T:(\d+.\d)/;
var PRINT_STATUS = {
    PRINTING: 'PRINTING',
    PAUSED: 'PAUSED',
    READY: 'READY',
    FINSIHED: 'FINISHED',
    DISCONNECTED: 'DISCONNECTED'
};

function Printer(port, baudrate) {

    var self = this;
    var port = port;
    var baudrate = baudrate;
    var serialListener;

    //status reporting
    var printStatus = PRINT_STATUS.DISCONNECTED;
    var statusCb;
    var statusPollerInterval;
    var printStartTime;
    var lastTemperature;

    //print file
    var linesOfFile;
    var file;
    var currentLine;


    //command queues
    var prioritizedCommands = [];
    var printCommands = [];

    var serial;

    // -- private functions --

    function processNextCommand() {

        if (printStatus == PRINT_STATUS.PAUSED) {
            logger.debug("still paused...");
            setTimeout(processNextCommand, 500);
        }
        else {
            //prioritized come first :-)
            if (prioritizedCommands.length > 0) {
                sendSerial(prioritizedCommands.shift());
            }
            else if (printCommands.length > 0) {

                var cmd = "N" + currentLine++ + ' ' + printCommands[currentLine - 1];
                var checkSum = 0;
                for (var i = 0; cmd.charAt(i) != '*' && i < cmd.length; i++)
                    checkSum = checkSum ^ cmd.charCodeAt(i);

                sendSerial(cmd + '*' + checkSum);

                //check if print is finished
                if (printCommands.length == 0 && printStatus == PRINT_STATUS.PRINTING)
                    updatePrintStatus(PRINT_STATUS.FINSIHED);
            }
        }
    }

    function updatePrintStatus(newStatus) {
        printStatus = newStatus;
    }

    function resetPrintData() {
        printCommands = [];
        linesOfFile = 0;
        prioritizedCommands = [];
    }

    function detectPrinterPort(cb) {
        logger.info("trying to automatically detect the printer..");

        serialport.list(function (err, ports) {
            if (err)
                cb(undefined);
            else {
                var detectedPort;
                var availablePorts = [];

                //iterate ports
                for (var i = 0; i < ports.length && !detectedPort; i++) {
                    var port = ports[i];
                    availablePorts.push(port.comName);

                    var info = port.manufacturer || port.pnpId;
                    //arduino must be the printer ;-)
                    if (info.indexOf("Arduino") != -1)
                        detectedPort = port.comName;
                }

                if (detectedPort) {
                    logger.info("found printer: " + port.comName + ".");
                    cb(detectedPort);
                }

                //no printer found..
                else {
                    logger.error("cannot detect the printer's port, make sure that the printer is online. You can also try to specifiy the port manually via settings.js.");
                    logger.error("available ports: " + availablePorts);
                    cb(undefined);
                }
            }
        });
    }


    // reporting

    function reportStatus(temperature) {
        lastTemperature = temperature;
        if (statusCb) {
            var currentStatus = {
                printStatus: printStatus,
                temperature: lastTemperature
            };

            if (printStatus == PRINT_STATUS.PRINTING) {
                currentStatus.progress = Math.round(progressInPercent()) + "%";
                currentStatus.printStartTime = printStartTime;
                currentStatus.elapsedMinutes = Math.floor(elapsedMinutes());
                currentStatus.ETA = ETA();
            }
            statusCb(currentStatus);
        }
    }

    function progressInPercent() {
        return ((linesOfFile - printCommands.length) / linesOfFile) * 100;
    }

    function elapsedMinutes() {
        var diffInMilliseconds = Math.abs(printStartTime.getTime() - (new Date()).getTime());
        return diffInMilliseconds / 1000 / 60;
    }

    function ETA() {
        if (elapsedMinutes() > 2) {
            var printTimeInMinutes = elapsedMinutes() / progressInPercent() * 100;
            return new Date(printStartTime.getTime() + printTimeInMinutes * 60 * 1000);
        }
        else
            return undefined;
    }

    // serial communication

    function receivedMessage(msg) {
        logger.debug("RECV: " + msg);

        if (serialListener)
            serialListener(msg);

        if (msg.indexOf("ok") == 0)
            processNextCommand();

        if (PRINT_TEMPERATURE_REGEX.test(msg))
            reportStatus(msg.match(PRINT_TEMPERATURE_REGEX)[0]);
    }

    function sendSerial(cmd) {
        cmd = cmd.trim();

        logger.debug("SENT: " + cmd);
        serial.write(cmd + "\n");
    }

    function connectToPrinter(port, baudrate, cb) {
        logger.info("trying to connect to: " + port + " (" + baudrate + " baud)..");

        serial = new SerialPort(port, {
            baudrate: baudrate,
            parser: serialport.parsers.readline("\n")
        });

        serial.on("open", function () {
            logger.info("connection established.");
            updatePrintStatus(PRINT_STATUS.READY);
            cb();
        });

        serial.on('data', function (data) {
            receivedMessage(data);
        });

        serial.on('error', function (message) {
            logger.error(message);
            if (message.toString().indexOf("Cannot open") != -1) {
                logger.error("cannot connect to the printer, make sure the settings are correct and the printer is online and connected.");

                serialport.list(function (err, ports) {
                    var others = [];
                    for (var i = 0; i < ports.length; i++) {
                        var port = ports[i];
                        if (port.manufacturer.indexOf("Arduino") != -1)
                            logger.info("set configuration to auto or try to use this port:  " + port.comName);
                        else
                            others.push(port.comName);
                    }
                    logger.info("other available serial devices (not necessarily your printer): " + others);
                });
            }
        });
    }

    // -- exposed methods --

    this.connect = function (cb) {
        async.series([
            function (done) {
                if (port === 'auto') {
                    detectPrinterPort(function (p) {
                        port = p;
                        done();
                    });
                }
                else
                    done();
            },
            function () {
                connectToPrinter(port, baudrate, cb);
            }
        ]);
    }

    this.pause = function () {
        logger.info("pausing print..");
        printStatus = PRINT_STATUS.PAUSED;
    }

    this.resume = function () {
        logger.info("resuming print..");
        printStatus = PRINT_STATUS.PRINTING;
    }

    this.disconnect = function () {
        logger.info("disconnecting printer..");
        resetPrintData();
        serial.disconnect();
        serial = undefined;
        updatePrintStatus(PRINT_STATUS.DISCONNECTED);
    }

    this.stop = function () {
        logger.info("stopping print..");
        resetPrintData();
        clearInterval(statusPollerInterval);
        self.sendCommand("M104 S0"); //temperature off
        self.sendCommand("G91");
        self.sendCommand("G1 Z5 F300"); //move a little up
        self.sendCommand("G90");
        self.sendCommand("G28 X0 Y0"); //home x&y
        updatePrintStatus(PRINT_STATUS.READY);
    }

    this.setStatusPoller = function (cb, intervalInSeconds) {
        statusCb = cb;
        if (!intervalInSeconds)
            intervalInSeconds = 5000;

        logger.debug("status poller activated for every " + intervalInSeconds + " ms.");

        statusPollerInterval = setInterval(function () {
            self.sendCommand("M105");
        }, intervalInSeconds);
    }

    this.setSerialListener = function (cb) {
        serialListener = cb;
    }

    this.isPrinting = function () {
        return printCommands.length > 0;
    }

    this.print = function (file) {
        var parsedCommands = parseGCODE(file);

        logger.info("starting to print file: " + file);

        if (parsedCommands && parsedCommands.length > 0) {

            updatePrintStatus(PRINT_STATUS.PRINTING);
            printCommands = parsedCommands;
            linesOfFile = parsedCommands.length;
            logger.debug("lines of parsed gcode " + linesOfFile);
            printStartTime = new Date();
            currentLine = 1;

            //trigger first "ok"
            sendSerial("M105");
        }
        else
            logger.error("print file is invalid.");
    }

    function parseGCODE(file) {
        var printCommands = fs.readFileSync(file, "utf8").split("\n");
        logger.debug("GCODE before parsing: " + printCommands.join(","));

        //exclude comments
        var i = printCommands.length;
        while (i--) {
            var line = printCommands[i].trim();
            if (line == '' || line.indexOf(";") == "0")
                printCommands.splice(i, 1);
            else if (line.indexOf(";") != -1)
                printCommands[i] = line.substring(0, line.indexOf(";")).trim();
        }

        logger.debug("GCODE after parsing: " + printCommands.join(","));
        return printCommands;
    }

    this.sendCommand = function (cmd) {
        logger.debug("sending prioritized command: " + cmd)

        if (printStatus == PRINT_STATUS.PRINTING)
            prioritizedCommands.push(cmd);

        else if (printStatus == PRINT_STATUS.READY)
            sendSerial(cmd);
    }
}

exports.Printer = Printer;
