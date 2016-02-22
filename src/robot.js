'use strict';

// var Fs = require('fs');
var Log = require('log');
var Path = require('path');
var HttpClient = require('scoped-http-client');
var EventEmitter = require('events').EventEmitter;
// var async = require('async');

var User = require('./user');
var Brain = require('./brain');
var Response = require('./response');
// var ref = require('./listener');
var ref = {Listener: {}, TextListener: {}};
var Listener = ref.Listener;
var TextListener = ref.TextListener;
var ref1 = require('./message');
var EnterMessage = ref1.EnterMessage;
var LeaveMessage = ref1.LeaveMessage;
var TopicMessage = ref1.TopicMessage;
var CatchAllMessage = ref1.CatchAllMessage;
// var Middleware = require('./middleware');
var Middleware = Object;

console.log('Hello webby!');

var WEBBY_DEFAULT_ADAPTERS = [
  'shell'
];

class Robot {
  /**
   * Robots receive messages from a chat source (Campfire, irc, etc), and
   * dispatch them to matching listeners.
   *
   * @params {string} adapterPath -  A String of the path to built-in adapters
   *                                (defaults to src/adapters)
   * @params {string} adapter     - A String of the adapter name.
   * @params {boolean} httpd      - A Boolean whether to enable the HTTP daemon.
   * @params {string} name        - A String of the robot name,
   *                                defaults to Webby.
   *
   * Returns nothing.
   */
  constructor(adapterPath, adapter, httpd, name = 'Webby', alias = false) {
    if (this.adapterPath === undefined) {
      this.adapterPath = '.' + Path.join(__dirname, 'adapters');
    }
    this.name = name;
    this.events = new EventEmitter;
    this.brain = new Brain(this);
    this.alias = alias;
    this.adapter = null;
    this.Response = Response;
    this.commands = [];
    this.listeners = [];
    this.middleware = {
      listener: new Middleware(this),
      response: new Middleware(this),
      receive: new Middleware(this)
    };
    this.logger = new Log(process.env.WEBBY_LOG_LEVEL || 'info');
    this.pingIntervalId = null;
    this.globalHttpOptions = {};
    // this.parseVersion();
    if (httpd) {
      this.setupExpress();
    } else {
      this.setupNullRouter();
    }
    this.loadAdapter(adapter);
    this.adapterName = adapter;
    this.errorHandlers = [];
    this.on('error', (err, res) => {
      this.invokeErrorHandlers(err, res);
    });
    this.onUncaughtException = (err) => {
      return this.emit('error', err);
    };
    process.on('uncaughtException', this.onUncaughtException);
  }

  /**
   * Public: Adds a custom Listener with the provided matcher, options, and
   * callback
   *
   * @params matcher  - A Function that determines whether to call the callback.
   *            Expected to return a truthy value if the callback should be
   *            executed.
   * @params {object} options  - An Object of additional parameters keyed on
   *                             extension name (optional).
   * @params callback - A Function that is called with a Response object if the
   *            matcher function returns true.
   *
   * Returns nothing.
   */
  listen(matcher, options, callback) {
    this.listeners.push(new Listener(this, matcher, options, callback));
  }

  /**
   * Public: Adds a Listener that attempts to match incoming messages based on
   * a Regex.
   *
   * @params {string} regex - A Regex that determines if the callback should be
   *                          called.
   * @params {object} options  - An Object of additional parameters keyed on
   *                             extension name (optional).
   * @params callback - A Function that is called with a Response object.
   *
   * Returns nothing.
   */
  hear(regex, options, callback) {
    this.listeners.push(new TextListener(this, regex, options, callback));
  }

  /**
   * Public: Adds a Listener that attempts to match incoming messages directed
   * at the robot based on a Regex. All regexes treat patterns like they begin
   * with a '^'
   *
   * @params {string} regex - A Regex that determines if the callback
   *                          should be called.
   * @params {object} options - An Object of additional parameters keyed on
   *                            extension name (optional).
   * @params callback - A Function that is called with a Response object.
   *
   * Returns nothing.
   */
  respond(regex, options, callback) {
    this.hear(this.respondPattern(regex), options, callback);
  }

