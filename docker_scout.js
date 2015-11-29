var util = require('util');
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
