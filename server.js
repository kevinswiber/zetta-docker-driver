var zetta = require('zetta');
var DockerScout = require('./docker_scout');

zetta()
  .use(DockerScout)
  .listen(3003);
