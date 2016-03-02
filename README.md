# Webbybot

[![Build Status](https://travis-ci.org/gasolin/webby.png)](https://travis-ci.org/gasolin/webbybot) [![Dependency Status](https://david-dm.org/gasolin/webby/dev-status.svg)](https://david-dm.org/gasolin/webbybot)

## Setup Development

```
$ npm install -g mocha
```

## Build

run command

```
$ npm run build
```

## Add plugins

```
$ npm install hubot-calculator
```

Add external-scripts.json file which contain:

```
[
  "hubot-calculator"
]
```

## Run

run command

```
$ node ./bin/webby.js
webby > webby calc 1 + 1
webby > 2
```

## Test

```
$ npm test
```

## Lint
```
$ npm run lint
```
