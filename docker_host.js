var fs = require('fs');
var os = require('os');
var util = require('util');
var Device = require('zetta-device');

var DockerHost = module.exports = function() {
  Device.call(this);

  this.hostname = null;
  this.cpu = {
    usage: {
      total: 0,
      cores: [],
    },
    percentage: 0
  };

  this.memory = {
    usage: 0,
    limit: 0,
    percentage: 0 
  };

  this.networks = {};

  this.platform = null;
  this.architecture = null;

  this._cpuTotalUsageStream = null;
  this._cpuPerCoreUsageStreams = [];
  this._cpuPercentageStream = null;

  this._memoryPercentageStream = null;
  this._memoryUsageStream = null;

  this._networkStreams = {};

  this._lastCpuAverage = null;
};
util.inherits(DockerHost, Device);

DockerHost.prototype.init = function(config) {
  var self = this;

  config
    .type('host')
    .name(os.hostname());

  config
    .stream('cpu.usagePerSecond', function(stream) {
      self._cpuTotalUsageStream = stream;
    });

  for (var i = 0; i < os.cpus().length; i++) {
    config.stream('cpu.core' + i + '.usagePerSecond', function(stream) {
      self._cpuPerCoreUsageStreams.push(stream);
    });
  }

  config
    .stream('cpu.percentage', function(stream) {
      this._cpuPercentageStream = stream;
    })
    .stream('memory.percentage', function(stream) {
      self._memoryPercentageStream = stream;
    })
    .stream('memory.usage', function(stream) {
      self._memoryUsageStream = stream;
    });

  var regex = /^(?!veth|docker|lo).*/;
  fs.readdirSync('/sys/class/net').filter(function(dir) {
    return regex.test(dir);
  }).forEach(function(interfaceName) {
    self.networks[interfaceName] = {};
  });

  var networkStreamNames = ['rxBytesPerSecond', 'txBytesPerSecond',
      'rxErrorsPerSecond', 'txErrorsPerSecond'];

  Object.keys(this.networks).forEach(function(key) {
    networkStreamNames.forEach(function(streamName) {
      if (!self._networkStreams.hasOwnProperty(key)) {
        self._networkStreams[key] = {};
      }

      config.stream('networks.' + key + '.' + streamName, function(stream) {
        self._networkStreams[key][streamName] = stream;
      });
    });
  });

  this._calculate();
  setInterval(this._calculate.bind(this), 1000);
};

DockerHost.prototype._calculate = function() {
  this.hostname = os.hostname();

  var cpuTotalUsage = this._calculateCpuTotalUsage();
  if (this.cpu.usage.total > 0) {
    var delta = cpuTotalUsage - this.cpu.usage.total;
    this._cpuTotalUsageStream.write(delta / 1e+4);
  }
  this.cpu.usage.total = cpuTotalUsage;

  var newCpuCores = os.cpus().map(function(core) {
    return core.times.user + core.times.sys;
  });

  if (this.cpu.usage.cores.length) {
    for (var i = 0; i < os.cpus().length; i++) {
      this._cpuPerCoreUsageStreams[i].write(this._calculatePerCoreUsage(newCpuCores, i));
    }
  }

  if (this._lastCpuAverage) {
    this.cpu.percentage = this._calculateCpuPercent();
    this._cpuPercentageStream.write(this.cpu.percentage);
    this._lastCpuAverage = cpuAverage();
  } else {
    this._lastCpuAverage = cpuAverage();
  }

  this.cpu.usage.cores = newCpuCores;

  this.cpu.usage.total = this._calculateCpuTotalUsage();

  this.memory = {
    usage: os.totalmem() - os.freemem(),
    limit: os.totalmem(),
    percentage: os.freemem() / os.totalmem() * 100
  };

  if (this._memoryUsageStream) {
    this._memoryUsageStream.write(this.memory.usage);
  }

  if (this._memoryPercentageStream) {
    this._memoryPercentageStream.write(this.memory.percentage);
  }

  this.platform = os.platform();
  this.architecture = os.arch();

  this._calculateNetworkStats();
};

DockerHost.prototype._calculateCpuTotalUsage = function() {
  return os.cpus().reduce(function(acc, cpu) {
    return acc + cpu.times.user + cpu.times.sys;
  }, 0);
};

DockerHost.prototype._calculatePerCoreUsage = function(newCpuCores, index) {
  var oldCpuCore = this.cpu.usage.cores[index];
  var delta = newCpuCores[index] - oldCpuCore;
  return delta / 1e+4;
};

DockerHost.prototype._calculateCpuPercent = function() {
  var newAverage = cpuAverage();
  var idleDelta = newAverage.idle - this._lastCpuAverage.idle;
  var totalDelta = newAverage.total - this._lastCpuAverage.total;

  return 100.0 - (100.0 * idleDelta / totalDelta);
};

DockerHost.prototype._calculateNetworkStats = function() {
  var self = this;

  var networkNames = Object.keys(this.networks);

  if (!networkNames.length) {
    this.networks = {};
    return;
  }

  networkNames.forEach(function(name) {
    if (!self.networks.hasOwnProperty(name)) {
      self.networks[name] = {
        rxBytes: 0,
        txBytes: 0,
        rxErrors: 0,
        txErrors: 0
      };
    }

    var netDir = '/sys/class/net/' + name + '/statistics';

    fs.readFile(netDir + '/rx_bytes', function(err, data) {
      if (!err && data) {
        var oldData = self.networks[name].rxBytes;
        var newData = data.toString().slice(0, -1);
        var delta = newData - oldData;
        self.networks[name].rxBytes = newData;
        self._networkStreams[name]['rxBytesPerSecond'].write(delta);
      }
    });

    fs.readFile(netDir + '/tx_bytes', function(err, data) {
      if (!err && data) {
        var oldData = self.networks[name].txBytes;
        var newData = data.toString().slice(0, -1);
        var delta = newData - oldData;
        self.networks[name].txBytes = newData;
        self._networkStreams[name]['txBytesPerSecond'].write(delta);
      }
    });

    fs.readFile(netDir + '/rx_errors', function(err, data) {
      if (!err && data) {
        var oldData = self.networks[name].rxErrors;
        var newData = data.toString().slice(0, -1);
        var delta = newData - oldData;
        self.networks[name].rxErrors = newData;
        self._networkStreams[name]['rxErrorsPerSecond'].write(delta);
      }
    });

    fs.readFile(netDir + '/tx_errors', function(err, data) {
      if (!err && data) {
        var oldData = self.networks[name].txErrors;
        var newData = data.toString().slice(0, -1);
        var delta = newData - oldData;
        self.networks[name].txErrors = newData;
        self._networkStreams[name]['txErrorsPerSecond'].write(delta);
      }
    });
  });
};

// From gist: https://gist.github.com/bag-man/5570809
//Create function to get CPU information
function cpuAverage() {

  //Initialise sum of idle and time of cores and fetch CPU info
  var totalIdle = 0, totalTick = 0;
  var cpus = os.cpus();

  //Loop through CPU cores
  for(var i = 0, len = cpus.length; i < len; i++) {

    //Select CPU core
    var cpu = cpus[i];

    //Total up the time in the cores tick
    for(type in cpu.times) {
      totalTick += cpu.times[type];
   }     

    //Total up the idle time of the core
    totalIdle += cpu.times.idle;
  }

  //Return the average Idle and Tick times
  return {idle: totalIdle / cpus.length,  total: totalTick / cpus.length};
}
