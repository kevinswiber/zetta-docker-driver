var util = require('util');
var Docker = require('dockerode');
var Scout = require('zetta-scout');
var stats = require('docker-stats')
var through = require('through2');
var DockerDevice = require('./docker_device');

var DockerScout = module.exports = function() {
  this._containers = {};
  Scout.call(this);
};
util.inherits(DockerScout, Scout);

DockerScout.prototype.init = function(next) {
  var self = this;
  var docker = new Docker();
  var topTitles = [
    'user', 'pid', 'ppid', 'startTime',
    'cpuPercentage', 'memoryPercentage', 'rss',
    'virtualSize', 'status', 'runningTime', 'command'
  ];

  setInterval(function() {
    docker.listContainers(function(err, containerInfos) {
      if (err) {
        console.error(err.stack);
        return;
      }

      containerInfos.forEach(function(containerInfo) {
        var abbreviatedId = containerInfo.Id.substr(0, 12);
        if (!self._containers.hasOwnProperty(abbreviatedId)) {
          return;
        }
        var container = docker.getContainer(containerInfo.Id);
        var opts = {
          ps_args: '-e -o user,pid,ppid,stime,pcpu,pmem,rss,vsz,stat,time,comm'
        };

        container.top(opts, function(err, data) {
          var known = self._containers[abbreviatedId];
          known.processes = [];
          data.Processes.forEach(function(process) {
            var obj = {};
            for (var i = 0; i < process.length; i++) {
              obj[topTitles[i]] = process[i];
            }
            known.processes.push(obj);
          });
        });
      });
    });
  }, 1000);

  stats({ statsinterval: 1 }).pipe(through.obj(function(chunk, enc, cb) {
    if (Object.keys(self._containers).indexOf(chunk.id) === -1) {
      var query = self.server.where({ type: 'container', containerId: chunk.id });
      self.server.find(query, function(err, result) {
        if (!result.length) {
          var machine = self.discover(DockerDevice, chunk);
          self._containers[chunk.id] = machine;
          return;
        }

        result = result[0];
        var machine = self.provision(result, DockerDevice, chunk);
        self._containers[chunk.id] = machine;
      });
    } else {
      var machine = self._containers[chunk.id];
      machine.update(chunk);
    }
    cb()
  }));

  next();
};
