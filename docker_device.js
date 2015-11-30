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

  // Default networks to eth0 until support for Docker 1.8/1.9
  this.networks = {
    'eth0': {
      rxBytes: this._stats.network.rx_bytes,
      txBytes: this._stats.network.tx_bytes,
      rxErrors: this._stats.network.rx_errors,
      txErrors: this._stats.network.tx_errors
    }
  };

  this._networkEth0RxBytesStream = null;
  this._networkEth0TxBytesStream = null;
  this._networkEth0RxErrorsStream = null;
  this._networkEth0TxErrorsStream = null;
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
    .stream('networks.eth0.rxBytesPerSecond', function(stream) {
      self._networkEth0RxBytesStream = stream;
    })
    .stream('networks.eth0.txBytesPerSecond', function(stream) {
      self._networkEth0TxBytesStream = stream;
    })
    .stream('networks.eth0.rxErrorsPerSecond', function(stream) {
      self._networkEth0RxErrorsStream = stream;
    })
    .stream('networks.eth0.txErrorsPerSecond', function(stream) {
      self._networkEth0TxErrorsStream = stream;
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

  var newRxBytes = this._stats.network.rx_bytes;
  var newTxBytes = this._stats.network.tx_bytes;
  var newRxErrors = this._stats.network.rx_errors;
  var newTxErrors = this._stats.network.tx_errors;

  var rxBytesDiff = newRxBytes - this.networks.eth0.rxBytes;
  var txBytesDiff = newTxBytes - this.networks.eth0.txBytes;
  var rxErrorsDiff = newRxErrors - this.networks.eth0.rxErrors;
  var txErrorsDiff = newTxErrors - this.networks.eth0.txErrors;

  this._networkEth0RxBytesStream.write(rxBytesDiff);
  this._networkEth0TxBytesStream.write(txBytesDiff);
  this._networkEth0RxErrorsStream.write(rxErrorsDiff);
  this._networkEth0TxErrorsStream.write(txErrorsDiff);

  this.networks.eth0.rxBytes = this._stats.network.rx_bytes;
  this.networks.eth0.txBytes = this._stats.network.tx_bytes;
  this.networks.eth0.rxErrors = this._stats.network.rx_errors;
  this.networks.eth0.txErrors = this._stats.network.tx_errors;
};
