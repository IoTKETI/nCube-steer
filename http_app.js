/**
 * Copyright (c) 2018, OCEAN
 * All rights reserved.
 * Redistribution and use in source and binary forms, with or without modification, are permitted provided that the following conditions are met:
 * 1. Redistributions of source code must retain the above copyright notice, this list of conditions and the following disclaimer.
 * 2. Redistributions in binary form must reproduce the above copyright notice, this list of conditions and the following disclaimer in the documentation and/or other materials provided with the distribution.
 * 3. The name of the author may not be used to endorse or promote products derived from this software without specific prior written permission.
 * THIS SOFTWARE IS PROVIDED BY THE AUTHOR ``AS IS'' AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
 */

/**
 * Created by ryeubi on 2015-08-31.
 */

var http = require('http');
var express = require('express');
var fs = require('fs');
var mqtt = require('mqtt');
var util = require('util');
var url = require('url');
var ip = require('ip');
var shortid = require('shortid');
var moment = require('moment');

global.sh_adn = require('./http_adn');
var noti = require('./noti');
var tas_mav = require('./thyme_tas_mav');
//var tas_sec = require('./thyme_tas_sec');
//var tas_mission = require('./thyme_tas_mission');


var HTTP_SUBSCRIPTION_ENABLE = 0;
var MQTT_SUBSCRIPTION_ENABLE = 0;

global.my_gcs_name = '';
global.my_parent_cnt_name = '';
global.my_cnt_name = '';
global.pre_my_cnt_name = '';
global.my_mission_parent = '';
global.my_mission_name = '';
global.lte_parent_mission_name = '';
global.lte_mission_name = '';
global.my_sortie_name = 'disarm';

global.my_drone_type = 'pixhawk';
global.my_secure = 'off';

global.Req_auth = '';
global.Res_auth = '';
global.Result_auth = '';
global.Certification = '';

const retry_interval = 2500;
const normal_interval = 100;

global.authResult = 'yet';

var app = express();

//app.use(bodyParser.urlencoded({ extended: true }));
//app.use(bodyParser.json());
//app.use(bodyParser.json({ type: 'application/*+json' }));
//app.use(bodyParser.text({ type: 'application/*+xml' }));

// ?????? ????????.
var server = null;
var noti_topic = '';
var gcs_noti_topic = '';

// ready for mqtt
for(var i = 0; i < conf.sub.length; i++) {
    if(conf.sub[i].name != null) {
        if(url.parse(conf.sub[i].nu).protocol === 'http:') {
            HTTP_SUBSCRIPTION_ENABLE = 1;
            if(url.parse(conf.sub[i]['nu']).hostname === 'autoset') {
                conf.sub[i]['nu'] = 'http://' + ip.address() + ':' + conf.ae.port + url.parse(conf.sub[i]['nu']).pathname;
            }
        }
        else if(url.parse(conf.sub[i].nu).protocol === 'mqtt:') {
            MQTT_SUBSCRIPTION_ENABLE = 1;
        }
        else {
            //console.log('notification uri of subscription is not supported');
            //process.exit();
        }
    }
}

var return_count = 0;
var request_count = 0;

function ready_for_notification() {
    if(HTTP_SUBSCRIPTION_ENABLE == 1) {
        server = http.createServer(app);
        server.listen(conf.ae.port, function () {
            console.log('http_server running at ' + conf.ae.port + ' port');
        });
    }

    if(MQTT_SUBSCRIPTION_ENABLE == 1) {
        for(var i = 0; i < conf.sub.length; i++) {
            if (conf.sub[i].name != null) {
                if (url.parse(conf.sub[i].nu).protocol === 'mqtt:') {
                    if (url.parse(conf.sub[i]['nu']).hostname === 'autoset') {
                        conf.sub[i]['nu'] = 'mqtt://' + conf.cse.host + '/' + conf.ae.id;
                        noti_topic = util.format('/oneM2M/req/+/%s/#', conf.ae.id);
                    }
                    else if (url.parse(conf.sub[i]['nu']).hostname === conf.cse.host) {
                        noti_topic = util.format('/oneM2M/req/+/%s/#', conf.ae.id);
                    }
                    else {
                        noti_topic = util.format('%s', url.parse(conf.sub[i].nu).pathname);
                    }
                }
            }
        }
        mqtt_connect(conf.cse.host, noti_topic);
    }
}

