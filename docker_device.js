var util = require('util');
var Device = require('zetta-device');

var DockerDevice = module.exports = function(obj) {
  Device.call(this);

  this.containerId = obj.id;

  this._name = obj.name;
  this._stats = obj.stats;

  this.memoryLimit = this._stats.memory_stats.limit;

  this._cpuPercentageStream = null;

  this._memoryPercentageStream = null;
  this._memoryUsageStream = null;
  this._memoryWorkingSetStream = null;

  this._networkRxBytesStream = null;
  this._networkTxBytesStream = null;
  this._networkRxErrorsStream = null;
  this._networkTxErrorsStream = null;
};
util.inherits(DockerDevice, Device);

DockerDevice.prototype.init = function(config) {
  var self = this;

  config
    .type('container')
    .name(this._name)
    .stream('cpu.percentage', function(stream) {
      self._cpuPercentageStream = stream;
    })
    .stream('memory.percentage', function(stream) {
      self._memoryPercentageStream = stream;
    })
    .stream('memory.usage', function(stream) {
      self._memoryUsageStream = stream;
    })
    .stream('memory.workingSet', function(stream) {
      self._memoryWorkingSetStream = stream;
    })
    .stream('network.rxBytes', function(stream) {
      self._networkRxBytesStream = stream;
    })
    .stream('network.txBytes', function(stream) {
      self._networkTxBytesStream = stream;
    })
    .stream('network.rxErrors', function(stream) {
      self._networkRxErrorsStream = stream;
    })
    .stream('network.txErrors', function(stream) {
      self._networkTxErrorsStream = stream;
    });
};

DockerDevice.prototype.update = function(obj) {
  this._stats = obj.stats;
  this._calculate();
};

DockerDevice.prototype._calculate = function() {
  var memoryUsage = this._stats.memory_stats.usage;
  var memoryLimit = this._stats.memory_stats.limit;

  this._memoryUsageStream.write(memoryUsage);
  this.memoryLimit = memoryLimit;

  var preCpuTotal = this._stats.precpu_stats.cpu_usage.total_usage;
  var cpuTotal = this._stats.cpu_stats.cpu_usage.total_usage;
  var preCpuSystem = this._stats.precpu_stats.system_cpu_usage;
  var cpuSystem = this._stats.cpu_stats.system_cpu_usage;

  var totalDelta = cpuTotal - preCpuTotal;
  var systemDelta = cpuSystem - preCpuSystem;

  var cpuPercent = 0.0;
  if (totalDelta > 0.0 && systemDelta > 0.0) {
    cpuPercent = (totalDelta / systemDelta) *
      this._stats.cpu_stats.cpu_usage.percpu_usage.length * 100.0;
  }

  this._cpuPercentageStream.write(cpuPercent);

  var memoryPercent = 0;

  if (memoryLimit > 0) {
    memoryPercent = memoryUsage / memoryLimit * 100;
  }

  this._memoryPercentageStream.write(memoryPercent);

  var workingSet = memoryUsage;
  var inactiveAnon = this._stats.memory_stats.stats.total_inactive_anon || 0;
  if (workingSet < inactiveAnon) {
    workingSet = 0;
  } else {
    workingSet -= inactiveAnon;
  }

  var inactiveFile = this._stats.memory_stats.stats.total_inactive_file || 0;
  if (workingSet < inactiveFile) {
    workingSet = 0;
  } else {
    workingSet -= inactiveFile;
  }

  this._memoryWorkingSetStream.write(workingSet);

  this._networkRxBytesStream.write(this._stats.network.rx_bytes);
  this._networkTxBytesStream.write(this._stats.network.tx_bytes);
  this._networkRxErrorsStream.write(this._stats.network.rx_errors);
  this._networkTxErrorsStream.write(this._stats.network.tx_errors);
};
