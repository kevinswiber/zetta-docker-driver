# zetta-docker-driver

* Monitor Docker containers as Zetta devices
* Supports Docker 1.7 with plans for updated version support

## Install

```
npm install zetta-docker-driver
```

## Usage

```js
var zetta = require('zetta');
var Docker = require('zetta-docker-driver');

zetta()
  .use(Docker)
  .listen(1337);
```