function ae_response_action(status, res_body, callback) {
    var aeid = res_body['m2m:ae']['aei'];
    conf.ae.id = aeid;
    callback(status, aeid);
}

function create_cnt_all(count, callback) {
    if(conf.cnt.length == 0) {
        callback(2001, count);
    }
    else {
        if(conf.cnt.hasOwnProperty(count)) {
            var parent = conf.cnt[count].parent;
            var rn = conf.cnt[count].name;
            sh_adn.crtct(parent, rn, count, function (rsc, res_body, count) {
                if (rsc == 5106 || rsc == 2001 || rsc == 4105) {
                    create_cnt_all(++count, function (status, count) {
                        callback(status, count);
                    });
                }
                else {
                    callback(9999, count);
                }
            });
        }
        else {
            callback(2001, count);
        }
    }
}

function delete_sub_all(count, callback) {
    if(conf.sub.length == 0) {
        callback(2001, count);
    }
    else {
        if(conf.sub.hasOwnProperty(count)) {
            var target = conf.sub[count].parent + '/' + conf.sub[count].name;
            sh_adn.delsub(target, count, function (rsc, res_body, count) {
                if (rsc == 5106 || rsc == 2002 || rsc == 2000 || rsc == 4105 || rsc == 4004) {
                    delete_sub_all(++count, function (status, count) {
                        callback(status, count);
                    });
                }
                else {
                    callback(9999, count);
                }
            });
        }
        else {
            callback(2001, count);
        }
    }
}

function create_sub_all(count, callback) {
    if(conf.sub.length == 0) {
        callback(2001, count);
    }
    else {
        if(conf.sub.hasOwnProperty(count)) {
            var parent = conf.sub[count].parent;
            var rn = conf.sub[count].name;
            var nu = conf.sub[count].nu;
            sh_adn.crtsub(parent, rn, nu, count, function (rsc, res_body, count) {
                if (rsc == 5106 || rsc == 2001 || rsc == 4105) {
                    create_sub_all(++count, function (status, count) {
                        callback(status, count);
                    });
                }
                else {
                    callback('9999', count);
                }
            });
        }
        else {
            callback(2001, count);
        }
    }
}

