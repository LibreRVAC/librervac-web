 "use strict";

//if(!!navigator.getGamepads){
//    // Browser supports the Gamepad API
//    var gamepads = navigator.getGamepads();
//    console.log(gamepads);
//}

var channels = [
    {name: "Start (normal)"},
    {name: "Start (spot)"},
    {name: "Docking"},
    {name: "Left wheel"},
    {name: "Right wheel"},
    {name: "Vacuum"},
    {name: "Main brush"},
    {name: "Side brushes"},
//    {name: "Left brush"},
//    {name: "Right brush"},
];

var mixes = [];

var controls = {};
var newControl = null;

var socket = new WebSocket("ws://" + location.host + "/websocket");
window.onbeforeunload = function(e) { socket.close(); };
socket.onmessage = function(msg) {
    //console.log(msg);
    var data = JSON.parse(msg.data);
    if (data.c == 'info') {
        Object.keys(data).forEach(function(key) {
            if (key == 'c')
                return;
            var field = document.getElementById('field-' + key);
            if (field !== null) {
                if (key == 'bandwidth-in' || key == 'bandwidth-out')
                    field.textContent = (data[key] / 1000).toFixed(2); // kB/s
                else if (key == 'battery-status')
                    field.textContent = (data[key] * 100).toFixed(2); // %
                else if (key == 'battery-voltage' || key == 'battery-current' || key == 'battery-temperature')
                    field.textContent = (data[key] * 1).toFixed(2);
                else
                    field.textContent = data[key];
            } else {
                logVisibly('[HTML] Missing “' + key + '” status field.');
            }
        });
    } else if (data.c == 'log') {
        logVisibly(data.str);
    }
};

function logVisibly(str) {
    var logDiv = document.getElementById('log');
    if (document.activeElement != logDiv) {
        logDiv.innerHTML += str + '\n';
        logDiv.scrollTop = logDiv.scrollHeight;
    } else {
        var start = logDiv.selectionStart;
        var end = logDiv.selectionEnd;
        logDiv.innerHTML += str + '\n';
        logDiv.setSelectionRange(start, end);
    }
}

function canGame() {
    return "getGamepads" in navigator;
}

function send(mix) {
    var msg = {
        control: mix.channel.name,
        value: mix.finalValue,
    };
    socket.send(JSON.stringify(msg));
    //console.log(JSON.stringify(msg));
}

function setControl(submix) {
    newControl = submix;
}

function handle(submix, value) {
    submix.value = value;
    submix.valueLabel.innerHTML = value.toFixed(2);
    processMix(submix['parent']);
}

function processMix(mix) {
    var finalValue = 0;
    mix.submixes.forEach(function(submix) {
        submix.result = submix.value * submix.invertMult
            * submix.weight + submix.shift; // TODO expo
        submix.resultLabel.innerHTML = submix.result.toFixed(2);
        finalValue += submix.result;
    });
    mix.finalValue = finalValue;
    mix.finalValueLabel.innerHTML = finalValue.toFixed(2);
    send(mix);
}

