var util = require('util');
var Device = require('zetta-device');

var DockerDevice = module.exports = function(obj) {
  Device.call(this);

  this._name = obj.name;
  this._stats = obj.stats;

  this.containerId = obj.id;

  this.cpuPercentage = null;

  this.memoryPercentage = null;
  this.memoryUsage = null;
  this.memoryLimit = null;
  this.memoryWorkingSet = null;

  this.networkRxBytes = null;
  this.networkTxBytes = null;
  this.networkRxErrors = null;
  this.networkTxErrors = null;

  this._calculate();
};
util.inherits(DockerDevice, Device);

DockerDevice.prototype.init = function(config) {
  config
    .type('container')
    .name(this._name)
    .monitor('cpuPercentage')
    .monitor('memoryPercentage')
    .monitor('memoryUsage')
    .monitor('memoryLimit')
    .monitor('memoryWorkingSet')
    .monitor('networkRxBytes')
    .monitor('networkTxBytes')
    .monitor('networkRxErrors')
    .monitor('networkTxErrors');
};

DockerDevice.prototype.update = function(obj) {
  this._stats = obj.stats;
  this._calculate();
};

DockerDevice.prototype._calculate = function() {
  this.memoryUsage = this._stats.memory_stats.usage;
  this.memoryLimit = this._stats.memory_stats.limit;

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

  this.cpuPercentage = cpuPercent;

  var memoryPercent = 0;

  if (this.memoryLimit > 0) {
    memoryPercent = this.memoryUsage / this.memoryLimit * 100;
  }

  this.memoryPercentage = memoryPercent;

  var workingSet = this.memoryUsage;
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

  this.memoryWorkingSet = workingSet;

  this.networkRxBytes = this._stats.network.rx_bytes;
  this.networkTxBytes = this._stats.network.tx_bytes;
  this.networkRxErrors = this._stats.network.rx_errors;
  this.networkTxErrors = this._stats.network.tx_errors;
};
