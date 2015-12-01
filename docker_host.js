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
      kernel: 0,
      user: 0,
      cores: [],
    },
    percentage: 0
  };

  this.memory = {
    usage: 0,
    limit: 0,
    percentage: 0,
    workingSet: 0
  };

  this.networks = {};

  this.platform = null;
  this.architecture = null;

  this._cpuTotalUsageStream = null;
  this._cpuPerCoreUsageStreams = [];
  this._cpuPercentageStream = null;

  this._memoryPercentageStream = null;
  this._memoryUsageStream = null;
  this._memoryWorkingSetStream = null;

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
    })
    .stream('memory.workingSet', function(stream) {
      self._memoryWorkingSetStream = stream;
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

  if (this._lastCpuAverage) {
    this.cpu.percentage = this._calculateCpuPercent();
    this._cpuPercentageStream.write(this.cpu.percentage);
    this._lastCpuAverage = cpuAverage();
  } else {
    this._lastCpuAverage = cpuAverage();
  }

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

  this._calculateCpuStats();
  this._calculateMemoryWorkingSet();
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
  return delta / 1e+9;
};

DockerHost.prototype._calculateCpuPercent = function() {
  var newAverage = cpuAverage();
  var idleDelta = newAverage.idle - this._lastCpuAverage.idle;
  var totalDelta = newAverage.total - this._lastCpuAverage.total;

  return 100.0 - (100.0 * idleDelta / totalDelta);
};

DockerHost.prototype._calculateCpuStats = function() {
  var self = this;

  var rootDir = '/sys/fs/cgroup/cpu';

  fs.readFile(rootDir + '/cpuacct.stat', function(err, data) {
    if (err || !data) {
      return;
    }

    var lines = data.toString().split('\n');
    lines.pop();

    lines.forEach(function(line) {
      var words = line.split(/\s+/);

      var value = padRight(words[1], 13, '0');

      if (words[0] === 'user') {
        self.cpu.usage.user = parseFloat(value);
      } else  if (words[0] === 'system') {
        self.cpu.usage.kernel = parseFloat(value);
      }
    });
  });

  fs.readFile(rootDir + '/cpuacct.usage', function(err, data) {
    if (err || !data) {
      return;
    }

    var value = data.toString().split('\n')[0];
    value = parseFloat(padRight(value, 13, '0'));

    if (self.cpu.usage.total > 0) {
      var delta = value - self.cpu.usage.total;
      self._cpuTotalUsageStream.write(delta / 1e+9);
    }

    self.cpu.usage.total = value;
  });

  fs.readFile(rootDir + '/cpuacct.usage_percpu', function(err, data) {
    if (err || !data) {
      return;
    }

    var lines = data.toString().split('\n');
    lines.pop();
    lines = lines.map(parseFloat);

    for (var i = 0; i < lines.length; i++) {
      self._cpuPerCoreUsageStreams[i].write(self._calculatePerCoreUsage(lines, i));
    }

    self.cpu.usage.cores = lines;
  });
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

DockerHost.prototype._calculateMemoryWorkingSet = function() {
  var self = this;
  var fileName = '/sys/fs/cgroup/memory/memory.stat';

  fs.readFile(fileName, function(err, data) {
    if (err || !data) {
      return;
    }

    var lines = data.toString().split('\n');
    lines.pop();

    var obj = {};
    lines.forEach(function(line) {
      var words = line.split(/\s+/);
      obj[words[0]] = words[1];
    });

    var workingSet = self.memory.usage;
    var inactiveAnon = obj.total_inactive_anon || 0;
    if (workingSet < inactiveAnon) {
      workingSet = 0;
    } else {
      workingSet -= inactiveAnon;
    }

    var inactiveFile = obj.total_inactive_file || 0;
    if (workingSet < inactiveFile) {
      workingSet = 0;
    } else {
      workingSet -= inactiveFile;
    }

    self._memoryWorkingSetStream.write(workingSet);
    self.memory.workingSet = workingSet;
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

function padRight(string, desiredLength, filler) {
  var str = string;

  if (str.length < desiredLength) {
    var diff = desiredLength - str.length;
    for (var i = 0; i < diff; i++) {
      str += filler;
    }
  }

  return str;
}
