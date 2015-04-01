var DnodeScrubber, DnodeSession, DnodeStore, EventEmitter, Scrubber, createId, exports, getAt, json, parseArgs, setAt, stream, _ref,
  __bind = function(fn, me){ return function(){ return fn.apply(me, arguments); }; },
  __hasProp = {}.hasOwnProperty,
  __extends = function(child, parent) { for (var key in parent) { if (__hasProp.call(parent, key)) child[key] = parent[key]; } function ctor() { this.constructor = child; } ctor.prototype = parent.prototype; child.prototype = new ctor(); child.__super__ = parent.prototype; return child; };

EventEmitter = require('events').EventEmitter;

_ref = require('jspath'), getAt = _ref.getAt, setAt = _ref.setAt;

Scrubber = require('scrubber');

createId = require('hat').rack();

stream = process.title === "browser" ? {} : require("stream");

json = typeof JSON !== "undefined" && JSON !== null ? JSON : require('jsonify');

exports = module.exports = function(wrapper) {
  return {
    sessions: {},
    create: function() {
      var id;
      id = createId();
      return this.sessions[id] = new DnodeSession(id, wrapper);
    },
    destroy: function(id) {
      return delete this.sessions[id];
    }
  };
};


/**
* @class DnodeSession
* @description an implementation of the Session class from dnode-protocol
 */

exports.Session = DnodeSession = (function(_super) {
  var apply;

  __extends(DnodeSession, _super);

  function DnodeSession(id, wrapper) {
    this.id = id;
    this.parse = __bind(this.parse, this);
    this.remote = {};
    this.instance = 'function' === typeof wrapper ? new wrapper(this.remote, this) : wrapper || {};
    this.localStore = new DnodeStore;
    this.remoteStore = new DnodeStore;
    this.localStore.on('cull', (function(_this) {
      return function(id) {
        return _this.emit('request', {
          method: 'cull',
          "arguments": [id],
          callbacks: {}
        });
      };
    })(this));
  }

  DnodeSession.prototype.start = function() {
    return this.request('methods', [this.instance]);
  };

  DnodeSession.prototype.request = function(method, args) {
    var scrubber;
    scrubber = new DnodeScrubber(this.localStore);
    return scrubber.scrub(args, (function(_this) {
      return function() {
        var scrubbed;
        scrubbed = scrubber.toDnodeProtocol();
        scrubbed.method = method;
        return _this.emit('request', scrubbed);
      };
    })(this));
  };

  DnodeSession.prototype.parse = function(line) {
    var err, msg;
    try {
      msg = json.parse(line);
    } catch (_error) {
      err = _error;
      this.emit('error', new SyntaxError("JSON parsing error: " + err));
    }
    return this.handle(msg);
  };

  DnodeSession.prototype.handle = function(msg) {
    var args, method, scrubber;
    scrubber = new DnodeScrubber(this.localStore);
    args = scrubber.unscrub(msg, (function(_this) {
      return function(callbackId) {
        if (!_this.remoteStore.has(callbackId)) {
          _this.remoteStore.add(callbackId, function() {
            return _this.request(callbackId, [].slice.call(arguments));
          });
        }
        return _this.remoteStore.get(callbackId);
      };
    })(this));
    method = msg.method;
    switch (method) {
      case 'methods':
        return this.handleMethods(args[0]);
      case 'error':
        return this.emit('remoteError', args[0]);
      case 'cull':
        return args.forEach((function(_this) {
          return function(id) {
            return _this.remoteStore.cull(id);
          };
        })(this));
      default:
        switch (typeof method) {
          case 'string':
            if (this.instance.propertyIsEnumerable(method)) {
              return apply(this.instance[method], this.instance, args);
            } else {
              return this.emit('error', new Error("Request for non-enumerable method: " + method));
            }
            break;
          case 'number':
            return apply(this.localStore.get(method), this.instance, args);
        }
    }
  };

  DnodeSession.prototype.handleMethods = function(methods) {
    if (methods == null) {
      methods = {};
    }
    Object.keys(this.remote).forEach((function(_this) {
      return function(key) {
        return delete _this.remote[key];
      };
    })(this));
    Object.keys(methods).forEach((function(_this) {
      return function(key) {
        return _this.remote[key] = methods[key];
      };
    })(this));
    this.emit('remote', this.remote);
    return this.emit('ready');
  };

  apply = function(fn, ctx, args) {
    return fn.apply(ctx, args);
  };

  return DnodeSession;

})(EventEmitter);