global.target_sub_topic = [];
global.target_selected = 0;
global.target_pub_topic = [];
global.target_system_id = [];
function retrieve_my_cnt_name(callback) {
    sh_adn.rtvct('/Mobius/UTM/steer/'+conf.ae.name+'/la', 0, function (rsc, res_body, count) {
        if(rsc == 2000) {
            var steer_info = res_body[Object.keys(res_body)[0]].con;
            console.log(steer_info);

            var target_gcs = 'UTM_UVARC';
            if(steer_info.hasOwnProperty('gcs')) {
                target_gcs = steer_info.gcs;
            }

            if(steer_info.hasOwnProperty('target')) {
                for(var sel in steer_info.target) {
                    if(steer_info.target.hasOwnProperty(sel)) {
                        target_sub_topic[sel] = '/Mobius/' + target_gcs + '/Drone_Data/' + steer_info.target[sel] + '/#';
                        target_pub_topic[sel] = '/Mobius/' + target_gcs + '/GCS_Data/' + steer_info.target[sel];
                    }
                }
            }
            
            if(steer_info.hasOwnProperty('system_id')) {
                for(var sel in steer_info.system_id) {
                    if(steer_info.system_id.hasOwnProperty(sel)) {
                        target_system_id[sel] = steer_info.system_id[sel];
                    }
                }
            }
            //console.log(target_sub_topic);
            console.log(target_system_id[0]);

/*
            conf.cnt = [];

            my_gcs_name = steer_info.gcs;

            var info = {};
            info.parent = '/Mobius/' + steer_info.gcs;
            info.name = 'Drone_Data';
            conf.cnt.push(JSON.parse(JSON.stringify(info)));

            info.parent = '/Mobius/' + steer_info.gcs;
            info.name = 'Mission_Data';
            conf.cnt.push(JSON.parse(JSON.stringify(info)));

            info.parent = '/Mobius/' + steer_info.gcs + '/Drone_Data';
            info.name = steer_info.drone;
            conf.cnt.push(JSON.parse(JSON.stringify(info)));

            // set container and subscription for security
            info.parent = '/Mobius/' + steer_info.gcs + '/Drone_Data/' + steer_info.drone;
            info.name = 'Req_auth';
            conf.cnt.push(JSON.parse(JSON.stringify(info)));
            Req_auth = info.parent + '/' + info.name;

            info.parent = Req_auth;
            info.name = 'sub_auth';
            info.nu = 'mqtt://' + conf.cse.host + '/Sutm_auth?ct=json';
            conf.sub.push(JSON.parse(JSON.stringify(info)));

            info.parent = '/Mobius/' + steer_info.gcs + '/Drone_Data/' + steer_info.drone;
            info.name = 'Res_auth';
            conf.cnt.push(JSON.parse(JSON.stringify(info)));
            Res_auth = info.parent + '/' + info.name;

            info.parent = Res_auth;
            info.name = 'sub_auth';
            info.nu = 'mqtt://' + conf.cse.host + '/' + conf.ae.id + '?ct=json';
            conf.sub.push(JSON.parse(JSON.stringify(info)));

            info.parent = '/Mobius/' + steer_info.gcs + '/Drone_Data/' + steer_info.drone;
            info.name = 'Result_auth';
            conf.cnt.push(JSON.parse(JSON.stringify(info)));
            Result_auth = info.parent + '/' + info.name;

            info.parent = '/Mobius/' + steer_info.gcs + '/Drone_Data/' + steer_info.drone;
            info.name = 'Certification';
            conf.cnt.push(JSON.parse(JSON.stringify(info)));
            Certification = info.parent + '/' + info.name;

            info.parent = '/Mobius/' + steer_info.gcs + '/Drone_Data/' + steer_info.drone;
            info.name = my_sortie_name;
            conf.cnt.push(JSON.parse(JSON.stringify(info)));

            my_parent_cnt_name = info.parent;
            my_cnt_name = my_parent_cnt_name + '/' + info.name;

            // sh_adn.del_resource(my_cnt_name, function () {
            //     console.log('delete container named disarm of drone');
            // });

            info.parent = '/Mobius/' + steer_info.gcs + '/Mission_Data';
            info.name = steer_info.drone;
            conf.cnt.push(JSON.parse(JSON.stringify(info)));

            // default mission
            info.parent = '/Mobius/' + steer_info.gcs + '/Mission_Data/' + steer_info.drone;
            info.name = 'LTE';
            conf.cnt.push(JSON.parse(JSON.stringify(info)));

            lte_parent_mission_name = info.parent + '/' + info.name;
            lte_mission_name = lte_parent_mission_name + '/disarm';

            // sh_adn.del_resource(lte_mission_name, function () {
            //     console.log('delete container named disarm of mission');
            // });

            info.parent = lte_parent_mission_name;
            info.name = 'disarm';
            conf.cnt.push(JSON.parse(JSON.stringify(info)));

            if(steer_info.hasOwnProperty('mission')) {
                info.parent = '/Mobius/' + steer_info.gcs + '/Mission_Data/' + steer_info.drone;
                info.name = steer_info.mission;
                conf.cnt.push(JSON.parse(JSON.stringify(info)));

                my_mission_parent = '/Mobius/' + steer_info.gcs + '/Mission_Data/' + steer_info.drone;
                my_mission_name = steer_info.mission;
            }
            else {
                my_mission_parent = '';
                my_mission_name = '';
            }

            if(my_mission_name === 'micro') {
                info.parent = my_mission_parent + '/' + my_mission_name;
                info.name = 'sub_micro';
                info.nu = 'mqtt://' + conf.cse.host + '/' + conf.ae.id + '?ct=json';
                conf.sub.push(JSON.parse(JSON.stringify(info)));
            }

            if(steer_info.hasOwnProperty('mav_ver')) {
                mav_ver = steer_info.mav_ver;
            }
            else {
                mav_ver = 1;
            }

            if(steer_info.hasOwnProperty('type')) {
                my_drone_type = steer_info.type;
            }
            else {
                my_drone_type = 'pixhawk';
            }

            if(steer_info.hasOwnProperty('secure')) {
                my_secure = steer_info.secure;
            }
            else {
                my_secure = 'off';
            }
*/
            gcs_noti_topic = '/Mobius/' + my_gcs_name + '/GCS_Data/' + steer_info.drone;
            callback('200');
        }
        else {
            console.log('x-m2m-rsc : ' + rsc + ' <----' + res_body);
            callback('404');
        }
    });
}