  /**
   * Public: Build a regular expression that matches messages addressed
   * directly to the robot
   *
   * @params {string} regex - A RegExp for the message part that follows the
   *                          robot's name/alias
   *
   * Returns RegExp.
   */
  respondPattern(regex) {
    let re = regex.toString().split('/');
    re.shift();
    let modifiers = re.pop();
    if (re[0] && re[0][0] === '^') {
      this.logger.warning('Anchors don\'t work well with respond, ' +
                          'perhaps you want to use \'hear\'');
      this.logger.warning('The regex in question was ' + regex.toString());
    }
    let pattern = re.join('/');
    let name = this.name.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, '\\$&');
    let newRegex;
    if (this.alias) {
      let alias = this.alias.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, '\\$&');
      let ref = name.length > alias.length ?
        [name, alias] : [alias, name], a = ref[0], b = ref[1];
      newRegex = new RegExp('^\\s*[@]?(?:' + a + '[:,]?|' + b +
        '[:,]?)\\s*(?:' + pattern + ')', modifiers);
    } else {
      newRegex = new RegExp('^\\s*[@]?' + name + '[:,]?\\s*(?:' + pattern + ')',
        modifiers);
    }
    return newRegex;
  }

  /**
   * Public: Adds a Listener that triggers when anyone enters the room.
   *
   * @params {object} options  - An Object of additional parameters keyed on
   *                             extension name (optional).
   * @params callback - A Function that is called with a Response object.
   *
   * Returns nothing.
   */
  enter(options, callback) {
    this.listen(function(msg) {
      return msg instanceof EnterMessage;
    }, options, callback);
  }

  /**
   * Public: Adds a Listener that triggers when anyone leaves the room.
   *
   * @params {object} options  - An Object of additional parameters keyed on
   *                             extension name (optional).
   * @params callback - A Function that is called with a Response object.
   *
   * Returns nothing.
   */
  leave(options, callback) {
    this.listen(function(msg) {
      return msg instanceof EnterMessage;
    }, options, callback);
  }

  /**
   * Public: Adds a Listener that triggers when anyone changes the topic.
   *
   * @params {object} options  - An Object of additional parameters keyed on
   *                             extension name (optional).
   * @params callback - A Function that is called with a Response object.
   *
   * Returns nothing.
   */
  topic(options, callback) {
    this.listen(function(msg) {
      return msg instanceof EnterMessage;
    }, options, callback);
  }

  /**
   * Public: Adds an error handler when an uncaught exception or user emitted
   * error event occurs.
   *
   * @params callback - A Function that is called with the error object.
   *
   * Returns nothing.
   */
  error(callback) {
    this.errorHandlers.push(callback);
  }

  /**
   * Calls and passes any registered error handlers for unhandled exceptions or
   * user emitted error events.
   *
   * @params {object} err - An Error object.
   * @params {object} res - An optional Response object that generated the error
   *
   * Returns nothing.
   */
  invokeErrorHandlers(err, res) {
    this.logger.error(err.stack);
    let results = [];
    this.errorHandlers.forEach(function(errorHandler) {
      try {
        results.push(errorHandler(err, res));
      } catch(error) {
        results.push(this.logger.error('while invoking error handler: ' +
          error + '\n' + error.stack));
      }
    });

    return results;
  }

  /**
   * Public: Adds a Listener that triggers when no other text matchers match.
   *
   * @params {object} options  - An Object of additional parameters keyed on
   *                             extension name (optional).
   * @params callback - A Function that is called with a Response object.
   *
   * Returns nothing.
   */
  catchAll(options, callback) {
    if (callback == null) {
      callback = options;
      options = {};
    }
    this.listen(function(msg) {
      return msg instanceof CatchAllMessage;
    }, options, function(msg) {
      msg.message = msg.message.message;
      return callback(msg);
    });
  }

  /**
   * Public: Registers new middleware for execution after matching but before
   * Listener callbacks
   *
   * @params middleware - A function that determines whether or not a given
   *         matching Listener should be executed.
   *         The function is called with (context, next, done).
   *         If execution should continue (next middleware, Listener callback),
   *         the middleware should call the 'next' function with 'done' as an
   *         argument.
   *         If not, the middleware should call the 'done' function with
   *         no arguments.
   *
   * Returns nothing.
   */
  listenerMiddleware(middleware) {
    this.middleware.listener.register(middleware);
    return void 0;
  }

  /**
   * Public: Registers new middleware for execution as a response to any
   * message is being sent.
   *
   * @params middleware - A function that examines an outgoing message and can
   *         modify it or prevent its sending. The function is called with
   *         (context, next, done). If execution should continue,
   *         the middleware should call next(done). If execution should stop,
   *         the middleware should call done(). To modify the outgoing message,
   *         set context.string to a new message.
   *
   * Returns nothing.
   */
  responseMiddleware(middleware) {
    this.middleware.response.register(middleware);
    return void 0;
  }

  /**
   * Public: Registers new middleware for execution before matching
   *
   * @params middleware - A function that determines whether or not listeners
   *         should be checked.
   *         The function is called with (context, next, done).
   *         If ext, next, done). If execution should continue to the next
   *         middleware or matching phase, it should call the 'next'
   *         function with 'done' as an argument. If not, the middleware
   *         should call the 'done' function with no arguments.
   *
   * Returns nothing.
   */
  receiveMiddleware(middleware) {
    this.middleware.receive.register(middleware);
    return void 0;
  }

  /**
   * Public: Passes the given message to any interested Listeners after running
   *         receive middleware.
   *
   * @params {object} message - A Message instance. Listeners can flag this
   *              message as 'done' to prevent further execution.
   *
   * @params cb - Optional callback that is called when message processing
   *              is complete
   *
   * Returns nothing.
   * Returns before executing callback
   */
  receive(message, cb) {
    // When everything is finished (down the middleware stack and back up),
    // pass control back to the robot
    this.middleware.receive.execute({
      response: new Response(this, message)
    }, this.processListeners.bind(this), cb);
  }

  processListeners(context, done) {
    console.log('processListeners');
  }

  /**
   * Public: Load scripts from packages specified in the
   * `external-scripts.json` file.
   *
   * @params packages - An Array of packages containing hubot scripts to load.
   *
   * Returns nothing.
   */
  loadExternalScripts(packages) {
    this.logger.debug('Loading external-scripts from npm packages');
    try {
      if (packages instanceof Array) {
        let results = [];
        packages.forEach(function(pkg) {
          results.push(require(pkg)(this));
        });
        return results;
      } else {
        let results1;
        for (let pkg in packages) {
          if(packages.hasOwnProperty(pkg)) {
            results1.push(require(pkg)(this, packages[pkg]));
          }
        }
        return results1;
      }
    } catch(error) {
      this.logger.error('Error loading scripts from npm package - ' +
        error.stack);
      process.exit(1);
    }
  }

  /**
   * Setup the Express server's defaults.
   *
   * Returns nothing.
   */
  setupExpress() {
    let user = process.env.EXPRESS_USER;
    let pass = process.env.EXPRESS_PASSWORD;
    let stat = process.env.EXPRESS_STATIC;
    let port = process.env.EXPRESS_PORT || process.env.PORT || 8080;
    let address = process.env.EXPRESS_BIND_ADDRESS ||
      process.env.BIND_ADDRESS || '0.0.0.0';
    let express = require('express');
    let multipart = require('connect-multiparty');
    let app = express();
    app.use((req, res, next) => {
      res.setHeader('X-Powered-By', 'webby/' + this.name);
      next();
    });
    if (user && pass) {
      app.use(express.basicAuth(user, pass));
    }
    app.use(express.query());
    app.use(express.json());
    app.use(express.urlencoded());
    app.use(multipart({
      maxFilesSize: 100 * 1024 * 1024
    }));
    if (stat) {
      app.use(express.static(stat));
    }
    try {
      this.server = app.listen(port, address);
      this.router = app;
    } catch(error) {
      this.logger.error('Error trying to start HTTP server: ' + error + '\n' +
        error.stack);
      process.exit(1);
    }
  }

  /**
   * Setup an empty router object
   *
   * returns nothing
   */
  setupNullRouter() {
    let msg = 'A script has tried registering a HTTP route while the HTTP ' +
          'server is disabled with --disabled-httpd.';
    this.router = {
      get: () => {
        return this.logger.warning(msg);
      },
      post: () => {
        return this.logger.warning(msg);
      },
      put: () => {
        return this.logger.warning(msg);
      },
      delete: () => {
        return this.logger.warning(msg);
      }
    };
  }

  /**
   * Load the adapter Hubot is going to use.
   *
   * @params {string} path    - A String of the path to adapter if local.
   * @params {string} adapter - A String of the adapter name to use.
   *
   * Returns nothing.
   */
  loadAdapter(adapter) {
    this.logger.debug('Loading adapter ' + adapter);
    try {
      // require('./adapters/shell');
      let path = WEBBY_DEFAULT_ADAPTERS.indexOf(adapter) >= 0 ?
        this.adapterPath + '/' + adapter : 'hubot-' + adapter;
      this.adapter = require(path).use(this);
    } catch (error) {
      this.logger.error('Cannot load adapter ' + adapter + ' - ' + error);
      process.exit(1);
    }
  }

  /**
   * Public: A helper send function which delegates to the adapter's send
   * function.
   *
   * @params {object} user    - A User instance.
   * @params {...string} strings - One or more Strings for each message to send.
   *
   * Returns nothing.
   */
  send(user, ...strings) {
    this.adapter.send(user, ...strings);
  }

  /**
   * Public: A helper reply function which delegates to the adapter's reply
   * function.
   *
   * @params {object} user    - A User instance.
   * @params {...string} strings - One or more Strings for each message to send.
   *
   * Returns nothing.
   */
  reply(user, ...strings) {
    this.adapter.reply(user, ...strings);
  }

  /**
   * Public: A helper send function to message a room that the robot is in.
   *
   * @params {string} room    - String designating the room to message.
   * @params {...string} strings - One or more Strings for each message to send.
   *
   * Returns nothing.
   */
  messageRoom(room, ...strings) {
    let user = {room: room};
    this.adapter.send(user, ...strings);
  }

  /**
   * Public: A wrapper around the EventEmitter API to make usage
   * semantically better.
   *
   * @params {string} event    - The event name.
   * @params {object} listener - A Function that is called with the
   *                             event parameter when event happens.
   *
   * Returns nothing.
   */
  on(event, ...args) {
    this.events.on(event, ...args);
  }

  /**
   * Public: A wrapper around the EventEmitter API to make usage
   * semantically better.
   *
   * @params {string} event   - The event name.
   * @params {string[]} args... - Arguments emitted by the event
   *
   * Returns nothing.
   */
  emit(event, ...args) {
    this.events.emit(event, ...args);
  }

  /**
   * Public: Kick off the event loop for the adapter
   *
   * Returns nothing.
   */
  run() {
    this.emit('running');
    this.adapter.run();
  }

  /**
   * Public: Gracefully shutdown the robot process
   *
   * Returns nothing.
   */
  shutdown() {
    if (this.pingIntervalId != null) {
      clearInterval(this.pingIntervalId);
    }
    process.removeListener('uncaughtException', this.onUncaughtException);
    this.adapter.close();
    this.brain.close();
  }

  /**
   * Public: The version of Webby from npm
   *
   * Returns a String of the version number.
   */
  parseVersion() {
    let pkg = require(Path.join(__dirname, '..', 'package.json'));
    this.version = pkg.version;
  }

  /**
   * Public: Creates a scoped http client with chainable methods for
   * modifying the request. This doesn't actually make a request though.
   * Once your request is assembled, you can call `get()`/`post()`/etc to
   * send the request.
   *
   * @params {string} url - String URL to access.
   * @params {object[]} options - Optional options to pass on to the client
   *
   * Examples:
   *
   *     robot.http("http://example.com")
   *       # set a single header
   *       .header('Authorization', 'bearer abcdef')
   *
   *       # set multiple headers
   *       .headers(Authorization: 'bearer abcdef', Accept: 'application/json')
   *
   *       # add URI query parameters
   *       .query(a: 1, b: 'foo & bar')
   *
   *       # make the actual request
   *       .get() (err, res, body) ->
   *         console.log body
   *
   *       # or, you can POST data
   *       .post(data) (err, res, body) ->
   *         console.log body
   *
   *    # Can also set options
   *    robot.http("https://example.com", {rejectUnauthorized: false})
   *
   * Returns a ScopedClient instance.
   */
  http(url, options) {
    return HttpClient.create(url, this.extend({}, this.globalHttpOptions,
      options)).header('User-Agent', 'Webby/' + this.version);
  }

  /**
   * Private: Extend obj with objects passed as additional args.
   *
   * Returns the original object with updated changes.
   */
  extend(obj, ...sources) {
    for (let source in sources) {
      if (sources.hasOwnProperty(source)) {
        for (let key in source) {
          if (source.hasOwnProperty(key)) {
            obj[key] = source[key];
          }
        }
      }
    }
    return obj;
  }
}

module.exports = Robot;