function newMix(channel) {
    // Ouch! This is too verbose.
    var submix = {value: 0, invertMult: 1, weight: 1, shift: 0, expo: 0, result: 0,
                  inputLabel: null, valueLabel: null, resultLabel: null,
                 };

    var fragment = document.createDocumentFragment();
    var tr = document.createElement("tr");

    var outputLabel = tr.appendChild(document.createElement("td"))
        .appendChild(document.createElement("span"));
    outputLabel.appendChild(document.createTextNode(channel.name));

    var inputLabel = tr.appendChild(document.createElement("td"))
        .appendChild(document.createElement("span"));
    inputLabel.appendChild(document.createTextNode("None"));
    submix.inputLabel = inputLabel;

    var inputButton = tr.appendChild(document.createElement("td"))
        .appendChild(document.createElement("button"));
    inputButton.appendChild(document.createTextNode("Set"));
    inputButton.addEventListener("click", setControl.bind(undefined, submix));

    var valueLabel = tr.appendChild(document.createElement("td"))
        .appendChild(document.createElement("span"));
    valueLabel.appendChild(document.createTextNode(submix['value']));
    submix.valueLabel = valueLabel;

    var invertCheckbox = tr.appendChild(document.createElement("td"))
        .appendChild(document.createElement("input"));
    invertCheckbox.type = "checkbox";
    invertCheckbox.addEventListener("change", function(e) { submix.invertMult = e.target.checked ? -1 : 1; });

    var weightNumber = tr.appendChild(document.createElement("td"))
        .appendChild(document.createElement("input"));
    weightNumber.type = "number";
    weightNumber.step = 0.01;
    weightNumber.defaultValue = submix['weight'];
    weightNumber.addEventListener("change", function(e) { submix.weight = parseFloat(e.target.value); });

    var shiftNumber = tr.appendChild(document.createElement("td"))
        .appendChild(document.createElement("input"));
    shiftNumber.type = "number";
    shiftNumber.step = 0.01;
    shiftNumber.defaultValue = submix['shift'];
    shiftNumber.addEventListener("change", function(e) { submix.shift = parseFloat(e.target.value); });

    var expoNumber = tr.appendChild(document.createElement("td"))
        .appendChild(document.createElement("input"));
    expoNumber.type = "number";
    expoNumber.step = 0.01;
    expoNumber.defaultValue = submix['expo'];
    expoNumber.addEventListener("change", function(e) { submix.expo = parseFloat(e.target.value);} );

    var resultLabel = tr.appendChild(document.createElement("td"))
        .appendChild(document.createElement("span"));
    resultLabel.appendChild(document.createTextNode(submix.result));
    submix.resultLabel = resultLabel;

    var finalValueLabel = tr.appendChild(document.createElement("td"))
        .appendChild(document.createElement("span"));
    finalValueLabel.appendChild(document.createTextNode("0"));

    var mix = {channel: channel, submixes: [submix], finalValueLabel: finalValueLabel,};
    submix.parent = mix;
    mixes.push(mix);
    fragment.appendChild(tr);
    return fragment;
}

function generateControls() {
    var fragment = document.createDocumentFragment();
    channels.forEach(function(channel) {
        fragment.appendChild(newMix(channel));
    });
    var table = document.getElementById("controls-table").appendChild(fragment);
}

document.addEventListener('DOMContentLoaded', function() {
    generateControls();
    if (canGame()) {
        window.addEventListener("gamepadconnected", function(e) {
            console.log("connection event");
        });
        window.addEventListener("gamepaddisconnected", function(e) {
            console.log("disconnection event");
        });
        window.addEventListener("gamepadbuttondown", buttonDown);
        window.addEventListener("gamepadbuttonup", buttonUp);
        window.addEventListener("gamepadaxismove", axisMove);
    }
}, false);


// ↓↓↓ Input handlers ↓↓↓

function buttonUp(e) {
    var control = controls[e.gamepad.index + "btn" + e.button];
    if (control)
        handle(control, 0);
}

function buttonDown(e) {
    //console.log(actions);
    if (newControl !== null) {
        controls[e.gamepad.index + "btn" + e.button] = newControl;
        newControl.inputLabel.innerHTML = "Joypad " + e.gamepad.index + ", button " + e.button;
        newControl = null;
        return;
    }
    var control = controls[e.gamepad.index + "btn" + e.button];
    if (control)
        handle(control, 1);
}

function axisMove(e) {
    if (newControl !== null) {
        if (e.value < -0.5 || +0.5 < e.value ) {
            controls[e.gamepad + "axis" + e.axis] = newControl;
            newControl.inputLabel.innerHTML = "Joypad " + e.gamepad.index + ", axis " + e.axis;
            newControl = null;
            return;
        }
    }
    var control = controls[e.gamepad + "axis" + e.axis];
    if (control)
        handle(control, e.value);
}

// ↑↑↑ Input handlers ↑↑↑