function http_watchdog() {
    if (sh_state === 'crtae') {
        console.log('[sh_state] : ' + sh_state);
        sh_adn.crtae(conf.ae.parent, conf.ae.name, conf.ae.appid, function (status, res_body) {
            console.log(res_body);
            if (status == 2001) {
                ae_response_action(status, res_body, function (status, aeid) {
                    console.log('x-m2m-rsc : ' + status + ' - ' + aeid + ' <----');
                    sh_state = 'rtvae';
                    request_count = 0;
                    return_count = 0;

                    setTimeout(http_watchdog, normal_interval);
                });
            }
            else if (status == 5106 || status == 4105) {
                console.log('x-m2m-rsc : ' + status + ' <----');
                sh_state = 'rtvae';

                setTimeout(http_watchdog, normal_interval);
            }
            else {
                console.log('x-m2m-rsc : ' + status + ' <----');
                setTimeout(http_watchdog, retry_interval);
            }
        });
    }
    else if (sh_state === 'rtvae') {
        if (conf.ae.id === 'S') {
            conf.ae.id = 'S' + shortid.generate();
        }

        console.log('[sh_state] : ' + sh_state);
        sh_adn.rtvae(conf.ae.parent + '/' + conf.ae.name, function (status, res_body) {
            if (status == 2000) {
                var aeid = res_body['m2m:ae']['aei'];
                console.log('x-m2m-rsc : ' + status + ' - ' + aeid + ' <----');

                if(conf.ae.id != aeid && conf.ae.id != ('/'+aeid)) {
                    console.log('AE-ID created is ' + aeid + ' not equal to device AE-ID is ' + conf.ae.id);
                }
                else {
                    sh_state = 'rtvct';
                    request_count = 0;
                    return_count = 0;

                    setTimeout(http_watchdog, normal_interval);
                }
            }
            else {
                console.log('x-m2m-rsc : ' + status + ' <----');
                setTimeout(http_watchdog, retry_interval);
            }
        });
    }
    else if(sh_state === 'rtvct') {
        retrieve_my_cnt_name(function (code) {
            if(code == '200') {
                MQTT_SUBSCRIPTION_ENABLE = 1;
                sh_state = 'crtct';
                setTimeout(http_watchdog, normal_interval);
            }
            else {
                setTimeout(http_watchdog, retry_interval);
            }
        });
    }
    else if (sh_state === 'crtct') {
        console.log('[sh_state] : ' + sh_state);
        create_cnt_all(request_count, function (status, count) {
            if(status == 9999) {
                setTimeout(http_watchdog, retry_interval);
            }
            else {
                request_count = ++count;
                return_count = 0;
                if (conf.cnt.length <= count) {
                    sh_state = 'delsub';
                    request_count = 0;
                    return_count = 0;

                    setTimeout(http_watchdog, normal_interval);
                }
            }
        });
    }
    else if (sh_state === 'delsub') {
        console.log('[sh_state] : ' + sh_state);
        delete_sub_all(request_count, function (status, count) {
            if(status == 9999) {
                setTimeout(http_watchdog, retry_interval);
            }
            else {
                request_count = ++count;
                return_count = 0;
                if (conf.sub.length <= count) {
                    sh_state = 'crtsub';
                    request_count = 0;
                    return_count = 0;

                    setTimeout(http_watchdog, normal_interval);
                }
            }
        });
    }
    else if (sh_state === 'crtsub') {
        console.log('[sh_state] : ' + sh_state);
        create_sub_all(request_count, function (status, count) {
            if(status == 9999) {
                setTimeout(http_watchdog, retry_interval);
            }
            else {
                request_count = ++count;
                return_count = 0;
                if (conf.sub.length <= count) {
                    sh_state = 'crtci';

                    ready_for_notification();

                    tas_mav.ready();
                    //tas_sec.ready();
                    //tas_mission.ready();

                    console.log('[sh_state] : ' + sh_state);

                    setTimeout(http_watchdog, normal_interval);
                }
            }
        });
    }
    else if (sh_state === 'crtci') {
        //setTimeout(check_rtv_cnt, 10000);
    }
}

