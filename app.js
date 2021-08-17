const express = require("express");
const cookieParser = require("cookie-parser");
const logger = require("morgan");

const apiMetrics = require("prometheus-api-metrics");
const axios = require("axios");
const SolarEdgeModbusClient = require("solaredge-modbus-client");
const mqtt = require("mqtt");
const { universalParseValue, allMetrics } = require("./universalMetricParser");

var app = express();
app.use(apiMetrics());

app.use(logger("dev"));
app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(cookieParser());

var client2 = mqtt.connect(process.env.MQTT_ADDRESS, {
  username: process.env.MQTT_USERNAME, //TODO better
  password: process.env.MQTT_PASSWORD,
});
/*
let solar = new SolarEdgeModbusClient({
  host: process.env.SOLAREDGE_ADDRESS,
  port: 502,
});
*/
client2.on("connect", function () {
  console.log("Mqtt2 connected");
  client2.subscribe("current/#", function (err) {
    if (err) {
      process.exit(1);
    }
  });
});

(async () => {
  while (true) {
    await monitorMainWattmetter();
    await monitorEvse();
    //await monitorSolarEdge();
    setEvseChargingCurrent();
  }
})();

client2.on("message", function (topic, message) {
  console.log("Got mqtt message "+message.toString() + " on topic "+ topic);
  var splitTopic = topic.split("/");
  var deviceId = splitTopic[1];
  var valueRaw = message.toString();
  var metricName = deviceId + "_" + splitTopic[0];

  universalParseValue(valueRaw, metricName, deviceId);
});

function monitorMainWattmetter() {
  return new Promise((res, rej) => {
    setTimeout(() => {
      axios
        .get(process.env.WATT_ADDRESS+"/updateData")
        .then(function (response) {
          delete response.data.WATTMETER_TIME;
          console.log("Got wattmetter message "+JSON.stringify(response.data));
          for (const property in response.data) {
            var deviceId = "watt01";
            var metricName = deviceId + "_" + property;
            var valueRaw = response.data[property];
            universalParseValue(valueRaw, metricName, deviceId);
          }
        })
        .catch(function (error) {
          console.log(error);
        })
        .then(function () {
          res();
        });
    }, 2000);
  });
}

var lastSetCurrent = 0;

function setEvseChargingCurrent() {
  var chargingCurrent = allMetrics["evse01_amp_0"] / 1000;
  var maxFuse = 25;
  var phasePower = [allMetrics["watt01_I1_0"] / 100.0 - chargingCurrent, allMetrics["watt01_I2_0"] / 100.0 - chargingCurrent, allMetrics["watt01_I3_0"] / 100.0 - chargingCurrent];//TODO include solar data
  var highestCurrent = maxFuse - Math.round(Math.max(...phasePower)); //subtract current now
  if (highestCurrent < 0) {
    highestCurrent = 0;
  }
  
  if(Math.abs(lastSetCurrent - highestCurrent) > 1){
    axios
    .get(process.env.OEVSE_ADDRESS+"/r?json=1&rapi=$SC+" + highestCurrent)
    .then(function (response) {
      lastSetCurrent = highestCurrent
      console.log("Max charing current set to "+highestCurrent+"A per phase")
      console.log(response.data);
    })
    .catch(function (error) {
      console.log(error); //raise error
    })
  }
    
  universalParseValue(lastSetCurrent, "set_max_charge_current", "wattCalc01");

}

function monitorEvse() {
  return new Promise((res, rej) => {
    setTimeout(() => {
      axios
        .get(process.env.OEVSE_ADDRESS+"/status")
        .then(function (response) {
          delete response.data.time;
          console.log("Got ovms message"+JSON.stringify(response.data));
          for (const property in response.data) {
            var deviceId = "evse01";
            var metricName = deviceId + "_" + property;
            var valueRaw = response.data[property];

            universalParseValue(valueRaw, metricName, deviceId);
          }
        })
        .catch(function (error) {
          console.log(error);
        })
        .then(function () {
          res();
        });
    }, 2000);
  });
}

function  monitorSolarEdge(){
  return new Promise((res, rej) => {
    setTimeout(() => {
      solar
        .getData()
        .then((data) => {
          console.log(data); //todo export dis
          var deviceId = "solar01";
          var metricName = deviceId + "_" + property;
          var valueRaw = response.data[property];

          universalParseValue(valueRaw, metricName, deviceId);
        })
        .catch(function (error) {
          console.log(error);
        });
    }, 5000);
  });
}

console.log("App running on port 3000");
module.exports = app;
