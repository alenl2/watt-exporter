const express = require("express");
const cookieParser = require("cookie-parser");
const logger = require("morgan");

const apiMetrics = require("prometheus-api-metrics");
const axios = require("axios");
const SolarEdgeModbusClient = require("solaredge-modbus-client");
const mqtt = require("mqtt");
const { universalParseValue, allMetrics } = require("./universalMetricParser");

axios.defaults.timeout = 6000;

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

var solar = new SolarEdgeModbusClient({
  host: process.env.SOLAREDGE_ADDRESS,
  port: 1502,
});

client2.on("connect", function () {
  console.log("Mqtt2 connected");
  client2.subscribe("current/#", function (err) {
    if (err) {
      process.exit(1);
    }
  });
});

client2.on("message", function (topic, message) {
  console.log("Got mqtt message on topic "+ topic);
  var splitTopic = topic.split("/");
  var deviceId = splitTopic[1];
  var valueRaw = message.toString();
  var metricName = deviceId + "_" + splitTopic[0];

  universalParseValue(valueRaw, metricName, deviceId);
});

var lastSetCurrent = 0;

function setEvseChargingCurrent() {
  console.log("Setting charging current")
  var chargingCurrent = allMetrics["evse01_amp_0"] / 1000;
  var maxFuse = 25;
  
  var phasePower = [
                  allMetrics["watt01_I1_0"] / 100.0 - chargingCurrent - (allMetrics["solar01_I_AC_CurrentA_0"]/100), 
                  allMetrics["watt01_I2_0"] / 100.0 - chargingCurrent - (allMetrics["solar01_I_AC_CurrentB_0"]/100), 
                  allMetrics["watt01_I3_0"] / 100.0 - chargingCurrent - (allMetrics["solar01_I_AC_CurrentC_0"]/100)
                ];
  var highestCurrent = maxFuse - Math.round(Math.max(...phasePower)); //subtract current now
  if (highestCurrent < 0) {
    highestCurrent = 0;
  }
  
  if(Math.abs(lastSetCurrent - highestCurrent) > 2){
    var setCurrent = highestCurrent
    if(setCurrent > 32){
      setCurrent = 32;
    }
    return new Promise((res, rej) => {
      setTimeout(() => {
        console.log("Setting charge speed")
        axios
          .get(process.env.OEVSE_ADDRESS+"/r?json=1&rapi=$SC+" + setCurrent)
          .then(function (response) {
            lastSetCurrent = highestCurrent
            console.log("Max charing current set to "+highestCurrent+"A per phase")
            universalParseValue(setCurrent, "set_max_charge_current", "wattCalc01");
            console.log(response.data);
          })
          .catch(function (error) {
            console.log(error.toJSON());
          })
          .finally(function () {
            res();
          });
      }, 10);
    });
  }
}

function monitorMainWattmetter() {
  return new Promise((res, rej) => {
    setTimeout(() => {
      console.log("Getting wattmeter data")
      axios
        .get(process.env.WATT_ADDRESS+"/updateData")
        .then(function (response) {
          delete response.data.WATTMETER_TIME;
          //console.log("Got wattmetter message "+JSON.stringify(response.data));
          for (const property in response.data) {
            var deviceId = "watt01";
            var metricName = deviceId + "_" + property;
            var valueRaw = response.data[property];
            universalParseValue(valueRaw, metricName, deviceId);
          }
        })
        .catch(function (error) {
          console.log(error.toJSON());
        })
        .finally(function () {
          res();
        });
    }, 500);
  });
}

function monitorEvse() {
  return new Promise((res, rej) => {
    setTimeout(() => {
      console.log("Getting evse data")
      axios
        .get(process.env.OEVSE_ADDRESS+"/status")
        .then(function (response) {
          delete response.data.time;
          //console.log("Got ovms message"+JSON.stringify(response.data));
          for (const property in response.data) {
            var deviceId = "evse01";
            var metricName = deviceId + "_" + property;
            var valueRaw = response.data[property];

            universalParseValue(valueRaw, metricName, deviceId);
          }
        })
        .catch(function (error) {
          console.log(error.toJSON());
        })
        .finally(function () {
          res();
        });
    }, 500);
  });
}

function  monitorSolarEdge(){
  return new Promise((res, rej) => {
    var didGetData = false;

    setTimeout(() => {
      if(didGetData == false){
        res();
        process.exit(1);
      }
    }, 5000);

    setTimeout(() => {
      console.log("Getting solaredge data")
      solar
        .getData()
        .then((data) => {
          //console.log("Got solaredge message "+JSON.stringify(data));
          didGetData = true;
          var deviceId = "solar01";
          for (var i=0;i<data.length;i++) {
            var metricName = deviceId + "_" + data[i].name;
            var valueRaw = data[i].value;
            universalParseValue(valueRaw, metricName, deviceId);
          }
        })
        .catch(function (error) {
          console.log(error);
        })
        .finally(function () {
          res();
        });;
    }, 500);
  });
}

(async () => {
  while (true) {
    await monitorMainWattmetter();
    await monitorEvse();
    await monitorSolarEdge();
    await setEvseChargingCurrent();
  }
})();

console.log("App running on port 3000");
module.exports = app;