setTimeout(http_watchdog, normal_interval);


// for notification
//var xmlParser = bodyParser.text({ type: '*/*' });

function mqtt_connect(serverip, noti_topic) {
    if(mqtt_client == null) {
        if (conf.usesecure === 'disable') {
            var connectOptions = {
                host: serverip,
                port: conf.cse.mqttport,
//              username: 'keti',
//              password: 'keti123',
                protocol: "mqtt",
                keepalive: 10,
//              clientId: serverUID,
                protocolId: "MQTT",
                protocolVersion: 4,
                clean: true,
                reconnectPeriod: 2000,
                connectTimeout: 2000,
                rejectUnauthorized: false
            };
        }
        else {
            connectOptions = {
                host: serverip,
                port: conf.cse.mqttport,
                protocol: "mqtts",
                keepalive: 10,
//              clientId: serverUID,
                protocolId: "MQTT",
                protocolVersion: 4,
                clean: true,
                reconnectPeriod: 2000,
                connectTimeout: 2000,
                key: fs.readFileSync("./server-key.pem"),
                cert: fs.readFileSync("./server-crt.pem"),
                rejectUnauthorized: false
            };
        }

        mqtt_client = mqtt.connect(connectOptions);
    }

    mqtt_client.on('connect', function () {
        if(noti_topic != '') {
            mqtt_client.subscribe(noti_topic);
            console.log('[mqtt_connect] noti_topic : ' + noti_topic);
        }

        if(target_sub_topic.length > 0) {
            mqtt_client.subscribe(target_sub_topic[target_selected]);
            console.log('[mqtt_connect] target_sub_topic[' + target_selected + ']: ' + target_sub_topic[target_selected]);
        }
    });

    mqtt_client.on('message', function (topic, message) {
        if(topic == gcs_noti_topic) {
            tas_mav.gcs_noti_handler(message);
        }
        else {
            if(topic.includes('/oneM2M/req/')) {
                var jsonObj = JSON.parse(message.toString());

                if (jsonObj['m2m:rqp'] == null) {
                    jsonObj['m2m:rqp'] = jsonObj;
                }

                noti.mqtt_noti_action(topic.split('/'), jsonObj);
            }
            else {
            }
        }
    });

    mqtt_client.on('error', function (err) {
        console.log(err.message);
    });
}