/**
* @class DnodeScrubber
* @description an implementation of the Scrubber class from dnode-protocol that supports a middleware stack
 */

exports.Scrubber = DnodeScrubber = (function(_super) {
  __extends(DnodeScrubber, _super);

  function DnodeScrubber(store, stack, autoCull) {
    var dnodeMutators, userStack, _ref1;
    if (store == null) {
      store = new DnodeStore;
    }
    if (autoCull == null) {
      autoCull = true;
    }
    this.paths = {};
    this.links = [];
    dnodeMutators = [
      function(cursor) {
        var i, id, node, path;
        node = cursor.node, path = cursor.path;
        if ('function' === typeof node) {
          i = store.indexOf(node);
          if (~i && !(i in this.paths)) {
            this.paths[i] = path;
          } else {
            if (autoCull) {
              node.times = 1;
            }
            id = store.add(node);
            this.paths[id] = path;
          }
          return cursor.update('[Function]', true);
        }
      }
    ];
    userStack = (_ref1 = stack != null ? stack : DnodeScrubber.stack) != null ? _ref1 : [];
    Scrubber.apply(this, dnodeMutators.concat(userStack));
  }

  DnodeScrubber.prototype.unscrub = function(msg, getCallback) {
    var args;
    args = msg["arguments"] || [];
    Object.keys(msg.callbacks || {}).forEach(function(strId) {
      var callback, id, path;
      id = parseInt(strId, 10);
      path = msg.callbacks[id];
      callback = getCallback(id);
      callback.id = id;
      return setAt(args, path, callback);
    });
    (msg.links || []).forEach(function(link) {
      return setAt(args, link.to, getAt(args, link.from));
    });
    return args;
  };

  DnodeScrubber.prototype.toDnodeProtocol = function() {
    var out;
    out = {
      "arguments": this.out
    };
    out.callbacks = this.paths;
    if (this.links.length) {
      out.links = this.links;
    }
    return out;
  };

  return DnodeScrubber;

})(Scrubber);


/**
* @class DnodeStore
* @description an implementation of the Store class from dnode-protocol
 */

exports.Store = DnodeStore = (function(_super) {
  __extends(DnodeStore, _super);

  function DnodeStore() {
    this.items = [];
  }

  DnodeStore.prototype.has = function(id) {
    return this.items[id] != null;
  };

  DnodeStore.prototype.get = function(id) {
    var item;
    item = this.items[id];
    if (item == null) {
      return null;
    }
    return this.wrap(item);
  };

  DnodeStore.prototype.add = function(id, fn) {
    var _ref1;
    if (!fn) {
      _ref1 = [id, fn], fn = _ref1[0], id = _ref1[1];
    }
    if (id == null) {
      id = this.items.length;
    }
    this.items[id] = fn;
    return id;
  };

  DnodeStore.prototype.cull = function(arg) {
    if ('function' === typeof arg) {
      arg = this.items.indexOf(arg);
    }
    delete this.items[arg];
    return arg;
  };

  DnodeStore.prototype.indexOf = function(fn) {
    return this.items.indexOf(fn);
  };

  DnodeStore.prototype.wrap = function(fn) {
    return (function(_this) {
      return function() {
        fn.apply(_this, arguments);
        return _this.autoCull(fn);
      };
    })(this);
  };

  DnodeStore.prototype.autoCull = function(fn) {
    var id;
    if ('number' === typeof fn.times) {
      fn.times--;
      if (fn.times === 0) {
        id = this.cull(fn);
        return this.emit('cull', id);
      }
    }
  };

  return DnodeStore;

})(EventEmitter);

parseArgs = exports.parseArgs = function(argv) {
  var params;
  params = {};
  [].slice.call(argv).forEach(function(arg) {
    switch (typeof arg) {
      case 'string':
        if (arg.match(/^\d+$/)) {
          return params.port = parseInt(arg, 10);
        } else if (arg.match("^/")) {
          return params.path = arg;
        } else {
          return params.host = arg;
        }
        break;
      case 'number':
        return params.port = arg;
      case 'function':
        return params.block = arg;
      case 'object':
        if (arg.__proto__ === Object.prototype) {
          return Object.keys(arg).forEach(function(key) {
            return params[key] = arg[key];
          });
        } else if (stream.Stream && arg instanceof stream.Stream) {
          return params.stream = arg;
        } else {
          return params.server = arg;
        }
        break;
      case 'undefined':
        break;
      default:
        throw new Error('Not sure what to do about ' + typeof arg + ' objects');
    }
  });
  return params;
};
