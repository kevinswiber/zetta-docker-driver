var util = require('util');
var Device = require('zetta-device');

var DockerDevice = module.exports = function(obj) {
  Device.call(this);

  this.containerId = obj.id;
  this.processes = [];

  this._name = obj.name;
  this._stats = obj.stats;

  this.cpu = {
    percentage: this._calculateCpuPercent(),
    usage: {
      total: this._stats.cpu_stats.cpu_usage.total_usage,
      kernel: this._stats.cpu_stats.cpu_usage.usage_in_kernelmode,
      user: this._stats.cpu_stats.cpu_usage.usage_in_usermode,
      cores: this._stats.cpu_stats.cpu_usage.percpu_usage
    }
  };

  this.memory = {
    usage: this._stats.memory_stats.usage,
    limit: this._stats.memory_stats.limit,
    percentage: this._calculateMemoryPercent(),
    workingSet: this._calculateMemoryWorkingSet()
  };

  this._cpuTotalUsageStream = null;
  this._cpuKernelUsageStream = null;
  this._cpuUserUsageStream = null;
  this._cpuPerCoreUsageStreams = [];
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
    .stream('cpu.usagePerSecond', function(stream) {
      self._cpuTotalUsageStream = stream;
    });

  for (var i = 0; i < this.cpu.usage.cores.length; i++) {
    config.stream('cpu.core' + i + '.usagePerSecond', function(stream) {
      self._cpuPerCoreUsageStreams.push(stream);
    });
  }

  config
    .stream('cpu.kernel.usagePerSecond', function(stream) {
      self._cpuKernelUsageStream = stream;
    })
    .stream('cpu.user.usagePerSecond', function(stream) {
      self._cpuUserUsageStream = stream;
    })
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

  this.memory.usage = memoryUsage;
  this._memoryUsageStream.write(memoryUsage);

  this.cpu.usage.total = this._stats.cpu_stats.cpu_usage.total_usage;
  this.cpu.usage.kernel = this._stats.cpu_stats.cpu_usage.usage_in_kernelmode;
  this.cpu.usage.user = this._stats.cpu_stats.cpu_usage.usage_in_usermode;

  this._cpuTotalUsageStream.write(this._calculateCpuTotalUsage());
  this._cpuKernelUsageStream.write(this._calculateCpuKernelUsage());
  this._cpuUserUsageStream.write(this._calculateCpuUserUsage());

  this.cpu.usage.cores = this._stats.cpu_stats.cpu_usage.percpu_usage;
  for (var i = 0; i < this.cpu.usage.cores.length; i++) {
    this._cpuPerCoreUsageStreams[i].write(this._calculatePerCoreUsage(i));
  }

  this.cpu.percentage = this._calculateCpuPercent();
  this._cpuPercentageStream.write(this.cpu.percentage);

  this.memory.percentage = this._calculateMemoryPercent();
  this._memoryPercentageStream.write(this.memory.percentage);

  this.memory.workingSet = this._calculateMemoryWorkingSet();
  this._memoryWorkingSetStream.write(this.memory.workingSet);

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

DockerDevice.prototype._calculateMemoryPercent = function() {
  var memoryUsage = this._stats.memory_stats.usage;
  var memoryLimit = this._stats.memory_stats.limit;

  var memoryPercent = 0;

  if (memoryLimit > 0) {
    memoryPercent = memoryUsage / memoryLimit * 100;
  }

  return memoryPercent;
};

DockerDevice.prototype._calculateMemoryWorkingSet = function() {
  var workingSet = this._stats.memory_stats.usage;
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

  return workingSet;
};

DockerDevice.prototype._calculateCpuPercent = function() {
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

  return cpuPercent;
};

DockerDevice.prototype._calculateCpuTotalUsage = function() {
  var preCpuTotal = this._stats.precpu_stats.cpu_usage.total_usage;
  var cpuTotal = this._stats.cpu_stats.cpu_usage.total_usage;

  var delta = cpuTotal - preCpuTotal;

  return delta / 1e+9;
};

DockerDevice.prototype._calculateCpuKernelUsage = function() {
  var preCpuKernel = this._stats.precpu_stats.cpu_usage.usage_in_kernelmode;
  var cpuKernel = this._stats.cpu_stats.cpu_usage.usage_in_kernelmode;

  var delta = cpuKernel - preCpuKernel;

  return delta / 1e+9;
};

DockerDevice.prototype._calculateCpuUserUsage = function() {
  var preCpuUser = this._stats.precpu_stats.cpu_usage.usage_in_usermode;
  var cpuUser = this._stats.cpu_stats.cpu_usage.usage_in_usermode;

  var delta = cpuUser - preCpuUser;

  return delta / 1e+9;
};

DockerDevice.prototype._calculatePerCoreUsage = function(index) {
  var prePerCoreUsage = this._stats.precpu_stats.cpu_usage.percpu_usage[index];
  var perCoreUsage = this._stats.cpu_stats.cpu_usage.percpu_usage[index];

  var delta = perCoreUsage - prePerCoreUsage;

  return delta / 1e+9;
};
