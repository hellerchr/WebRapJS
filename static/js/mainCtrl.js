function mainCtrl($scope, Socket) {

    $scope.command = ''
    $scope.consoleHistory = [];
    $scope.cmdHistory = [];
    $scope.printing = false;
    $scope.gcodeAvailable = false;
    selectedCommand = 0;
    $scope.loadText = "LOADING..";
    $scope.extruderTemp = '';

    Socket.on(EVENTS.STATUS, function (status) {
        $scope.printing = status.printStatus == 'PRINTING';
        $scope.progress = status.progress;
        $scope.extruderTemp = status.temperature;
    });

    Socket.on(EVENTS.SERIAL_MESSAGE, function (msg) {
        addToConsole(msg);
    });

    Socket.on(EVENTS.BEGIN, init);

    function executeGcode(cmd) {
        console.log("EXECUTING GCODE FORM CLIENT", cmd);
        Socket.emit(EVENTS.EXECUTE_GCODE, cmd);
    }

    function getLastPrint(cb) {
        Socket.emit(EVENTS.GET_LAST_PRINT, cb);
    }

    function storePrint(data, cb) {
        Socket.emit(EVENTS.STORE_PRINT, data, cb);
    }

    function printControl(cb) {
        Socket.emit(EVENTS.PRINT_CONTROL, cb);
    }

    function init() {
        getLastPrint(function (data) {
            if (data) {
                openGCodeFromText(data);
                $scope.gcodeAvailable = true;
            }
            else
                $scope.loadText = "DROP GCODE HERE..";
        });
    }

    $scope.commands = {
        'clear': {
            'help': 'clears the console',
            'function': function (params, callback) {
                $scope.consoleHistory = [];
                $scope.command = '';
                callback(true);
            }},
        'home': {
            'help': 'homes all the axes \n syntax: home',
            'function': function (params, callback) {
                executeGcode("G28 X0 Y0 Z0");
                callback(true);
            }},
        'print': {
            'help': 'starts/stops the print \n syntax: print [start][stop][pause][resume] \n example: print start',
            'function': function (params, callback) {
                if (params.length == 1) {
                    if (params[0] === 'start' || params[0] === 'resume')
                        $scope.printing = true;
                    else
                        $scope.printing = false;

                    printControl(params[0]);
                    callback(true);
                }
            }},
        'temp': {
            'help': 'sets or shows the temperature \n syntax: temp [<temperature>] \n example: temp 200',
            'function': function (params, callback) {
                if (params == undefined || params.length == 0) {
                    executeGcode("M105");
                    callback(true);
                }

                else if (params.length == 1) {
                    executeGcode("M104 S" + params[0]);
                    callback(true);
                }
            }},
        'connect': {
            'help': 'connects to the printer',
            'function': function (params, callback) {
                printControl('connect');
                callback(true);
            }},
        'disconnect': {
            'help': 'disconnects from the printer',
            'function': function (params, callback) {
                printControl('disconnect');
                callback(true);
            }},
        'fan': {
            'help': 'sets the speed of the fan \n syntax1: fan <speed> \n syntax2: fan [on][off] \n example: fan on',
            'function': function (params, callback) {
                if (params.length == 1) {
                    if (params[0] == 'on') {
                        executeGcode('M106 S255');
                        callback(true);
                    }
                    else if (params[0] == 'off') {
                        executeGcode('M107');
                        callback(true);
                    }
                    else {
                        executeGcode('M106 S' + parseInt(params[0]));
                        callback(true);
                    }
                }
                else {
                    callback("wrong number of arguments");
                }
            }},
        'move': {
            'help': 'move the printhead \n syntax: move <axis><distance> [<speed>] \n example: move x10',
            'function': function (params, callback) {

                if (params.length > 0) {
                    var speed = 0;
                    var axisMove = params[0].toUpperCase();

                    if (params.length == 1) {
                        var axis = axisMove[0];
                        if (axis == 'X' || axis == 'Y')
                            speed = 2000;
                        if (axis == 'Z')
                            speed = 300;
                    }
                    else if (params.length == 2)
                        speed = params[1];

                    executeGcode('G91;G1 ' + axisMove + ' F' + speed + ';G90');
                }
            }},
        'help': {
            'help': 'I like you, you\'ve got humor :-)',
            'function': function (params, callback) {
                //list all commands
                if (params.length == 0) {
                    var cmds = [];
                    for (key in $scope.commands)
                        cmds.push(key);

                    cmds.sort();

                    var list = '';
                    for (key in cmds)
                        list += (cmds[key] + ', ');

                    callback('available commands: \n' + list.substr(0, list.length - 2) + "\n type 'help <command>' for more information");
                }

                //help for specific command
                else {
                    var helpText = "";

                    if ($scope.commands[params[0]])
                        helpText = $scope.commands[params[0]].help;

                    callback(helpText);
                }
            }},
        'extrude': {
            'help': 'extrudes n millimeter plastic \n syntax: extrude <distance in mm> \n example: extrude 5',
            'function': function (params, callback) {
                if (params && params.length == 1) {
                    var length = parseInt(params[0]);
                    var cmd = 'G91;G1 E' + length + ' F300' + ';G90';
                    executeGcode(cmd, callback);
                }
                else {
                    executeGcode('G91;G1 E5 F300' + ';G90');
                }
            }
        }}

    $scope.sendCommand = function (command) {
        var commands = command.trim().split(";")

        for (var i = 0; i < commands.length; i++) {
            var commandWord = commands[i].split(" ")[0];

            if ($scope.commands.hasOwnProperty(commandWord)) {
                var params = commands[i].split(" ").slice(1);
                $scope.commands[commandWord].function(params, function (response) {
                    if (response === true)
                        saveCommand(command);
                    else
                        saveCommand(response)
                });
            }
            else {
                executeGcode(command);
                saveCommand();
            }
        }
    }

    $scope.lastCommand = function (e) {
        if (selectedCommand > 0) {
            selectedCommand -= 1;
            $scope.command = $scope.cmdHistory[selectedCommand];
        }
    }

    $scope.nextCommand = function (e) {
        if (selectedCommand < $scope.cmdHistory.length - 1) {
            selectedCommand += 1;
            $scope.command = $scope.cmdHistory[selectedCommand];
        }
        else {
            $scope.command = '';
            selectedCommand = $scope.cmdHistory.length;
        }
    }

    function addToConsole(text) {
        if (text) {
            var lines = text.trim().split("\n");
            for (var i = 0; i < lines.length; i++) {
                $scope.consoleHistory.push('» ' + lines[i].trim());
            }
        }
        //scroll console down
        setTimeout(function () {
            $('#console').scrollTop($('#console')[0].scrollHeight);
        }, 5);
    }

    function saveCommand(response) {

        if ($scope.command) {

            $scope.cmdHistory.push($scope.command);

            if ($scope.command != "clear")
                $scope.consoleHistory.push($scope.command);

            if (response) {
                if (response.hasOwnProperty("message"))
                    addToConsole(response.message);
                else
                    addToConsole(response);
            }

            $scope.command = '';
            selectedCommand = $scope.cmdHistory.length;
        }
    }

    function parseExtruderTemp(message) {
        if (message)
            return message.match(/T:(\d+.\d)/)[1];
    }

    $scope.storeFile = function (fileName, data, callback) {
        var data = { 'name': fileName, 'data': data }
        $scope.gcodeAvailable = false;
        storePrint(data, function (success) {
            if (success)
                $scope.gcodeAvailable = true;
            callback(success);
        });
    }
}
