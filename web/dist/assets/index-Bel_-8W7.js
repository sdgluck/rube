(function () {
  const r = document.createElement("link").relList;
  if (r && r.supports && r.supports("modulepreload")) return;
  for (const h of document.querySelectorAll('link[rel="modulepreload"]')) o(h);
  new MutationObserver((h) => {
    for (const m of h)
      if (m.type === "childList")
        for (const S of m.addedNodes)
          S.tagName === "LINK" && S.rel === "modulepreload" && o(S);
  }).observe(document, { childList: !0, subtree: !0 });
  function s(h) {
    const m = {};
    return (
      h.integrity && (m.integrity = h.integrity),
      h.referrerPolicy && (m.referrerPolicy = h.referrerPolicy),
      h.crossOrigin === "use-credentials"
        ? (m.credentials = "include")
        : h.crossOrigin === "anonymous"
          ? (m.credentials = "omit")
          : (m.credentials = "same-origin"),
      m
    );
  }
  function o(h) {
    if (h.ep) return;
    h.ep = !0;
    const m = s(h);
    fetch(h.href, m);
  }
})();
var Rc = { exports: {} },
  Cu = {};
/**
 * @license React
 * react-jsx-runtime.production.js
 *
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */ var $d;
function Py() {
  if ($d) return Cu;
  $d = 1;
  var f = Symbol.for("react.transitional.element"),
    r = Symbol.for("react.fragment");
  function s(o, h, m) {
    var S = null;
    if (
      (m !== void 0 && (S = "" + m),
      h.key !== void 0 && (S = "" + h.key),
      "key" in h)
    ) {
      m = {};
      for (var M in h) M !== "key" && (m[M] = h[M]);
    } else m = h;
    return (
      (h = m.ref),
      { $$typeof: f, type: o, key: S, ref: h !== void 0 ? h : null, props: m }
    );
  }
  return ((Cu.Fragment = r), (Cu.jsx = s), (Cu.jsxs = s), Cu);
}
var Wd;
function tv() {
  return (Wd || ((Wd = 1), (Rc.exports = Py())), Rc.exports);
}
var ft = tv(),
  Oc = { exports: {} },
  k = {};
/**
 * @license React
 * react.production.js
 *
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */ var kd;
function lv() {
  if (kd) return k;
  kd = 1;
  var f = Symbol.for("react.transitional.element"),
    r = Symbol.for("react.portal"),
    s = Symbol.for("react.fragment"),
    o = Symbol.for("react.strict_mode"),
    h = Symbol.for("react.profiler"),
    m = Symbol.for("react.consumer"),
    S = Symbol.for("react.context"),
    M = Symbol.for("react.forward_ref"),
    E = Symbol.for("react.suspense"),
    v = Symbol.for("react.memo"),
    U = Symbol.for("react.lazy"),
    A = Symbol.for("react.activity"),
    H = Symbol.iterator;
  function G(g) {
    return g === null || typeof g != "object"
      ? null
      : ((g = (H && g[H]) || g["@@iterator"]),
        typeof g == "function" ? g : null);
  }
  var w = {
      isMounted: function () {
        return !1;
      },
      enqueueForceUpdate: function () {},
      enqueueReplaceState: function () {},
      enqueueSetState: function () {},
    },
    Z = Object.assign,
    q = {};
  function V(g, x, j) {
    ((this.props = g),
      (this.context = x),
      (this.refs = q),
      (this.updater = j || w));
  }
  ((V.prototype.isReactComponent = {}),
    (V.prototype.setState = function (g, x) {
      if (typeof g != "object" && typeof g != "function" && g != null)
        throw Error(
          "takes an object of state variables to update or a function which returns an object of state variables.",
        );
      this.updater.enqueueSetState(this, g, x, "setState");
    }),
    (V.prototype.forceUpdate = function (g) {
      this.updater.enqueueForceUpdate(this, g, "forceUpdate");
    }));
  function $() {}
  $.prototype = V.prototype;
  function Y(g, x, j) {
    ((this.props = g),
      (this.context = x),
      (this.refs = q),
      (this.updater = j || w));
  }
  var St = (Y.prototype = new $());
  ((St.constructor = Y), Z(St, V.prototype), (St.isPureReactComponent = !0));
  var mt = Array.isArray;
  function _t() {}
  var F = { H: null, A: null, T: null, S: null },
    Dt = Object.prototype.hasOwnProperty;
  function Xt(g, x, j) {
    var X = j.ref;
    return {
      $$typeof: f,
      type: g,
      key: x,
      ref: X !== void 0 ? X : null,
      props: j,
    };
  }
  function yl(g, x) {
    return Xt(g.type, x, g.props);
  }
  function Ul(g) {
    return typeof g == "object" && g !== null && g.$$typeof === f;
  }
  function kt(g) {
    var x = { "=": "=0", ":": "=2" };
    return (
      "$" +
      g.replace(/[=:]/g, function (j) {
        return x[j];
      })
    );
  }
  var Ce = /\/+/g;
  function jl(g, x) {
    return typeof g == "object" && g !== null && g.key != null
      ? kt("" + g.key)
      : x.toString(36);
  }
  function Rl(g) {
    switch (g.status) {
      case "fulfilled":
        return g.value;
      case "rejected":
        throw g.reason;
      default:
        switch (
          (typeof g.status == "string"
            ? g.then(_t, _t)
            : ((g.status = "pending"),
              g.then(
                function (x) {
                  g.status === "pending" &&
                    ((g.status = "fulfilled"), (g.value = x));
                },
                function (x) {
                  g.status === "pending" &&
                    ((g.status = "rejected"), (g.reason = x));
                },
              )),
          g.status)
        ) {
          case "fulfilled":
            return g.value;
          case "rejected":
            throw g.reason;
        }
    }
    throw g;
  }
  function D(g, x, j, X, I) {
    var lt = typeof g;
    (lt === "undefined" || lt === "boolean") && (g = null);
    var st = !1;
    if (g === null) st = !0;
    else
      switch (lt) {
        case "bigint":
        case "string":
        case "number":
          st = !0;
          break;
        case "object":
          switch (g.$$typeof) {
            case f:
            case r:
              st = !0;
              break;
            case U:
              return ((st = g._init), D(st(g._payload), x, j, X, I));
          }
      }
    if (st)
      return (
        (I = I(g)),
        (st = X === "" ? "." + jl(g, 0) : X),
        mt(I)
          ? ((j = ""),
            st != null && (j = st.replace(Ce, "$&/") + "/"),
            D(I, x, j, "", function (ja) {
              return ja;
            }))
          : I != null &&
            (Ul(I) &&
              (I = yl(
                I,
                j +
                  (I.key == null || (g && g.key === I.key)
                    ? ""
                    : ("" + I.key).replace(Ce, "$&/") + "/") +
                  st,
              )),
            x.push(I)),
        1
      );
    st = 0;
    var $t = X === "" ? "." : X + ":";
    if (mt(g))
      for (var Ct = 0; Ct < g.length; Ct++)
        ((X = g[Ct]), (lt = $t + jl(X, Ct)), (st += D(X, x, j, lt, I)));
    else if (((Ct = G(g)), typeof Ct == "function"))
      for (g = Ct.call(g), Ct = 0; !(X = g.next()).done; )
        ((X = X.value), (lt = $t + jl(X, Ct++)), (st += D(X, x, j, lt, I)));
    else if (lt === "object") {
      if (typeof g.then == "function") return D(Rl(g), x, j, X, I);
      throw (
        (x = String(g)),
        Error(
          "Objects are not valid as a React child (found: " +
            (x === "[object Object]"
              ? "object with keys {" + Object.keys(g).join(", ") + "}"
              : x) +
            "). If you meant to render a collection of children, use an array instead.",
        )
      );
    }
    return st;
  }
  function B(g, x, j) {
    if (g == null) return g;
    var X = [],
      I = 0;
    return (
      D(g, X, "", "", function (lt) {
        return x.call(j, lt, I++);
      }),
      X
    );
  }
  function W(g) {
    if (g._status === -1) {
      var x = g._result;
      ((x = x()),
        x.then(
          function (j) {
            (g._status === 0 || g._status === -1) &&
              ((g._status = 1), (g._result = j));
          },
          function (j) {
            (g._status === 0 || g._status === -1) &&
              ((g._status = 2), (g._result = j));
          },
        ),
        g._status === -1 && ((g._status = 0), (g._result = x)));
    }
    if (g._status === 1) return g._result.default;
    throw g._result;
  }
  var yt =
      typeof reportError == "function"
        ? reportError
        : function (g) {
            if (
              typeof window == "object" &&
              typeof window.ErrorEvent == "function"
            ) {
              var x = new window.ErrorEvent("error", {
                bubbles: !0,
                cancelable: !0,
                message:
                  typeof g == "object" &&
                  g !== null &&
                  typeof g.message == "string"
                    ? String(g.message)
                    : String(g),
                error: g,
              });
              if (!window.dispatchEvent(x)) return;
            } else if (
              typeof process == "object" &&
              typeof process.emit == "function"
            ) {
              process.emit("uncaughtException", g);
              return;
            }
            console.error(g);
          },
    bt = {
      map: B,
      forEach: function (g, x, j) {
        B(
          g,
          function () {
            x.apply(this, arguments);
          },
          j,
        );
      },
      count: function (g) {
        var x = 0;
        return (
          B(g, function () {
            x++;
          }),
          x
        );
      },
      toArray: function (g) {
        return (
          B(g, function (x) {
            return x;
          }) || []
        );
      },
      only: function (g) {
        if (!Ul(g))
          throw Error(
            "React.Children.only expected to receive a single React element child.",
          );
        return g;
      },
    };
  return (
    (k.Activity = A),
    (k.Children = bt),
    (k.Component = V),
    (k.Fragment = s),
    (k.Profiler = h),
    (k.PureComponent = Y),
    (k.StrictMode = o),
    (k.Suspense = E),
    (k.__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE = F),
    (k.__COMPILER_RUNTIME = {
      __proto__: null,
      c: function (g) {
        return F.H.useMemoCache(g);
      },
    }),
    (k.cache = function (g) {
      return function () {
        return g.apply(null, arguments);
      };
    }),
    (k.cacheSignal = function () {
      return null;
    }),
    (k.cloneElement = function (g, x, j) {
      if (g == null)
        throw Error(
          "The argument must be a React element, but you passed " + g + ".",
        );
      var X = Z({}, g.props),
        I = g.key;
      if (x != null)
        for (lt in (x.key !== void 0 && (I = "" + x.key), x))
          !Dt.call(x, lt) ||
            lt === "key" ||
            lt === "__self" ||
            lt === "__source" ||
            (lt === "ref" && x.ref === void 0) ||
            (X[lt] = x[lt]);
      var lt = arguments.length - 2;
      if (lt === 1) X.children = j;
      else if (1 < lt) {
        for (var st = Array(lt), $t = 0; $t < lt; $t++)
          st[$t] = arguments[$t + 2];
        X.children = st;
      }
      return Xt(g.type, I, X);
    }),
    (k.createContext = function (g) {
      return (
        (g = {
          $$typeof: S,
          _currentValue: g,
          _currentValue2: g,
          _threadCount: 0,
          Provider: null,
          Consumer: null,
        }),
        (g.Provider = g),
        (g.Consumer = { $$typeof: m, _context: g }),
        g
      );
    }),
    (k.createElement = function (g, x, j) {
      var X,
        I = {},
        lt = null;
      if (x != null)
        for (X in (x.key !== void 0 && (lt = "" + x.key), x))
          Dt.call(x, X) &&
            X !== "key" &&
            X !== "__self" &&
            X !== "__source" &&
            (I[X] = x[X]);
      var st = arguments.length - 2;
      if (st === 1) I.children = j;
      else if (1 < st) {
        for (var $t = Array(st), Ct = 0; Ct < st; Ct++)
          $t[Ct] = arguments[Ct + 2];
        I.children = $t;
      }
      if (g && g.defaultProps)
        for (X in ((st = g.defaultProps), st))
          I[X] === void 0 && (I[X] = st[X]);
      return Xt(g, lt, I);
    }),
    (k.createRef = function () {
      return { current: null };
    }),
    (k.forwardRef = function (g) {
      return { $$typeof: M, render: g };
    }),
    (k.isValidElement = Ul),
    (k.lazy = function (g) {
      return { $$typeof: U, _payload: { _status: -1, _result: g }, _init: W };
    }),
    (k.memo = function (g, x) {
      return { $$typeof: v, type: g, compare: x === void 0 ? null : x };
    }),
    (k.startTransition = function (g) {
      var x = F.T,
        j = {};
      F.T = j;
      try {
        var X = g(),
          I = F.S;
        (I !== null && I(j, X),
          typeof X == "object" &&
            X !== null &&
            typeof X.then == "function" &&
            X.then(_t, yt));
      } catch (lt) {
        yt(lt);
      } finally {
        (x !== null && j.types !== null && (x.types = j.types), (F.T = x));
      }
    }),
    (k.unstable_useCacheRefresh = function () {
      return F.H.useCacheRefresh();
    }),
    (k.use = function (g) {
      return F.H.use(g);
    }),
    (k.useActionState = function (g, x, j) {
      return F.H.useActionState(g, x, j);
    }),
    (k.useCallback = function (g, x) {
      return F.H.useCallback(g, x);
    }),
    (k.useContext = function (g) {
      return F.H.useContext(g);
    }),
    (k.useDebugValue = function () {}),
    (k.useDeferredValue = function (g, x) {
      return F.H.useDeferredValue(g, x);
    }),
    (k.useEffect = function (g, x) {
      return F.H.useEffect(g, x);
    }),
    (k.useEffectEvent = function (g) {
      return F.H.useEffectEvent(g);
    }),
    (k.useId = function () {
      return F.H.useId();
    }),
    (k.useImperativeHandle = function (g, x, j) {
      return F.H.useImperativeHandle(g, x, j);
    }),
    (k.useInsertionEffect = function (g, x) {
      return F.H.useInsertionEffect(g, x);
    }),
    (k.useLayoutEffect = function (g, x) {
      return F.H.useLayoutEffect(g, x);
    }),
    (k.useMemo = function (g, x) {
      return F.H.useMemo(g, x);
    }),
    (k.useOptimistic = function (g, x) {
      return F.H.useOptimistic(g, x);
    }),
    (k.useReducer = function (g, x, j) {
      return F.H.useReducer(g, x, j);
    }),
    (k.useRef = function (g) {
      return F.H.useRef(g);
    }),
    (k.useState = function (g) {
      return F.H.useState(g);
    }),
    (k.useSyncExternalStore = function (g, x, j) {
      return F.H.useSyncExternalStore(g, x, j);
    }),
    (k.useTransition = function () {
      return F.H.useTransition();
    }),
    (k.version = "19.2.4"),
    k
  );
}
var Fd;
function Yc() {
  return (Fd || ((Fd = 1), (Oc.exports = lv())), Oc.exports);
}
var O = Yc(),
  Mc = { exports: {} },
  Uu = {},
  Dc = { exports: {} },
  Cc = {};
/**
 * @license React
 * scheduler.production.js
 *
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */ var Id;
function ev() {
  return (
    Id ||
      ((Id = 1),
      (function (f) {
        function r(D, B) {
          var W = D.length;
          D.push(B);
          t: for (; 0 < W; ) {
            var yt = (W - 1) >>> 1,
              bt = D[yt];
            if (0 < h(bt, B)) ((D[yt] = B), (D[W] = bt), (W = yt));
            else break t;
          }
        }
        function s(D) {
          return D.length === 0 ? null : D[0];
        }
        function o(D) {
          if (D.length === 0) return null;
          var B = D[0],
            W = D.pop();
          if (W !== B) {
            D[0] = W;
            t: for (var yt = 0, bt = D.length, g = bt >>> 1; yt < g; ) {
              var x = 2 * (yt + 1) - 1,
                j = D[x],
                X = x + 1,
                I = D[X];
              if (0 > h(j, W))
                X < bt && 0 > h(I, j)
                  ? ((D[yt] = I), (D[X] = W), (yt = X))
                  : ((D[yt] = j), (D[x] = W), (yt = x));
              else if (X < bt && 0 > h(I, W))
                ((D[yt] = I), (D[X] = W), (yt = X));
              else break t;
            }
          }
          return B;
        }
        function h(D, B) {
          var W = D.sortIndex - B.sortIndex;
          return W !== 0 ? W : D.id - B.id;
        }
        if (
          ((f.unstable_now = void 0),
          typeof performance == "object" &&
            typeof performance.now == "function")
        ) {
          var m = performance;
          f.unstable_now = function () {
            return m.now();
          };
        } else {
          var S = Date,
            M = S.now();
          f.unstable_now = function () {
            return S.now() - M;
          };
        }
        var E = [],
          v = [],
          U = 1,
          A = null,
          H = 3,
          G = !1,
          w = !1,
          Z = !1,
          q = !1,
          V = typeof setTimeout == "function" ? setTimeout : null,
          $ = typeof clearTimeout == "function" ? clearTimeout : null,
          Y = typeof setImmediate < "u" ? setImmediate : null;
        function St(D) {
          for (var B = s(v); B !== null; ) {
            if (B.callback === null) o(v);
            else if (B.startTime <= D)
              (o(v), (B.sortIndex = B.expirationTime), r(E, B));
            else break;
            B = s(v);
          }
        }
        function mt(D) {
          if (((Z = !1), St(D), !w))
            if (s(E) !== null) ((w = !0), _t || ((_t = !0), kt()));
            else {
              var B = s(v);
              B !== null && Rl(mt, B.startTime - D);
            }
        }
        var _t = !1,
          F = -1,
          Dt = 5,
          Xt = -1;
        function yl() {
          return q ? !0 : !(f.unstable_now() - Xt < Dt);
        }
        function Ul() {
          if (((q = !1), _t)) {
            var D = f.unstable_now();
            Xt = D;
            var B = !0;
            try {
              t: {
                ((w = !1), Z && ((Z = !1), $(F), (F = -1)), (G = !0));
                var W = H;
                try {
                  l: {
                    for (
                      St(D), A = s(E);
                      A !== null && !(A.expirationTime > D && yl());
                    ) {
                      var yt = A.callback;
                      if (typeof yt == "function") {
                        ((A.callback = null), (H = A.priorityLevel));
                        var bt = yt(A.expirationTime <= D);
                        if (((D = f.unstable_now()), typeof bt == "function")) {
                          ((A.callback = bt), St(D), (B = !0));
                          break l;
                        }
                        (A === s(E) && o(E), St(D));
                      } else o(E);
                      A = s(E);
                    }
                    if (A !== null) B = !0;
                    else {
                      var g = s(v);
                      (g !== null && Rl(mt, g.startTime - D), (B = !1));
                    }
                  }
                  break t;
                } finally {
                  ((A = null), (H = W), (G = !1));
                }
                B = void 0;
              }
            } finally {
              B ? kt() : (_t = !1);
            }
          }
        }
        var kt;
        if (typeof Y == "function")
          kt = function () {
            Y(Ul);
          };
        else if (typeof MessageChannel < "u") {
          var Ce = new MessageChannel(),
            jl = Ce.port2;
          ((Ce.port1.onmessage = Ul),
            (kt = function () {
              jl.postMessage(null);
            }));
        } else
          kt = function () {
            V(Ul, 0);
          };
        function Rl(D, B) {
          F = V(function () {
            D(f.unstable_now());
          }, B);
        }
        ((f.unstable_IdlePriority = 5),
          (f.unstable_ImmediatePriority = 1),
          (f.unstable_LowPriority = 4),
          (f.unstable_NormalPriority = 3),
          (f.unstable_Profiling = null),
          (f.unstable_UserBlockingPriority = 2),
          (f.unstable_cancelCallback = function (D) {
            D.callback = null;
          }),
          (f.unstable_forceFrameRate = function (D) {
            0 > D || 125 < D
              ? console.error(
                  "forceFrameRate takes a positive int between 0 and 125, forcing frame rates higher than 125 fps is not supported",
                )
              : (Dt = 0 < D ? Math.floor(1e3 / D) : 5);
          }),
          (f.unstable_getCurrentPriorityLevel = function () {
            return H;
          }),
          (f.unstable_next = function (D) {
            switch (H) {
              case 1:
              case 2:
              case 3:
                var B = 3;
                break;
              default:
                B = H;
            }
            var W = H;
            H = B;
            try {
              return D();
            } finally {
              H = W;
            }
          }),
          (f.unstable_requestPaint = function () {
            q = !0;
          }),
          (f.unstable_runWithPriority = function (D, B) {
            switch (D) {
              case 1:
              case 2:
              case 3:
              case 4:
              case 5:
                break;
              default:
                D = 3;
            }
            var W = H;
            H = D;
            try {
              return B();
            } finally {
              H = W;
            }
          }),
          (f.unstable_scheduleCallback = function (D, B, W) {
            var yt = f.unstable_now();
            switch (
              (typeof W == "object" && W !== null
                ? ((W = W.delay),
                  (W = typeof W == "number" && 0 < W ? yt + W : yt))
                : (W = yt),
              D)
            ) {
              case 1:
                var bt = -1;
                break;
              case 2:
                bt = 250;
                break;
              case 5:
                bt = 1073741823;
                break;
              case 4:
                bt = 1e4;
                break;
              default:
                bt = 5e3;
            }
            return (
              (bt = W + bt),
              (D = {
                id: U++,
                callback: B,
                priorityLevel: D,
                startTime: W,
                expirationTime: bt,
                sortIndex: -1,
              }),
              W > yt
                ? ((D.sortIndex = W),
                  r(v, D),
                  s(E) === null &&
                    D === s(v) &&
                    (Z ? ($(F), (F = -1)) : (Z = !0), Rl(mt, W - yt)))
                : ((D.sortIndex = bt),
                  r(E, D),
                  w || G || ((w = !0), _t || ((_t = !0), kt()))),
              D
            );
          }),
          (f.unstable_shouldYield = yl),
          (f.unstable_wrapCallback = function (D) {
            var B = H;
            return function () {
              var W = H;
              H = B;
              try {
                return D.apply(this, arguments);
              } finally {
                H = W;
              }
            };
          }));
      })(Cc)),
    Cc
  );
}
var Pd;
function av() {
  return (Pd || ((Pd = 1), (Dc.exports = ev())), Dc.exports);
}
var Uc = { exports: {} },
  wt = {};
/**
 * @license React
 * react-dom.production.js
 *
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */ var th;
function uv() {
  if (th) return wt;
  th = 1;
  var f = Yc();
  function r(E) {
    var v = "https://react.dev/errors/" + E;
    if (1 < arguments.length) {
      v += "?args[]=" + encodeURIComponent(arguments[1]);
      for (var U = 2; U < arguments.length; U++)
        v += "&args[]=" + encodeURIComponent(arguments[U]);
    }
    return (
      "Minified React error #" +
      E +
      "; visit " +
      v +
      " for the full message or use the non-minified dev environment for full errors and additional helpful warnings."
    );
  }
  function s() {}
  var o = {
      d: {
        f: s,
        r: function () {
          throw Error(r(522));
        },
        D: s,
        C: s,
        L: s,
        m: s,
        X: s,
        S: s,
        M: s,
      },
      p: 0,
      findDOMNode: null,
    },
    h = Symbol.for("react.portal");
  function m(E, v, U) {
    var A =
      3 < arguments.length && arguments[3] !== void 0 ? arguments[3] : null;
    return {
      $$typeof: h,
      key: A == null ? null : "" + A,
      children: E,
      containerInfo: v,
      implementation: U,
    };
  }
  var S = f.__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE;
  function M(E, v) {
    if (E === "font") return "";
    if (typeof v == "string") return v === "use-credentials" ? v : "";
  }
  return (
    (wt.__DOM_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE = o),
    (wt.createPortal = function (E, v) {
      var U =
        2 < arguments.length && arguments[2] !== void 0 ? arguments[2] : null;
      if (!v || (v.nodeType !== 1 && v.nodeType !== 9 && v.nodeType !== 11))
        throw Error(r(299));
      return m(E, v, null, U);
    }),
    (wt.flushSync = function (E) {
      var v = S.T,
        U = o.p;
      try {
        if (((S.T = null), (o.p = 2), E)) return E();
      } finally {
        ((S.T = v), (o.p = U), o.d.f());
      }
    }),
    (wt.preconnect = function (E, v) {
      typeof E == "string" &&
        (v
          ? ((v = v.crossOrigin),
            (v =
              typeof v == "string"
                ? v === "use-credentials"
                  ? v
                  : ""
                : void 0))
          : (v = null),
        o.d.C(E, v));
    }),
    (wt.prefetchDNS = function (E) {
      typeof E == "string" && o.d.D(E);
    }),
    (wt.preinit = function (E, v) {
      if (typeof E == "string" && v && typeof v.as == "string") {
        var U = v.as,
          A = M(U, v.crossOrigin),
          H = typeof v.integrity == "string" ? v.integrity : void 0,
          G = typeof v.fetchPriority == "string" ? v.fetchPriority : void 0;
        U === "style"
          ? o.d.S(E, typeof v.precedence == "string" ? v.precedence : void 0, {
              crossOrigin: A,
              integrity: H,
              fetchPriority: G,
            })
          : U === "script" &&
            o.d.X(E, {
              crossOrigin: A,
              integrity: H,
              fetchPriority: G,
              nonce: typeof v.nonce == "string" ? v.nonce : void 0,
            });
      }
    }),
    (wt.preinitModule = function (E, v) {
      if (typeof E == "string")
        if (typeof v == "object" && v !== null) {
          if (v.as == null || v.as === "script") {
            var U = M(v.as, v.crossOrigin);
            o.d.M(E, {
              crossOrigin: U,
              integrity: typeof v.integrity == "string" ? v.integrity : void 0,
              nonce: typeof v.nonce == "string" ? v.nonce : void 0,
            });
          }
        } else v == null && o.d.M(E);
    }),
    (wt.preload = function (E, v) {
      if (
        typeof E == "string" &&
        typeof v == "object" &&
        v !== null &&
        typeof v.as == "string"
      ) {
        var U = v.as,
          A = M(U, v.crossOrigin);
        o.d.L(E, U, {
          crossOrigin: A,
          integrity: typeof v.integrity == "string" ? v.integrity : void 0,
          nonce: typeof v.nonce == "string" ? v.nonce : void 0,
          type: typeof v.type == "string" ? v.type : void 0,
          fetchPriority:
            typeof v.fetchPriority == "string" ? v.fetchPriority : void 0,
          referrerPolicy:
            typeof v.referrerPolicy == "string" ? v.referrerPolicy : void 0,
          imageSrcSet:
            typeof v.imageSrcSet == "string" ? v.imageSrcSet : void 0,
          imageSizes: typeof v.imageSizes == "string" ? v.imageSizes : void 0,
          media: typeof v.media == "string" ? v.media : void 0,
        });
      }
    }),
    (wt.preloadModule = function (E, v) {
      if (typeof E == "string")
        if (v) {
          var U = M(v.as, v.crossOrigin);
          o.d.m(E, {
            as: typeof v.as == "string" && v.as !== "script" ? v.as : void 0,
            crossOrigin: U,
            integrity: typeof v.integrity == "string" ? v.integrity : void 0,
          });
        } else o.d.m(E);
    }),
    (wt.requestFormReset = function (E) {
      o.d.r(E);
    }),
    (wt.unstable_batchedUpdates = function (E, v) {
      return E(v);
    }),
    (wt.useFormState = function (E, v, U) {
      return S.H.useFormState(E, v, U);
    }),
    (wt.useFormStatus = function () {
      return S.H.useHostTransitionStatus();
    }),
    (wt.version = "19.2.4"),
    wt
  );
}
var lh;
function nv() {
  if (lh) return Uc.exports;
  lh = 1;
  function f() {
    if (
      !(
        typeof __REACT_DEVTOOLS_GLOBAL_HOOK__ > "u" ||
        typeof __REACT_DEVTOOLS_GLOBAL_HOOK__.checkDCE != "function"
      )
    )
      try {
        __REACT_DEVTOOLS_GLOBAL_HOOK__.checkDCE(f);
      } catch (r) {
        console.error(r);
      }
  }
  return (f(), (Uc.exports = uv()), Uc.exports);
}
/**
 * @license React
 * react-dom-client.production.js
 *
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */ var eh;
function iv() {
  if (eh) return Uu;
  eh = 1;
  var f = av(),
    r = Yc(),
    s = nv();
  function o(t) {
    var l = "https://react.dev/errors/" + t;
    if (1 < arguments.length) {
      l += "?args[]=" + encodeURIComponent(arguments[1]);
      for (var e = 2; e < arguments.length; e++)
        l += "&args[]=" + encodeURIComponent(arguments[e]);
    }
    return (
      "Minified React error #" +
      t +
      "; visit " +
      l +
      " for the full message or use the non-minified dev environment for full errors and additional helpful warnings."
    );
  }
  function h(t) {
    return !(!t || (t.nodeType !== 1 && t.nodeType !== 9 && t.nodeType !== 11));
  }
  function m(t) {
    var l = t,
      e = t;
    if (t.alternate) for (; l.return; ) l = l.return;
    else {
      t = l;
      do ((l = t), (l.flags & 4098) !== 0 && (e = l.return), (t = l.return));
      while (t);
    }
    return l.tag === 3 ? e : null;
  }
  function S(t) {
    if (t.tag === 13) {
      var l = t.memoizedState;
      if (
        (l === null && ((t = t.alternate), t !== null && (l = t.memoizedState)),
        l !== null)
      )
        return l.dehydrated;
    }
    return null;
  }
  function M(t) {
    if (t.tag === 31) {
      var l = t.memoizedState;
      if (
        (l === null && ((t = t.alternate), t !== null && (l = t.memoizedState)),
        l !== null)
      )
        return l.dehydrated;
    }
    return null;
  }
  function E(t) {
    if (m(t) !== t) throw Error(o(188));
  }
  function v(t) {
    var l = t.alternate;
    if (!l) {
      if (((l = m(t)), l === null)) throw Error(o(188));
      return l !== t ? null : t;
    }
    for (var e = t, a = l; ; ) {
      var u = e.return;
      if (u === null) break;
      var n = u.alternate;
      if (n === null) {
        if (((a = u.return), a !== null)) {
          e = a;
          continue;
        }
        break;
      }
      if (u.child === n.child) {
        for (n = u.child; n; ) {
          if (n === e) return (E(u), t);
          if (n === a) return (E(u), l);
          n = n.sibling;
        }
        throw Error(o(188));
      }
      if (e.return !== a.return) ((e = u), (a = n));
      else {
        for (var i = !1, c = u.child; c; ) {
          if (c === e) {
            ((i = !0), (e = u), (a = n));
            break;
          }
          if (c === a) {
            ((i = !0), (a = u), (e = n));
            break;
          }
          c = c.sibling;
        }
        if (!i) {
          for (c = n.child; c; ) {
            if (c === e) {
              ((i = !0), (e = n), (a = u));
              break;
            }
            if (c === a) {
              ((i = !0), (a = n), (e = u));
              break;
            }
            c = c.sibling;
          }
          if (!i) throw Error(o(189));
        }
      }
      if (e.alternate !== a) throw Error(o(190));
    }
    if (e.tag !== 3) throw Error(o(188));
    return e.stateNode.current === e ? t : l;
  }
  function U(t) {
    var l = t.tag;
    if (l === 5 || l === 26 || l === 27 || l === 6) return t;
    for (t = t.child; t !== null; ) {
      if (((l = U(t)), l !== null)) return l;
      t = t.sibling;
    }
    return null;
  }
  var A = Object.assign,
    H = Symbol.for("react.element"),
    G = Symbol.for("react.transitional.element"),
    w = Symbol.for("react.portal"),
    Z = Symbol.for("react.fragment"),
    q = Symbol.for("react.strict_mode"),
    V = Symbol.for("react.profiler"),
    $ = Symbol.for("react.consumer"),
    Y = Symbol.for("react.context"),
    St = Symbol.for("react.forward_ref"),
    mt = Symbol.for("react.suspense"),
    _t = Symbol.for("react.suspense_list"),
    F = Symbol.for("react.memo"),
    Dt = Symbol.for("react.lazy"),
    Xt = Symbol.for("react.activity"),
    yl = Symbol.for("react.memo_cache_sentinel"),
    Ul = Symbol.iterator;
  function kt(t) {
    return t === null || typeof t != "object"
      ? null
      : ((t = (Ul && t[Ul]) || t["@@iterator"]),
        typeof t == "function" ? t : null);
  }
  var Ce = Symbol.for("react.client.reference");
  function jl(t) {
    if (t == null) return null;
    if (typeof t == "function")
      return t.$$typeof === Ce ? null : t.displayName || t.name || null;
    if (typeof t == "string") return t;
    switch (t) {
      case Z:
        return "Fragment";
      case V:
        return "Profiler";
      case q:
        return "StrictMode";
      case mt:
        return "Suspense";
      case _t:
        return "SuspenseList";
      case Xt:
        return "Activity";
    }
    if (typeof t == "object")
      switch (t.$$typeof) {
        case w:
          return "Portal";
        case Y:
          return t.displayName || "Context";
        case $:
          return (t._context.displayName || "Context") + ".Consumer";
        case St:
          var l = t.render;
          return (
            (t = t.displayName),
            t ||
              ((t = l.displayName || l.name || ""),
              (t = t !== "" ? "ForwardRef(" + t + ")" : "ForwardRef")),
            t
          );
        case F:
          return (
            (l = t.displayName || null),
            l !== null ? l : jl(t.type) || "Memo"
          );
        case Dt:
          ((l = t._payload), (t = t._init));
          try {
            return jl(t(l));
          } catch {}
      }
    return null;
  }
  var Rl = Array.isArray,
    D = r.__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE,
    B = s.__DOM_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE,
    W = { pending: !1, data: null, method: null, action: null },
    yt = [],
    bt = -1;
  function g(t) {
    return { current: t };
  }
  function x(t) {
    0 > bt || ((t.current = yt[bt]), (yt[bt] = null), bt--);
  }
  function j(t, l) {
    (bt++, (yt[bt] = t.current), (t.current = l));
  }
  var X = g(null),
    I = g(null),
    lt = g(null),
    st = g(null);
  function $t(t, l) {
    switch ((j(lt, l), j(I, t), j(X, null), l.nodeType)) {
      case 9:
      case 11:
        t = (t = l.documentElement) && (t = t.namespaceURI) ? gd(t) : 0;
        break;
      default:
        if (((t = l.tagName), (l = l.namespaceURI)))
          ((l = gd(l)), (t = pd(l, t)));
        else
          switch (t) {
            case "svg":
              t = 1;
              break;
            case "math":
              t = 2;
              break;
            default:
              t = 0;
          }
    }
    (x(X), j(X, t));
  }
  function Ct() {
    (x(X), x(I), x(lt));
  }
  function ja(t) {
    t.memoizedState !== null && j(st, t);
    var l = X.current,
      e = pd(l, t.type);
    l !== e && (j(I, t), j(X, e));
  }
  function qu(t) {
    (I.current === t && (x(X), x(I)),
      st.current === t && (x(st), (Ru._currentValue = W)));
  }
  var fi, Jc;
  function Ue(t) {
    if (fi === void 0)
      try {
        throw Error();
      } catch (e) {
        var l = e.stack.trim().match(/\n( *(at )?)/);
        ((fi = (l && l[1]) || ""),
          (Jc =
            -1 <
            e.stack.indexOf(`
    at`)
              ? " (<anonymous>)"
              : -1 < e.stack.indexOf("@")
                ? "@unknown:0:0"
                : ""));
      }
    return (
      `
` +
      fi +
      t +
      Jc
    );
  }
  var ci = !1;
  function oi(t, l) {
    if (!t || ci) return "";
    ci = !0;
    var e = Error.prepareStackTrace;
    Error.prepareStackTrace = void 0;
    try {
      var a = {
        DetermineComponentFrameRoot: function () {
          try {
            if (l) {
              var N = function () {
                throw Error();
              };
              if (
                (Object.defineProperty(N.prototype, "props", {
                  set: function () {
                    throw Error();
                  },
                }),
                typeof Reflect == "object" && Reflect.construct)
              ) {
                try {
                  Reflect.construct(N, []);
                } catch (_) {
                  var z = _;
                }
                Reflect.construct(t, [], N);
              } else {
                try {
                  N.call();
                } catch (_) {
                  z = _;
                }
                t.call(N.prototype);
              }
            } else {
              try {
                throw Error();
              } catch (_) {
                z = _;
              }
              (N = t()) &&
                typeof N.catch == "function" &&
                N.catch(function () {});
            }
          } catch (_) {
            if (_ && z && typeof _.stack == "string") return [_.stack, z.stack];
          }
          return [null, null];
        },
      };
      a.DetermineComponentFrameRoot.displayName = "DetermineComponentFrameRoot";
      var u = Object.getOwnPropertyDescriptor(
        a.DetermineComponentFrameRoot,
        "name",
      );
      u &&
        u.configurable &&
        Object.defineProperty(a.DetermineComponentFrameRoot, "name", {
          value: "DetermineComponentFrameRoot",
        });
      var n = a.DetermineComponentFrameRoot(),
        i = n[0],
        c = n[1];
      if (i && c) {
        var d = i.split(`
`),
          T = c.split(`
`);
        for (
          u = a = 0;
          a < d.length && !d[a].includes("DetermineComponentFrameRoot");
        )
          a++;
        for (; u < T.length && !T[u].includes("DetermineComponentFrameRoot"); )
          u++;
        if (a === d.length || u === T.length)
          for (
            a = d.length - 1, u = T.length - 1;
            1 <= a && 0 <= u && d[a] !== T[u];
          )
            u--;
        for (; 1 <= a && 0 <= u; a--, u--)
          if (d[a] !== T[u]) {
            if (a !== 1 || u !== 1)
              do
                if ((a--, u--, 0 > u || d[a] !== T[u])) {
                  var R =
                    `
` + d[a].replace(" at new ", " at ");
                  return (
                    t.displayName &&
                      R.includes("<anonymous>") &&
                      (R = R.replace("<anonymous>", t.displayName)),
                    R
                  );
                }
              while (1 <= a && 0 <= u);
            break;
          }
      }
    } finally {
      ((ci = !1), (Error.prepareStackTrace = e));
    }
    return (e = t ? t.displayName || t.name : "") ? Ue(e) : "";
  }
  function Ch(t, l) {
    switch (t.tag) {
      case 26:
      case 27:
      case 5:
        return Ue(t.type);
      case 16:
        return Ue("Lazy");
      case 13:
        return t.child !== l && l !== null
          ? Ue("Suspense Fallback")
          : Ue("Suspense");
      case 19:
        return Ue("SuspenseList");
      case 0:
      case 15:
        return oi(t.type, !1);
      case 11:
        return oi(t.type.render, !1);
      case 1:
        return oi(t.type, !0);
      case 31:
        return Ue("Activity");
      default:
        return "";
    }
  }
  function wc(t) {
    try {
      var l = "",
        e = null;
      do ((l += Ch(t, e)), (e = t), (t = t.return));
      while (t);
      return l;
    } catch (a) {
      return (
        `
Error generating stack: ` +
        a.message +
        `
` +
        a.stack
      );
    }
  }
  var ri = Object.prototype.hasOwnProperty,
    si = f.unstable_scheduleCallback,
    di = f.unstable_cancelCallback,
    Uh = f.unstable_shouldYield,
    Nh = f.unstable_requestPaint,
    ul = f.unstable_now,
    xh = f.unstable_getCurrentPriorityLevel,
    $c = f.unstable_ImmediatePriority,
    Wc = f.unstable_UserBlockingPriority,
    ju = f.unstable_NormalPriority,
    Hh = f.unstable_LowPriority,
    kc = f.unstable_IdlePriority,
    Bh = f.log,
    qh = f.unstable_setDisableYieldValue,
    Ya = null,
    nl = null;
  function ue(t) {
    if (
      (typeof Bh == "function" && qh(t),
      nl && typeof nl.setStrictMode == "function")
    )
      try {
        nl.setStrictMode(Ya, t);
      } catch {}
  }
  var il = Math.clz32 ? Math.clz32 : Lh,
    jh = Math.log,
    Yh = Math.LN2;
  function Lh(t) {
    return ((t >>>= 0), t === 0 ? 32 : (31 - ((jh(t) / Yh) | 0)) | 0);
  }
  var Yu = 256,
    Lu = 262144,
    Gu = 4194304;
  function Ne(t) {
    var l = t & 42;
    if (l !== 0) return l;
    switch (t & -t) {
      case 1:
        return 1;
      case 2:
        return 2;
      case 4:
        return 4;
      case 8:
        return 8;
      case 16:
        return 16;
      case 32:
        return 32;
      case 64:
        return 64;
      case 128:
        return 128;
      case 256:
      case 512:
      case 1024:
      case 2048:
      case 4096:
      case 8192:
      case 16384:
      case 32768:
      case 65536:
      case 131072:
        return t & 261888;
      case 262144:
      case 524288:
      case 1048576:
      case 2097152:
        return t & 3932160;
      case 4194304:
      case 8388608:
      case 16777216:
      case 33554432:
        return t & 62914560;
      case 67108864:
        return 67108864;
      case 134217728:
        return 134217728;
      case 268435456:
        return 268435456;
      case 536870912:
        return 536870912;
      case 1073741824:
        return 0;
      default:
        return t;
    }
  }
  function Xu(t, l, e) {
    var a = t.pendingLanes;
    if (a === 0) return 0;
    var u = 0,
      n = t.suspendedLanes,
      i = t.pingedLanes;
    t = t.warmLanes;
    var c = a & 134217727;
    return (
      c !== 0
        ? ((a = c & ~n),
          a !== 0
            ? (u = Ne(a))
            : ((i &= c),
              i !== 0
                ? (u = Ne(i))
                : e || ((e = c & ~t), e !== 0 && (u = Ne(e)))))
        : ((c = a & ~n),
          c !== 0
            ? (u = Ne(c))
            : i !== 0
              ? (u = Ne(i))
              : e || ((e = a & ~t), e !== 0 && (u = Ne(e)))),
      u === 0
        ? 0
        : l !== 0 &&
            l !== u &&
            (l & n) === 0 &&
            ((n = u & -u),
            (e = l & -l),
            n >= e || (n === 32 && (e & 4194048) !== 0))
          ? l
          : u
    );
  }
  function La(t, l) {
    return (t.pendingLanes & ~(t.suspendedLanes & ~t.pingedLanes) & l) === 0;
  }
  function Gh(t, l) {
    switch (t) {
      case 1:
      case 2:
      case 4:
      case 8:
      case 64:
        return l + 250;
      case 16:
      case 32:
      case 128:
      case 256:
      case 512:
      case 1024:
      case 2048:
      case 4096:
      case 8192:
      case 16384:
      case 32768:
      case 65536:
      case 131072:
      case 262144:
      case 524288:
      case 1048576:
      case 2097152:
        return l + 5e3;
      case 4194304:
      case 8388608:
      case 16777216:
      case 33554432:
        return -1;
      case 67108864:
      case 134217728:
      case 268435456:
      case 536870912:
      case 1073741824:
        return -1;
      default:
        return -1;
    }
  }
  function Fc() {
    var t = Gu;
    return ((Gu <<= 1), (Gu & 62914560) === 0 && (Gu = 4194304), t);
  }
  function hi(t) {
    for (var l = [], e = 0; 31 > e; e++) l.push(t);
    return l;
  }
  function Ga(t, l) {
    ((t.pendingLanes |= l),
      l !== 268435456 &&
        ((t.suspendedLanes = 0), (t.pingedLanes = 0), (t.warmLanes = 0)));
  }
  function Xh(t, l, e, a, u, n) {
    var i = t.pendingLanes;
    ((t.pendingLanes = e),
      (t.suspendedLanes = 0),
      (t.pingedLanes = 0),
      (t.warmLanes = 0),
      (t.expiredLanes &= e),
      (t.entangledLanes &= e),
      (t.errorRecoveryDisabledLanes &= e),
      (t.shellSuspendCounter = 0));
    var c = t.entanglements,
      d = t.expirationTimes,
      T = t.hiddenUpdates;
    for (e = i & ~e; 0 < e; ) {
      var R = 31 - il(e),
        N = 1 << R;
      ((c[R] = 0), (d[R] = -1));
      var z = T[R];
      if (z !== null)
        for (T[R] = null, R = 0; R < z.length; R++) {
          var _ = z[R];
          _ !== null && (_.lane &= -536870913);
        }
      e &= ~N;
    }
    (a !== 0 && Ic(t, a, 0),
      n !== 0 && u === 0 && t.tag !== 0 && (t.suspendedLanes |= n & ~(i & ~l)));
  }
  function Ic(t, l, e) {
    ((t.pendingLanes |= l), (t.suspendedLanes &= ~l));
    var a = 31 - il(l);
    ((t.entangledLanes |= l),
      (t.entanglements[a] = t.entanglements[a] | 1073741824 | (e & 261930)));
  }
  function Pc(t, l) {
    var e = (t.entangledLanes |= l);
    for (t = t.entanglements; e; ) {
      var a = 31 - il(e),
        u = 1 << a;
      ((u & l) | (t[a] & l) && (t[a] |= l), (e &= ~u));
    }
  }
  function to(t, l) {
    var e = l & -l;
    return (
      (e = (e & 42) !== 0 ? 1 : mi(e)),
      (e & (t.suspendedLanes | l)) !== 0 ? 0 : e
    );
  }
  function mi(t) {
    switch (t) {
      case 2:
        t = 1;
        break;
      case 8:
        t = 4;
        break;
      case 32:
        t = 16;
        break;
      case 256:
      case 512:
      case 1024:
      case 2048:
      case 4096:
      case 8192:
      case 16384:
      case 32768:
      case 65536:
      case 131072:
      case 262144:
      case 524288:
      case 1048576:
      case 2097152:
      case 4194304:
      case 8388608:
      case 16777216:
      case 33554432:
        t = 128;
        break;
      case 268435456:
        t = 134217728;
        break;
      default:
        t = 0;
    }
    return t;
  }
  function yi(t) {
    return (
      (t &= -t),
      2 < t ? (8 < t ? ((t & 134217727) !== 0 ? 32 : 268435456) : 8) : 2
    );
  }
  function lo() {
    var t = B.p;
    return t !== 0 ? t : ((t = window.event), t === void 0 ? 32 : Xd(t.type));
  }
  function eo(t, l) {
    var e = B.p;
    try {
      return ((B.p = t), l());
    } finally {
      B.p = e;
    }
  }
  var ne = Math.random().toString(36).slice(2),
    Qt = "__reactFiber$" + ne,
    Ft = "__reactProps$" + ne,
    ke = "__reactContainer$" + ne,
    vi = "__reactEvents$" + ne,
    Qh = "__reactListeners$" + ne,
    Zh = "__reactHandles$" + ne,
    ao = "__reactResources$" + ne,
    Xa = "__reactMarker$" + ne;
  function gi(t) {
    (delete t[Qt], delete t[Ft], delete t[vi], delete t[Qh], delete t[Zh]);
  }
  function Fe(t) {
    var l = t[Qt];
    if (l) return l;
    for (var e = t.parentNode; e; ) {
      if ((l = e[ke] || e[Qt])) {
        if (
          ((e = l.alternate),
          l.child !== null || (e !== null && e.child !== null))
        )
          for (t = Ad(t); t !== null; ) {
            if ((e = t[Qt])) return e;
            t = Ad(t);
          }
        return l;
      }
      ((t = e), (e = t.parentNode));
    }
    return null;
  }
  function Ie(t) {
    if ((t = t[Qt] || t[ke])) {
      var l = t.tag;
      if (
        l === 5 ||
        l === 6 ||
        l === 13 ||
        l === 31 ||
        l === 26 ||
        l === 27 ||
        l === 3
      )
        return t;
    }
    return null;
  }
  function Qa(t) {
    var l = t.tag;
    if (l === 5 || l === 26 || l === 27 || l === 6) return t.stateNode;
    throw Error(o(33));
  }
  function Pe(t) {
    var l = t[ao];
    return (
      l ||
        (l = t[ao] =
          { hoistableStyles: new Map(), hoistableScripts: new Map() }),
      l
    );
  }
  function Lt(t) {
    t[Xa] = !0;
  }
  var uo = new Set(),
    no = {};
  function xe(t, l) {
    (ta(t, l), ta(t + "Capture", l));
  }
  function ta(t, l) {
    for (no[t] = l, t = 0; t < l.length; t++) uo.add(l[t]);
  }
  var Vh = RegExp(
      "^[:A-Z_a-z\\u00C0-\\u00D6\\u00D8-\\u00F6\\u00F8-\\u02FF\\u0370-\\u037D\\u037F-\\u1FFF\\u200C-\\u200D\\u2070-\\u218F\\u2C00-\\u2FEF\\u3001-\\uD7FF\\uF900-\\uFDCF\\uFDF0-\\uFFFD][:A-Z_a-z\\u00C0-\\u00D6\\u00D8-\\u00F6\\u00F8-\\u02FF\\u0370-\\u037D\\u037F-\\u1FFF\\u200C-\\u200D\\u2070-\\u218F\\u2C00-\\u2FEF\\u3001-\\uD7FF\\uF900-\\uFDCF\\uFDF0-\\uFFFD\\-.0-9\\u00B7\\u0300-\\u036F\\u203F-\\u2040]*$",
    ),
    io = {},
    fo = {};
  function Kh(t) {
    return ri.call(fo, t)
      ? !0
      : ri.call(io, t)
        ? !1
        : Vh.test(t)
          ? (fo[t] = !0)
          : ((io[t] = !0), !1);
  }
  function Qu(t, l, e) {
    if (Kh(l))
      if (e === null) t.removeAttribute(l);
      else {
        switch (typeof e) {
          case "undefined":
          case "function":
          case "symbol":
            t.removeAttribute(l);
            return;
          case "boolean":
            var a = l.toLowerCase().slice(0, 5);
            if (a !== "data-" && a !== "aria-") {
              t.removeAttribute(l);
              return;
            }
        }
        t.setAttribute(l, "" + e);
      }
  }
  function Zu(t, l, e) {
    if (e === null) t.removeAttribute(l);
    else {
      switch (typeof e) {
        case "undefined":
        case "function":
        case "symbol":
        case "boolean":
          t.removeAttribute(l);
          return;
      }
      t.setAttribute(l, "" + e);
    }
  }
  function Yl(t, l, e, a) {
    if (a === null) t.removeAttribute(e);
    else {
      switch (typeof a) {
        case "undefined":
        case "function":
        case "symbol":
        case "boolean":
          t.removeAttribute(e);
          return;
      }
      t.setAttributeNS(l, e, "" + a);
    }
  }
  function vl(t) {
    switch (typeof t) {
      case "bigint":
      case "boolean":
      case "number":
      case "string":
      case "undefined":
        return t;
      case "object":
        return t;
      default:
        return "";
    }
  }
  function co(t) {
    var l = t.type;
    return (
      (t = t.nodeName) &&
      t.toLowerCase() === "input" &&
      (l === "checkbox" || l === "radio")
    );
  }
  function Jh(t, l, e) {
    var a = Object.getOwnPropertyDescriptor(t.constructor.prototype, l);
    if (
      !t.hasOwnProperty(l) &&
      typeof a < "u" &&
      typeof a.get == "function" &&
      typeof a.set == "function"
    ) {
      var u = a.get,
        n = a.set;
      return (
        Object.defineProperty(t, l, {
          configurable: !0,
          get: function () {
            return u.call(this);
          },
          set: function (i) {
            ((e = "" + i), n.call(this, i));
          },
        }),
        Object.defineProperty(t, l, { enumerable: a.enumerable }),
        {
          getValue: function () {
            return e;
          },
          setValue: function (i) {
            e = "" + i;
          },
          stopTracking: function () {
            ((t._valueTracker = null), delete t[l]);
          },
        }
      );
    }
  }
  function pi(t) {
    if (!t._valueTracker) {
      var l = co(t) ? "checked" : "value";
      t._valueTracker = Jh(t, l, "" + t[l]);
    }
  }
  function oo(t) {
    if (!t) return !1;
    var l = t._valueTracker;
    if (!l) return !0;
    var e = l.getValue(),
      a = "";
    return (
      t && (a = co(t) ? (t.checked ? "true" : "false") : t.value),
      (t = a),
      t !== e ? (l.setValue(t), !0) : !1
    );
  }
  function Vu(t) {
    if (
      ((t = t || (typeof document < "u" ? document : void 0)), typeof t > "u")
    )
      return null;
    try {
      return t.activeElement || t.body;
    } catch {
      return t.body;
    }
  }
  var wh = /[\n"\\]/g;
  function gl(t) {
    return t.replace(wh, function (l) {
      return "\\" + l.charCodeAt(0).toString(16) + " ";
    });
  }
  function Si(t, l, e, a, u, n, i, c) {
    ((t.name = ""),
      i != null &&
      typeof i != "function" &&
      typeof i != "symbol" &&
      typeof i != "boolean"
        ? (t.type = i)
        : t.removeAttribute("type"),
      l != null
        ? i === "number"
          ? ((l === 0 && t.value === "") || t.value != l) &&
            (t.value = "" + vl(l))
          : t.value !== "" + vl(l) && (t.value = "" + vl(l))
        : (i !== "submit" && i !== "reset") || t.removeAttribute("value"),
      l != null
        ? bi(t, i, vl(l))
        : e != null
          ? bi(t, i, vl(e))
          : a != null && t.removeAttribute("value"),
      u == null && n != null && (t.defaultChecked = !!n),
      u != null &&
        (t.checked = u && typeof u != "function" && typeof u != "symbol"),
      c != null &&
      typeof c != "function" &&
      typeof c != "symbol" &&
      typeof c != "boolean"
        ? (t.name = "" + vl(c))
        : t.removeAttribute("name"));
  }
  function ro(t, l, e, a, u, n, i, c) {
    if (
      (n != null &&
        typeof n != "function" &&
        typeof n != "symbol" &&
        typeof n != "boolean" &&
        (t.type = n),
      l != null || e != null)
    ) {
      if (!((n !== "submit" && n !== "reset") || l != null)) {
        pi(t);
        return;
      }
      ((e = e != null ? "" + vl(e) : ""),
        (l = l != null ? "" + vl(l) : e),
        c || l === t.value || (t.value = l),
        (t.defaultValue = l));
    }
    ((a = a ?? u),
      (a = typeof a != "function" && typeof a != "symbol" && !!a),
      (t.checked = c ? t.checked : !!a),
      (t.defaultChecked = !!a),
      i != null &&
        typeof i != "function" &&
        typeof i != "symbol" &&
        typeof i != "boolean" &&
        (t.name = i),
      pi(t));
  }
  function bi(t, l, e) {
    (l === "number" && Vu(t.ownerDocument) === t) ||
      t.defaultValue === "" + e ||
      (t.defaultValue = "" + e);
  }
  function la(t, l, e, a) {
    if (((t = t.options), l)) {
      l = {};
      for (var u = 0; u < e.length; u++) l["$" + e[u]] = !0;
      for (e = 0; e < t.length; e++)
        ((u = l.hasOwnProperty("$" + t[e].value)),
          t[e].selected !== u && (t[e].selected = u),
          u && a && (t[e].defaultSelected = !0));
    } else {
      for (e = "" + vl(e), l = null, u = 0; u < t.length; u++) {
        if (t[u].value === e) {
          ((t[u].selected = !0), a && (t[u].defaultSelected = !0));
          return;
        }
        l !== null || t[u].disabled || (l = t[u]);
      }
      l !== null && (l.selected = !0);
    }
  }
  function so(t, l, e) {
    if (
      l != null &&
      ((l = "" + vl(l)), l !== t.value && (t.value = l), e == null)
    ) {
      t.defaultValue !== l && (t.defaultValue = l);
      return;
    }
    t.defaultValue = e != null ? "" + vl(e) : "";
  }
  function ho(t, l, e, a) {
    if (l == null) {
      if (a != null) {
        if (e != null) throw Error(o(92));
        if (Rl(a)) {
          if (1 < a.length) throw Error(o(93));
          a = a[0];
        }
        e = a;
      }
      (e == null && (e = ""), (l = e));
    }
    ((e = vl(l)),
      (t.defaultValue = e),
      (a = t.textContent),
      a === e && a !== "" && a !== null && (t.value = a),
      pi(t));
  }
  function ea(t, l) {
    if (l) {
      var e = t.firstChild;
      if (e && e === t.lastChild && e.nodeType === 3) {
        e.nodeValue = l;
        return;
      }
    }
    t.textContent = l;
  }
  var $h = new Set(
    "animationIterationCount aspectRatio borderImageOutset borderImageSlice borderImageWidth boxFlex boxFlexGroup boxOrdinalGroup columnCount columns flex flexGrow flexPositive flexShrink flexNegative flexOrder gridArea gridRow gridRowEnd gridRowSpan gridRowStart gridColumn gridColumnEnd gridColumnSpan gridColumnStart fontWeight lineClamp lineHeight opacity order orphans scale tabSize widows zIndex zoom fillOpacity floodOpacity stopOpacity strokeDasharray strokeDashoffset strokeMiterlimit strokeOpacity strokeWidth MozAnimationIterationCount MozBoxFlex MozBoxFlexGroup MozLineClamp msAnimationIterationCount msFlex msZoom msFlexGrow msFlexNegative msFlexOrder msFlexPositive msFlexShrink msGridColumn msGridColumnSpan msGridRow msGridRowSpan WebkitAnimationIterationCount WebkitBoxFlex WebKitBoxFlexGroup WebkitBoxOrdinalGroup WebkitColumnCount WebkitColumns WebkitFlex WebkitFlexGrow WebkitFlexPositive WebkitFlexShrink WebkitLineClamp".split(
      " ",
    ),
  );
  function mo(t, l, e) {
    var a = l.indexOf("--") === 0;
    e == null || typeof e == "boolean" || e === ""
      ? a
        ? t.setProperty(l, "")
        : l === "float"
          ? (t.cssFloat = "")
          : (t[l] = "")
      : a
        ? t.setProperty(l, e)
        : typeof e != "number" || e === 0 || $h.has(l)
          ? l === "float"
            ? (t.cssFloat = e)
            : (t[l] = ("" + e).trim())
          : (t[l] = e + "px");
  }
  function yo(t, l, e) {
    if (l != null && typeof l != "object") throw Error(o(62));
    if (((t = t.style), e != null)) {
      for (var a in e)
        !e.hasOwnProperty(a) ||
          (l != null && l.hasOwnProperty(a)) ||
          (a.indexOf("--") === 0
            ? t.setProperty(a, "")
            : a === "float"
              ? (t.cssFloat = "")
              : (t[a] = ""));
      for (var u in l)
        ((a = l[u]), l.hasOwnProperty(u) && e[u] !== a && mo(t, u, a));
    } else for (var n in l) l.hasOwnProperty(n) && mo(t, n, l[n]);
  }
  function Ei(t) {
    if (t.indexOf("-") === -1) return !1;
    switch (t) {
      case "annotation-xml":
      case "color-profile":
      case "font-face":
      case "font-face-src":
      case "font-face-uri":
      case "font-face-format":
      case "font-face-name":
      case "missing-glyph":
        return !1;
      default:
        return !0;
    }
  }
  var Wh = new Map([
      ["acceptCharset", "accept-charset"],
      ["htmlFor", "for"],
      ["httpEquiv", "http-equiv"],
      ["crossOrigin", "crossorigin"],
      ["accentHeight", "accent-height"],
      ["alignmentBaseline", "alignment-baseline"],
      ["arabicForm", "arabic-form"],
      ["baselineShift", "baseline-shift"],
      ["capHeight", "cap-height"],
      ["clipPath", "clip-path"],
      ["clipRule", "clip-rule"],
      ["colorInterpolation", "color-interpolation"],
      ["colorInterpolationFilters", "color-interpolation-filters"],
      ["colorProfile", "color-profile"],
      ["colorRendering", "color-rendering"],
      ["dominantBaseline", "dominant-baseline"],
      ["enableBackground", "enable-background"],
      ["fillOpacity", "fill-opacity"],
      ["fillRule", "fill-rule"],
      ["floodColor", "flood-color"],
      ["floodOpacity", "flood-opacity"],
      ["fontFamily", "font-family"],
      ["fontSize", "font-size"],
      ["fontSizeAdjust", "font-size-adjust"],
      ["fontStretch", "font-stretch"],
      ["fontStyle", "font-style"],
      ["fontVariant", "font-variant"],
      ["fontWeight", "font-weight"],
      ["glyphName", "glyph-name"],
      ["glyphOrientationHorizontal", "glyph-orientation-horizontal"],
      ["glyphOrientationVertical", "glyph-orientation-vertical"],
      ["horizAdvX", "horiz-adv-x"],
      ["horizOriginX", "horiz-origin-x"],
      ["imageRendering", "image-rendering"],
      ["letterSpacing", "letter-spacing"],
      ["lightingColor", "lighting-color"],
      ["markerEnd", "marker-end"],
      ["markerMid", "marker-mid"],
      ["markerStart", "marker-start"],
      ["overlinePosition", "overline-position"],
      ["overlineThickness", "overline-thickness"],
      ["paintOrder", "paint-order"],
      ["panose-1", "panose-1"],
      ["pointerEvents", "pointer-events"],
      ["renderingIntent", "rendering-intent"],
      ["shapeRendering", "shape-rendering"],
      ["stopColor", "stop-color"],
      ["stopOpacity", "stop-opacity"],
      ["strikethroughPosition", "strikethrough-position"],
      ["strikethroughThickness", "strikethrough-thickness"],
      ["strokeDasharray", "stroke-dasharray"],
      ["strokeDashoffset", "stroke-dashoffset"],
      ["strokeLinecap", "stroke-linecap"],
      ["strokeLinejoin", "stroke-linejoin"],
      ["strokeMiterlimit", "stroke-miterlimit"],
      ["strokeOpacity", "stroke-opacity"],
      ["strokeWidth", "stroke-width"],
      ["textAnchor", "text-anchor"],
      ["textDecoration", "text-decoration"],
      ["textRendering", "text-rendering"],
      ["transformOrigin", "transform-origin"],
      ["underlinePosition", "underline-position"],
      ["underlineThickness", "underline-thickness"],
      ["unicodeBidi", "unicode-bidi"],
      ["unicodeRange", "unicode-range"],
      ["unitsPerEm", "units-per-em"],
      ["vAlphabetic", "v-alphabetic"],
      ["vHanging", "v-hanging"],
      ["vIdeographic", "v-ideographic"],
      ["vMathematical", "v-mathematical"],
      ["vectorEffect", "vector-effect"],
      ["vertAdvY", "vert-adv-y"],
      ["vertOriginX", "vert-origin-x"],
      ["vertOriginY", "vert-origin-y"],
      ["wordSpacing", "word-spacing"],
      ["writingMode", "writing-mode"],
      ["xmlnsXlink", "xmlns:xlink"],
      ["xHeight", "x-height"],
    ]),
    kh =
      /^[\u0000-\u001F ]*j[\r\n\t]*a[\r\n\t]*v[\r\n\t]*a[\r\n\t]*s[\r\n\t]*c[\r\n\t]*r[\r\n\t]*i[\r\n\t]*p[\r\n\t]*t[\r\n\t]*:/i;
  function Ku(t) {
    return kh.test("" + t)
      ? "javascript:throw new Error('React has blocked a javascript: URL as a security precaution.')"
      : t;
  }
  function Ll() {}
  var Ti = null;
  function zi(t) {
    return (
      (t = t.target || t.srcElement || window),
      t.correspondingUseElement && (t = t.correspondingUseElement),
      t.nodeType === 3 ? t.parentNode : t
    );
  }
  var aa = null,
    ua = null;
  function vo(t) {
    var l = Ie(t);
    if (l && (t = l.stateNode)) {
      var e = t[Ft] || null;
      t: switch (((t = l.stateNode), l.type)) {
        case "input":
          if (
            (Si(
              t,
              e.value,
              e.defaultValue,
              e.defaultValue,
              e.checked,
              e.defaultChecked,
              e.type,
              e.name,
            ),
            (l = e.name),
            e.type === "radio" && l != null)
          ) {
            for (e = t; e.parentNode; ) e = e.parentNode;
            for (
              e = e.querySelectorAll(
                'input[name="' + gl("" + l) + '"][type="radio"]',
              ),
                l = 0;
              l < e.length;
              l++
            ) {
              var a = e[l];
              if (a !== t && a.form === t.form) {
                var u = a[Ft] || null;
                if (!u) throw Error(o(90));
                Si(
                  a,
                  u.value,
                  u.defaultValue,
                  u.defaultValue,
                  u.checked,
                  u.defaultChecked,
                  u.type,
                  u.name,
                );
              }
            }
            for (l = 0; l < e.length; l++)
              ((a = e[l]), a.form === t.form && oo(a));
          }
          break t;
        case "textarea":
          so(t, e.value, e.defaultValue);
          break t;
        case "select":
          ((l = e.value), l != null && la(t, !!e.multiple, l, !1));
      }
    }
  }
  var _i = !1;
  function go(t, l, e) {
    if (_i) return t(l, e);
    _i = !0;
    try {
      var a = t(l);
      return a;
    } finally {
      if (
        ((_i = !1),
        (aa !== null || ua !== null) &&
          (xn(), aa && ((l = aa), (t = ua), (ua = aa = null), vo(l), t)))
      )
        for (l = 0; l < t.length; l++) vo(t[l]);
    }
  }
  function Za(t, l) {
    var e = t.stateNode;
    if (e === null) return null;
    var a = e[Ft] || null;
    if (a === null) return null;
    e = a[l];
    t: switch (l) {
      case "onClick":
      case "onClickCapture":
      case "onDoubleClick":
      case "onDoubleClickCapture":
      case "onMouseDown":
      case "onMouseDownCapture":
      case "onMouseMove":
      case "onMouseMoveCapture":
      case "onMouseUp":
      case "onMouseUpCapture":
      case "onMouseEnter":
        ((a = !a.disabled) ||
          ((t = t.type),
          (a = !(
            t === "button" ||
            t === "input" ||
            t === "select" ||
            t === "textarea"
          ))),
          (t = !a));
        break t;
      default:
        t = !1;
    }
    if (t) return null;
    if (e && typeof e != "function") throw Error(o(231, l, typeof e));
    return e;
  }
  var Gl = !(
      typeof window > "u" ||
      typeof window.document > "u" ||
      typeof window.document.createElement > "u"
    ),
    Ai = !1;
  if (Gl)
    try {
      var Va = {};
      (Object.defineProperty(Va, "passive", {
        get: function () {
          Ai = !0;
        },
      }),
        window.addEventListener("test", Va, Va),
        window.removeEventListener("test", Va, Va));
    } catch {
      Ai = !1;
    }
  var ie = null,
    Ri = null,
    Ju = null;
  function po() {
    if (Ju) return Ju;
    var t,
      l = Ri,
      e = l.length,
      a,
      u = "value" in ie ? ie.value : ie.textContent,
      n = u.length;
    for (t = 0; t < e && l[t] === u[t]; t++);
    var i = e - t;
    for (a = 1; a <= i && l[e - a] === u[n - a]; a++);
    return (Ju = u.slice(t, 1 < a ? 1 - a : void 0));
  }
  function wu(t) {
    var l = t.keyCode;
    return (
      "charCode" in t
        ? ((t = t.charCode), t === 0 && l === 13 && (t = 13))
        : (t = l),
      t === 10 && (t = 13),
      32 <= t || t === 13 ? t : 0
    );
  }
  function $u() {
    return !0;
  }
  function So() {
    return !1;
  }
  function It(t) {
    function l(e, a, u, n, i) {
      ((this._reactName = e),
        (this._targetInst = u),
        (this.type = a),
        (this.nativeEvent = n),
        (this.target = i),
        (this.currentTarget = null));
      for (var c in t)
        t.hasOwnProperty(c) && ((e = t[c]), (this[c] = e ? e(n) : n[c]));
      return (
        (this.isDefaultPrevented = (
          n.defaultPrevented != null ? n.defaultPrevented : n.returnValue === !1
        )
          ? $u
          : So),
        (this.isPropagationStopped = So),
        this
      );
    }
    return (
      A(l.prototype, {
        preventDefault: function () {
          this.defaultPrevented = !0;
          var e = this.nativeEvent;
          e &&
            (e.preventDefault
              ? e.preventDefault()
              : typeof e.returnValue != "unknown" && (e.returnValue = !1),
            (this.isDefaultPrevented = $u));
        },
        stopPropagation: function () {
          var e = this.nativeEvent;
          e &&
            (e.stopPropagation
              ? e.stopPropagation()
              : typeof e.cancelBubble != "unknown" && (e.cancelBubble = !0),
            (this.isPropagationStopped = $u));
        },
        persist: function () {},
        isPersistent: $u,
      }),
      l
    );
  }
  var He = {
      eventPhase: 0,
      bubbles: 0,
      cancelable: 0,
      timeStamp: function (t) {
        return t.timeStamp || Date.now();
      },
      defaultPrevented: 0,
      isTrusted: 0,
    },
    Wu = It(He),
    Ka = A({}, He, { view: 0, detail: 0 }),
    Fh = It(Ka),
    Oi,
    Mi,
    Ja,
    ku = A({}, Ka, {
      screenX: 0,
      screenY: 0,
      clientX: 0,
      clientY: 0,
      pageX: 0,
      pageY: 0,
      ctrlKey: 0,
      shiftKey: 0,
      altKey: 0,
      metaKey: 0,
      getModifierState: Ci,
      button: 0,
      buttons: 0,
      relatedTarget: function (t) {
        return t.relatedTarget === void 0
          ? t.fromElement === t.srcElement
            ? t.toElement
            : t.fromElement
          : t.relatedTarget;
      },
      movementX: function (t) {
        return "movementX" in t
          ? t.movementX
          : (t !== Ja &&
              (Ja && t.type === "mousemove"
                ? ((Oi = t.screenX - Ja.screenX), (Mi = t.screenY - Ja.screenY))
                : (Mi = Oi = 0),
              (Ja = t)),
            Oi);
      },
      movementY: function (t) {
        return "movementY" in t ? t.movementY : Mi;
      },
    }),
    bo = It(ku),
    Ih = A({}, ku, { dataTransfer: 0 }),
    Ph = It(Ih),
    tm = A({}, Ka, { relatedTarget: 0 }),
    Di = It(tm),
    lm = A({}, He, { animationName: 0, elapsedTime: 0, pseudoElement: 0 }),
    em = It(lm),
    am = A({}, He, {
      clipboardData: function (t) {
        return "clipboardData" in t ? t.clipboardData : window.clipboardData;
      },
    }),
    um = It(am),
    nm = A({}, He, { data: 0 }),
    Eo = It(nm),
    im = {
      Esc: "Escape",
      Spacebar: " ",
      Left: "ArrowLeft",
      Up: "ArrowUp",
      Right: "ArrowRight",
      Down: "ArrowDown",
      Del: "Delete",
      Win: "OS",
      Menu: "ContextMenu",
      Apps: "ContextMenu",
      Scroll: "ScrollLock",
      MozPrintableKey: "Unidentified",
    },
    fm = {
      8: "Backspace",
      9: "Tab",
      12: "Clear",
      13: "Enter",
      16: "Shift",
      17: "Control",
      18: "Alt",
      19: "Pause",
      20: "CapsLock",
      27: "Escape",
      32: " ",
      33: "PageUp",
      34: "PageDown",
      35: "End",
      36: "Home",
      37: "ArrowLeft",
      38: "ArrowUp",
      39: "ArrowRight",
      40: "ArrowDown",
      45: "Insert",
      46: "Delete",
      112: "F1",
      113: "F2",
      114: "F3",
      115: "F4",
      116: "F5",
      117: "F6",
      118: "F7",
      119: "F8",
      120: "F9",
      121: "F10",
      122: "F11",
      123: "F12",
      144: "NumLock",
      145: "ScrollLock",
      224: "Meta",
    },
    cm = {
      Alt: "altKey",
      Control: "ctrlKey",
      Meta: "metaKey",
      Shift: "shiftKey",
    };
  function om(t) {
    var l = this.nativeEvent;
    return l.getModifierState
      ? l.getModifierState(t)
      : (t = cm[t])
        ? !!l[t]
        : !1;
  }
  function Ci() {
    return om;
  }
  var rm = A({}, Ka, {
      key: function (t) {
        if (t.key) {
          var l = im[t.key] || t.key;
          if (l !== "Unidentified") return l;
        }
        return t.type === "keypress"
          ? ((t = wu(t)), t === 13 ? "Enter" : String.fromCharCode(t))
          : t.type === "keydown" || t.type === "keyup"
            ? fm[t.keyCode] || "Unidentified"
            : "";
      },
      code: 0,
      location: 0,
      ctrlKey: 0,
      shiftKey: 0,
      altKey: 0,
      metaKey: 0,
      repeat: 0,
      locale: 0,
      getModifierState: Ci,
      charCode: function (t) {
        return t.type === "keypress" ? wu(t) : 0;
      },
      keyCode: function (t) {
        return t.type === "keydown" || t.type === "keyup" ? t.keyCode : 0;
      },
      which: function (t) {
        return t.type === "keypress"
          ? wu(t)
          : t.type === "keydown" || t.type === "keyup"
            ? t.keyCode
            : 0;
      },
    }),
    sm = It(rm),
    dm = A({}, ku, {
      pointerId: 0,
      width: 0,
      height: 0,
      pressure: 0,
      tangentialPressure: 0,
      tiltX: 0,
      tiltY: 0,
      twist: 0,
      pointerType: 0,
      isPrimary: 0,
    }),
    To = It(dm),
    hm = A({}, Ka, {
      touches: 0,
      targetTouches: 0,
      changedTouches: 0,
      altKey: 0,
      metaKey: 0,
      ctrlKey: 0,
      shiftKey: 0,
      getModifierState: Ci,
    }),
    mm = It(hm),
    ym = A({}, He, { propertyName: 0, elapsedTime: 0, pseudoElement: 0 }),
    vm = It(ym),
    gm = A({}, ku, {
      deltaX: function (t) {
        return "deltaX" in t
          ? t.deltaX
          : "wheelDeltaX" in t
            ? -t.wheelDeltaX
            : 0;
      },
      deltaY: function (t) {
        return "deltaY" in t
          ? t.deltaY
          : "wheelDeltaY" in t
            ? -t.wheelDeltaY
            : "wheelDelta" in t
              ? -t.wheelDelta
              : 0;
      },
      deltaZ: 0,
      deltaMode: 0,
    }),
    pm = It(gm),
    Sm = A({}, He, { newState: 0, oldState: 0 }),
    bm = It(Sm),
    Em = [9, 13, 27, 32],
    Ui = Gl && "CompositionEvent" in window,
    wa = null;
  Gl && "documentMode" in document && (wa = document.documentMode);
  var Tm = Gl && "TextEvent" in window && !wa,
    zo = Gl && (!Ui || (wa && 8 < wa && 11 >= wa)),
    _o = " ",
    Ao = !1;
  function Ro(t, l) {
    switch (t) {
      case "keyup":
        return Em.indexOf(l.keyCode) !== -1;
      case "keydown":
        return l.keyCode !== 229;
      case "keypress":
      case "mousedown":
      case "focusout":
        return !0;
      default:
        return !1;
    }
  }
  function Oo(t) {
    return (
      (t = t.detail),
      typeof t == "object" && "data" in t ? t.data : null
    );
  }
  var na = !1;
  function zm(t, l) {
    switch (t) {
      case "compositionend":
        return Oo(l);
      case "keypress":
        return l.which !== 32 ? null : ((Ao = !0), _o);
      case "textInput":
        return ((t = l.data), t === _o && Ao ? null : t);
      default:
        return null;
    }
  }
  function _m(t, l) {
    if (na)
      return t === "compositionend" || (!Ui && Ro(t, l))
        ? ((t = po()), (Ju = Ri = ie = null), (na = !1), t)
        : null;
    switch (t) {
      case "paste":
        return null;
      case "keypress":
        if (!(l.ctrlKey || l.altKey || l.metaKey) || (l.ctrlKey && l.altKey)) {
          if (l.char && 1 < l.char.length) return l.char;
          if (l.which) return String.fromCharCode(l.which);
        }
        return null;
      case "compositionend":
        return zo && l.locale !== "ko" ? null : l.data;
      default:
        return null;
    }
  }
  var Am = {
    color: !0,
    date: !0,
    datetime: !0,
    "datetime-local": !0,
    email: !0,
    month: !0,
    number: !0,
    password: !0,
    range: !0,
    search: !0,
    tel: !0,
    text: !0,
    time: !0,
    url: !0,
    week: !0,
  };
  function Mo(t) {
    var l = t && t.nodeName && t.nodeName.toLowerCase();
    return l === "input" ? !!Am[t.type] : l === "textarea";
  }
  function Do(t, l, e, a) {
    (aa ? (ua ? ua.push(a) : (ua = [a])) : (aa = a),
      (l = Gn(l, "onChange")),
      0 < l.length &&
        ((e = new Wu("onChange", "change", null, e, a)),
        t.push({ event: e, listeners: l })));
  }
  var $a = null,
    Wa = null;
  function Rm(t) {
    sd(t, 0);
  }
  function Fu(t) {
    var l = Qa(t);
    if (oo(l)) return t;
  }
  function Co(t, l) {
    if (t === "change") return l;
  }
  var Uo = !1;
  if (Gl) {
    var Ni;
    if (Gl) {
      var xi = "oninput" in document;
      if (!xi) {
        var No = document.createElement("div");
        (No.setAttribute("oninput", "return;"),
          (xi = typeof No.oninput == "function"));
      }
      Ni = xi;
    } else Ni = !1;
    Uo = Ni && (!document.documentMode || 9 < document.documentMode);
  }
  function xo() {
    $a && ($a.detachEvent("onpropertychange", Ho), (Wa = $a = null));
  }
  function Ho(t) {
    if (t.propertyName === "value" && Fu(Wa)) {
      var l = [];
      (Do(l, Wa, t, zi(t)), go(Rm, l));
    }
  }
  function Om(t, l, e) {
    t === "focusin"
      ? (xo(), ($a = l), (Wa = e), $a.attachEvent("onpropertychange", Ho))
      : t === "focusout" && xo();
  }
  function Mm(t) {
    if (t === "selectionchange" || t === "keyup" || t === "keydown")
      return Fu(Wa);
  }
  function Dm(t, l) {
    if (t === "click") return Fu(l);
  }
  function Cm(t, l) {
    if (t === "input" || t === "change") return Fu(l);
  }
  function Um(t, l) {
    return (t === l && (t !== 0 || 1 / t === 1 / l)) || (t !== t && l !== l);
  }
  var fl = typeof Object.is == "function" ? Object.is : Um;
  function ka(t, l) {
    if (fl(t, l)) return !0;
    if (
      typeof t != "object" ||
      t === null ||
      typeof l != "object" ||
      l === null
    )
      return !1;
    var e = Object.keys(t),
      a = Object.keys(l);
    if (e.length !== a.length) return !1;
    for (a = 0; a < e.length; a++) {
      var u = e[a];
      if (!ri.call(l, u) || !fl(t[u], l[u])) return !1;
    }
    return !0;
  }
  function Bo(t) {
    for (; t && t.firstChild; ) t = t.firstChild;
    return t;
  }
  function qo(t, l) {
    var e = Bo(t);
    t = 0;
    for (var a; e; ) {
      if (e.nodeType === 3) {
        if (((a = t + e.textContent.length), t <= l && a >= l))
          return { node: e, offset: l - t };
        t = a;
      }
      t: {
        for (; e; ) {
          if (e.nextSibling) {
            e = e.nextSibling;
            break t;
          }
          e = e.parentNode;
        }
        e = void 0;
      }
      e = Bo(e);
    }
  }
  function jo(t, l) {
    return t && l
      ? t === l
        ? !0
        : t && t.nodeType === 3
          ? !1
          : l && l.nodeType === 3
            ? jo(t, l.parentNode)
            : "contains" in t
              ? t.contains(l)
              : t.compareDocumentPosition
                ? !!(t.compareDocumentPosition(l) & 16)
                : !1
      : !1;
  }
  function Yo(t) {
    t =
      t != null &&
      t.ownerDocument != null &&
      t.ownerDocument.defaultView != null
        ? t.ownerDocument.defaultView
        : window;
    for (var l = Vu(t.document); l instanceof t.HTMLIFrameElement; ) {
      try {
        var e = typeof l.contentWindow.location.href == "string";
      } catch {
        e = !1;
      }
      if (e) t = l.contentWindow;
      else break;
      l = Vu(t.document);
    }
    return l;
  }
  function Hi(t) {
    var l = t && t.nodeName && t.nodeName.toLowerCase();
    return (
      l &&
      ((l === "input" &&
        (t.type === "text" ||
          t.type === "search" ||
          t.type === "tel" ||
          t.type === "url" ||
          t.type === "password")) ||
        l === "textarea" ||
        t.contentEditable === "true")
    );
  }
  var Nm = Gl && "documentMode" in document && 11 >= document.documentMode,
    ia = null,
    Bi = null,
    Fa = null,
    qi = !1;
  function Lo(t, l, e) {
    var a =
      e.window === e ? e.document : e.nodeType === 9 ? e : e.ownerDocument;
    qi ||
      ia == null ||
      ia !== Vu(a) ||
      ((a = ia),
      "selectionStart" in a && Hi(a)
        ? (a = { start: a.selectionStart, end: a.selectionEnd })
        : ((a = (
            (a.ownerDocument && a.ownerDocument.defaultView) ||
            window
          ).getSelection()),
          (a = {
            anchorNode: a.anchorNode,
            anchorOffset: a.anchorOffset,
            focusNode: a.focusNode,
            focusOffset: a.focusOffset,
          })),
      (Fa && ka(Fa, a)) ||
        ((Fa = a),
        (a = Gn(Bi, "onSelect")),
        0 < a.length &&
          ((l = new Wu("onSelect", "select", null, l, e)),
          t.push({ event: l, listeners: a }),
          (l.target = ia))));
  }
  function Be(t, l) {
    var e = {};
    return (
      (e[t.toLowerCase()] = l.toLowerCase()),
      (e["Webkit" + t] = "webkit" + l),
      (e["Moz" + t] = "moz" + l),
      e
    );
  }
  var fa = {
      animationend: Be("Animation", "AnimationEnd"),
      animationiteration: Be("Animation", "AnimationIteration"),
      animationstart: Be("Animation", "AnimationStart"),
      transitionrun: Be("Transition", "TransitionRun"),
      transitionstart: Be("Transition", "TransitionStart"),
      transitioncancel: Be("Transition", "TransitionCancel"),
      transitionend: Be("Transition", "TransitionEnd"),
    },
    ji = {},
    Go = {};
  Gl &&
    ((Go = document.createElement("div").style),
    "AnimationEvent" in window ||
      (delete fa.animationend.animation,
      delete fa.animationiteration.animation,
      delete fa.animationstart.animation),
    "TransitionEvent" in window || delete fa.transitionend.transition);
  function qe(t) {
    if (ji[t]) return ji[t];
    if (!fa[t]) return t;
    var l = fa[t],
      e;
    for (e in l) if (l.hasOwnProperty(e) && e in Go) return (ji[t] = l[e]);
    return t;
  }
  var Xo = qe("animationend"),
    Qo = qe("animationiteration"),
    Zo = qe("animationstart"),
    xm = qe("transitionrun"),
    Hm = qe("transitionstart"),
    Bm = qe("transitioncancel"),
    Vo = qe("transitionend"),
    Ko = new Map(),
    Yi =
      "abort auxClick beforeToggle cancel canPlay canPlayThrough click close contextMenu copy cut drag dragEnd dragEnter dragExit dragLeave dragOver dragStart drop durationChange emptied encrypted ended error gotPointerCapture input invalid keyDown keyPress keyUp load loadedData loadedMetadata loadStart lostPointerCapture mouseDown mouseMove mouseOut mouseOver mouseUp paste pause play playing pointerCancel pointerDown pointerMove pointerOut pointerOver pointerUp progress rateChange reset resize seeked seeking stalled submit suspend timeUpdate touchCancel touchEnd touchStart volumeChange scroll toggle touchMove waiting wheel".split(
        " ",
      );
  Yi.push("scrollEnd");
  function Ol(t, l) {
    (Ko.set(t, l), xe(l, [t]));
  }
  var Iu =
      typeof reportError == "function"
        ? reportError
        : function (t) {
            if (
              typeof window == "object" &&
              typeof window.ErrorEvent == "function"
            ) {
              var l = new window.ErrorEvent("error", {
                bubbles: !0,
                cancelable: !0,
                message:
                  typeof t == "object" &&
                  t !== null &&
                  typeof t.message == "string"
                    ? String(t.message)
                    : String(t),
                error: t,
              });
              if (!window.dispatchEvent(l)) return;
            } else if (
              typeof process == "object" &&
              typeof process.emit == "function"
            ) {
              process.emit("uncaughtException", t);
              return;
            }
            console.error(t);
          },
    pl = [],
    ca = 0,
    Li = 0;
  function Pu() {
    for (var t = ca, l = (Li = ca = 0); l < t; ) {
      var e = pl[l];
      pl[l++] = null;
      var a = pl[l];
      pl[l++] = null;
      var u = pl[l];
      pl[l++] = null;
      var n = pl[l];
      if (((pl[l++] = null), a !== null && u !== null)) {
        var i = a.pending;
        (i === null ? (u.next = u) : ((u.next = i.next), (i.next = u)),
          (a.pending = u));
      }
      n !== 0 && Jo(e, u, n);
    }
  }
  function tn(t, l, e, a) {
    ((pl[ca++] = t),
      (pl[ca++] = l),
      (pl[ca++] = e),
      (pl[ca++] = a),
      (Li |= a),
      (t.lanes |= a),
      (t = t.alternate),
      t !== null && (t.lanes |= a));
  }
  function Gi(t, l, e, a) {
    return (tn(t, l, e, a), ln(t));
  }
  function je(t, l) {
    return (tn(t, null, null, l), ln(t));
  }
  function Jo(t, l, e) {
    t.lanes |= e;
    var a = t.alternate;
    a !== null && (a.lanes |= e);
    for (var u = !1, n = t.return; n !== null; )
      ((n.childLanes |= e),
        (a = n.alternate),
        a !== null && (a.childLanes |= e),
        n.tag === 22 &&
          ((t = n.stateNode), t === null || t._visibility & 1 || (u = !0)),
        (t = n),
        (n = n.return));
    return t.tag === 3
      ? ((n = t.stateNode),
        u &&
          l !== null &&
          ((u = 31 - il(e)),
          (t = n.hiddenUpdates),
          (a = t[u]),
          a === null ? (t[u] = [l]) : a.push(l),
          (l.lane = e | 536870912)),
        n)
      : null;
  }
  function ln(t) {
    if (50 < Su) throw ((Su = 0), (kf = null), Error(o(185)));
    for (var l = t.return; l !== null; ) ((t = l), (l = t.return));
    return t.tag === 3 ? t.stateNode : null;
  }
  var oa = {};
  function qm(t, l, e, a) {
    ((this.tag = t),
      (this.key = e),
      (this.sibling =
        this.child =
        this.return =
        this.stateNode =
        this.type =
        this.elementType =
          null),
      (this.index = 0),
      (this.refCleanup = this.ref = null),
      (this.pendingProps = l),
      (this.dependencies =
        this.memoizedState =
        this.updateQueue =
        this.memoizedProps =
          null),
      (this.mode = a),
      (this.subtreeFlags = this.flags = 0),
      (this.deletions = null),
      (this.childLanes = this.lanes = 0),
      (this.alternate = null));
  }
  function cl(t, l, e, a) {
    return new qm(t, l, e, a);
  }
  function Xi(t) {
    return ((t = t.prototype), !(!t || !t.isReactComponent));
  }
  function Xl(t, l) {
    var e = t.alternate;
    return (
      e === null
        ? ((e = cl(t.tag, l, t.key, t.mode)),
          (e.elementType = t.elementType),
          (e.type = t.type),
          (e.stateNode = t.stateNode),
          (e.alternate = t),
          (t.alternate = e))
        : ((e.pendingProps = l),
          (e.type = t.type),
          (e.flags = 0),
          (e.subtreeFlags = 0),
          (e.deletions = null)),
      (e.flags = t.flags & 65011712),
      (e.childLanes = t.childLanes),
      (e.lanes = t.lanes),
      (e.child = t.child),
      (e.memoizedProps = t.memoizedProps),
      (e.memoizedState = t.memoizedState),
      (e.updateQueue = t.updateQueue),
      (l = t.dependencies),
      (e.dependencies =
        l === null ? null : { lanes: l.lanes, firstContext: l.firstContext }),
      (e.sibling = t.sibling),
      (e.index = t.index),
      (e.ref = t.ref),
      (e.refCleanup = t.refCleanup),
      e
    );
  }
  function wo(t, l) {
    t.flags &= 65011714;
    var e = t.alternate;
    return (
      e === null
        ? ((t.childLanes = 0),
          (t.lanes = l),
          (t.child = null),
          (t.subtreeFlags = 0),
          (t.memoizedProps = null),
          (t.memoizedState = null),
          (t.updateQueue = null),
          (t.dependencies = null),
          (t.stateNode = null))
        : ((t.childLanes = e.childLanes),
          (t.lanes = e.lanes),
          (t.child = e.child),
          (t.subtreeFlags = 0),
          (t.deletions = null),
          (t.memoizedProps = e.memoizedProps),
          (t.memoizedState = e.memoizedState),
          (t.updateQueue = e.updateQueue),
          (t.type = e.type),
          (l = e.dependencies),
          (t.dependencies =
            l === null
              ? null
              : { lanes: l.lanes, firstContext: l.firstContext })),
      t
    );
  }
  function en(t, l, e, a, u, n) {
    var i = 0;
    if (((a = t), typeof t == "function")) Xi(t) && (i = 1);
    else if (typeof t == "string")
      i = Xy(t, e, X.current)
        ? 26
        : t === "html" || t === "head" || t === "body"
          ? 27
          : 5;
    else
      t: switch (t) {
        case Xt:
          return (
            (t = cl(31, e, l, u)),
            (t.elementType = Xt),
            (t.lanes = n),
            t
          );
        case Z:
          return Ye(e.children, u, n, l);
        case q:
          ((i = 8), (u |= 24));
          break;
        case V:
          return (
            (t = cl(12, e, l, u | 2)),
            (t.elementType = V),
            (t.lanes = n),
            t
          );
        case mt:
          return (
            (t = cl(13, e, l, u)),
            (t.elementType = mt),
            (t.lanes = n),
            t
          );
        case _t:
          return (
            (t = cl(19, e, l, u)),
            (t.elementType = _t),
            (t.lanes = n),
            t
          );
        default:
          if (typeof t == "object" && t !== null)
            switch (t.$$typeof) {
              case Y:
                i = 10;
                break t;
              case $:
                i = 9;
                break t;
              case St:
                i = 11;
                break t;
              case F:
                i = 14;
                break t;
              case Dt:
                ((i = 16), (a = null));
                break t;
            }
          ((i = 29),
            (e = Error(o(130, t === null ? "null" : typeof t, ""))),
            (a = null));
      }
    return (
      (l = cl(i, e, l, u)),
      (l.elementType = t),
      (l.type = a),
      (l.lanes = n),
      l
    );
  }
  function Ye(t, l, e, a) {
    return ((t = cl(7, t, a, l)), (t.lanes = e), t);
  }
  function Qi(t, l, e) {
    return ((t = cl(6, t, null, l)), (t.lanes = e), t);
  }
  function $o(t) {
    var l = cl(18, null, null, 0);
    return ((l.stateNode = t), l);
  }
  function Zi(t, l, e) {
    return (
      (l = cl(4, t.children !== null ? t.children : [], t.key, l)),
      (l.lanes = e),
      (l.stateNode = {
        containerInfo: t.containerInfo,
        pendingChildren: null,
        implementation: t.implementation,
      }),
      l
    );
  }
  var Wo = new WeakMap();
  function Sl(t, l) {
    if (typeof t == "object" && t !== null) {
      var e = Wo.get(t);
      return e !== void 0
        ? e
        : ((l = { value: t, source: l, stack: wc(l) }), Wo.set(t, l), l);
    }
    return { value: t, source: l, stack: wc(l) };
  }
  var ra = [],
    sa = 0,
    an = null,
    Ia = 0,
    bl = [],
    El = 0,
    fe = null,
    Nl = 1,
    xl = "";
  function Ql(t, l) {
    ((ra[sa++] = Ia), (ra[sa++] = an), (an = t), (Ia = l));
  }
  function ko(t, l, e) {
    ((bl[El++] = Nl), (bl[El++] = xl), (bl[El++] = fe), (fe = t));
    var a = Nl;
    t = xl;
    var u = 32 - il(a) - 1;
    ((a &= ~(1 << u)), (e += 1));
    var n = 32 - il(l) + u;
    if (30 < n) {
      var i = u - (u % 5);
      ((n = (a & ((1 << i) - 1)).toString(32)),
        (a >>= i),
        (u -= i),
        (Nl = (1 << (32 - il(l) + u)) | (e << u) | a),
        (xl = n + t));
    } else ((Nl = (1 << n) | (e << u) | a), (xl = t));
  }
  function Vi(t) {
    t.return !== null && (Ql(t, 1), ko(t, 1, 0));
  }
  function Ki(t) {
    for (; t === an; )
      ((an = ra[--sa]), (ra[sa] = null), (Ia = ra[--sa]), (ra[sa] = null));
    for (; t === fe; )
      ((fe = bl[--El]),
        (bl[El] = null),
        (xl = bl[--El]),
        (bl[El] = null),
        (Nl = bl[--El]),
        (bl[El] = null));
  }
  function Fo(t, l) {
    ((bl[El++] = Nl),
      (bl[El++] = xl),
      (bl[El++] = fe),
      (Nl = l.id),
      (xl = l.overflow),
      (fe = t));
  }
  var Zt = null,
    Tt = null,
    it = !1,
    ce = null,
    Tl = !1,
    Ji = Error(o(519));
  function oe(t) {
    var l = Error(
      o(
        418,
        1 < arguments.length && arguments[1] !== void 0 && arguments[1]
          ? "text"
          : "HTML",
        "",
      ),
    );
    throw (Pa(Sl(l, t)), Ji);
  }
  function Io(t) {
    var l = t.stateNode,
      e = t.type,
      a = t.memoizedProps;
    switch (((l[Qt] = t), (l[Ft] = a), e)) {
      case "dialog":
        (at("cancel", l), at("close", l));
        break;
      case "iframe":
      case "object":
      case "embed":
        at("load", l);
        break;
      case "video":
      case "audio":
        for (e = 0; e < Eu.length; e++) at(Eu[e], l);
        break;
      case "source":
        at("error", l);
        break;
      case "img":
      case "image":
      case "link":
        (at("error", l), at("load", l));
        break;
      case "details":
        at("toggle", l);
        break;
      case "input":
        (at("invalid", l),
          ro(
            l,
            a.value,
            a.defaultValue,
            a.checked,
            a.defaultChecked,
            a.type,
            a.name,
            !0,
          ));
        break;
      case "select":
        at("invalid", l);
        break;
      case "textarea":
        (at("invalid", l), ho(l, a.value, a.defaultValue, a.children));
    }
    ((e = a.children),
      (typeof e != "string" && typeof e != "number" && typeof e != "bigint") ||
      l.textContent === "" + e ||
      a.suppressHydrationWarning === !0 ||
      yd(l.textContent, e)
        ? (a.popover != null && (at("beforetoggle", l), at("toggle", l)),
          a.onScroll != null && at("scroll", l),
          a.onScrollEnd != null && at("scrollend", l),
          a.onClick != null && (l.onclick = Ll),
          (l = !0))
        : (l = !1),
      l || oe(t, !0));
  }
  function Po(t) {
    for (Zt = t.return; Zt; )
      switch (Zt.tag) {
        case 5:
        case 31:
        case 13:
          Tl = !1;
          return;
        case 27:
        case 3:
          Tl = !0;
          return;
        default:
          Zt = Zt.return;
      }
  }
  function da(t) {
    if (t !== Zt) return !1;
    if (!it) return (Po(t), (it = !0), !1);
    var l = t.tag,
      e;
    if (
      ((e = l !== 3 && l !== 27) &&
        ((e = l === 5) &&
          ((e = t.type),
          (e =
            !(e !== "form" && e !== "button") || sc(t.type, t.memoizedProps))),
        (e = !e)),
      e && Tt && oe(t),
      Po(t),
      l === 13)
    ) {
      if (((t = t.memoizedState), (t = t !== null ? t.dehydrated : null), !t))
        throw Error(o(317));
      Tt = _d(t);
    } else if (l === 31) {
      if (((t = t.memoizedState), (t = t !== null ? t.dehydrated : null), !t))
        throw Error(o(317));
      Tt = _d(t);
    } else
      l === 27
        ? ((l = Tt), ze(t.type) ? ((t = vc), (vc = null), (Tt = t)) : (Tt = l))
        : (Tt = Zt ? _l(t.stateNode.nextSibling) : null);
    return !0;
  }
  function Le() {
    ((Tt = Zt = null), (it = !1));
  }
  function wi() {
    var t = ce;
    return (
      t !== null &&
        (el === null ? (el = t) : el.push.apply(el, t), (ce = null)),
      t
    );
  }
  function Pa(t) {
    ce === null ? (ce = [t]) : ce.push(t);
  }
  var $i = g(null),
    Ge = null,
    Zl = null;
  function re(t, l, e) {
    (j($i, l._currentValue), (l._currentValue = e));
  }
  function Vl(t) {
    ((t._currentValue = $i.current), x($i));
  }
  function Wi(t, l, e) {
    for (; t !== null; ) {
      var a = t.alternate;
      if (
        ((t.childLanes & l) !== l
          ? ((t.childLanes |= l), a !== null && (a.childLanes |= l))
          : a !== null && (a.childLanes & l) !== l && (a.childLanes |= l),
        t === e)
      )
        break;
      t = t.return;
    }
  }
  function ki(t, l, e, a) {
    var u = t.child;
    for (u !== null && (u.return = t); u !== null; ) {
      var n = u.dependencies;
      if (n !== null) {
        var i = u.child;
        n = n.firstContext;
        t: for (; n !== null; ) {
          var c = n;
          n = u;
          for (var d = 0; d < l.length; d++)
            if (c.context === l[d]) {
              ((n.lanes |= e),
                (c = n.alternate),
                c !== null && (c.lanes |= e),
                Wi(n.return, e, t),
                a || (i = null));
              break t;
            }
          n = c.next;
        }
      } else if (u.tag === 18) {
        if (((i = u.return), i === null)) throw Error(o(341));
        ((i.lanes |= e),
          (n = i.alternate),
          n !== null && (n.lanes |= e),
          Wi(i, e, t),
          (i = null));
      } else i = u.child;
      if (i !== null) i.return = u;
      else
        for (i = u; i !== null; ) {
          if (i === t) {
            i = null;
            break;
          }
          if (((u = i.sibling), u !== null)) {
            ((u.return = i.return), (i = u));
            break;
          }
          i = i.return;
        }
      u = i;
    }
  }
  function ha(t, l, e, a) {
    t = null;
    for (var u = l, n = !1; u !== null; ) {
      if (!n) {
        if ((u.flags & 524288) !== 0) n = !0;
        else if ((u.flags & 262144) !== 0) break;
      }
      if (u.tag === 10) {
        var i = u.alternate;
        if (i === null) throw Error(o(387));
        if (((i = i.memoizedProps), i !== null)) {
          var c = u.type;
          fl(u.pendingProps.value, i.value) ||
            (t !== null ? t.push(c) : (t = [c]));
        }
      } else if (u === st.current) {
        if (((i = u.alternate), i === null)) throw Error(o(387));
        i.memoizedState.memoizedState !== u.memoizedState.memoizedState &&
          (t !== null ? t.push(Ru) : (t = [Ru]));
      }
      u = u.return;
    }
    (t !== null && ki(l, t, e, a), (l.flags |= 262144));
  }
  function un(t) {
    for (t = t.firstContext; t !== null; ) {
      if (!fl(t.context._currentValue, t.memoizedValue)) return !0;
      t = t.next;
    }
    return !1;
  }
  function Xe(t) {
    ((Ge = t),
      (Zl = null),
      (t = t.dependencies),
      t !== null && (t.firstContext = null));
  }
  function Vt(t) {
    return tr(Ge, t);
  }
  function nn(t, l) {
    return (Ge === null && Xe(t), tr(t, l));
  }
  function tr(t, l) {
    var e = l._currentValue;
    if (((l = { context: l, memoizedValue: e, next: null }), Zl === null)) {
      if (t === null) throw Error(o(308));
      ((Zl = l),
        (t.dependencies = { lanes: 0, firstContext: l }),
        (t.flags |= 524288));
    } else Zl = Zl.next = l;
    return e;
  }
  var jm =
      typeof AbortController < "u"
        ? AbortController
        : function () {
            var t = [],
              l = (this.signal = {
                aborted: !1,
                addEventListener: function (e, a) {
                  t.push(a);
                },
              });
            this.abort = function () {
              ((l.aborted = !0),
                t.forEach(function (e) {
                  return e();
                }));
            };
          },
    Ym = f.unstable_scheduleCallback,
    Lm = f.unstable_NormalPriority,
    Ht = {
      $$typeof: Y,
      Consumer: null,
      Provider: null,
      _currentValue: null,
      _currentValue2: null,
      _threadCount: 0,
    };
  function Fi() {
    return { controller: new jm(), data: new Map(), refCount: 0 };
  }
  function tu(t) {
    (t.refCount--,
      t.refCount === 0 &&
        Ym(Lm, function () {
          t.controller.abort();
        }));
  }
  var lu = null,
    Ii = 0,
    ma = 0,
    ya = null;
  function Gm(t, l) {
    if (lu === null) {
      var e = (lu = []);
      ((Ii = 0),
        (ma = ec()),
        (ya = {
          status: "pending",
          value: void 0,
          then: function (a) {
            e.push(a);
          },
        }));
    }
    return (Ii++, l.then(lr, lr), l);
  }
  function lr() {
    if (--Ii === 0 && lu !== null) {
      ya !== null && (ya.status = "fulfilled");
      var t = lu;
      ((lu = null), (ma = 0), (ya = null));
      for (var l = 0; l < t.length; l++) (0, t[l])();
    }
  }
  function Xm(t, l) {
    var e = [],
      a = {
        status: "pending",
        value: null,
        reason: null,
        then: function (u) {
          e.push(u);
        },
      };
    return (
      t.then(
        function () {
          ((a.status = "fulfilled"), (a.value = l));
          for (var u = 0; u < e.length; u++) (0, e[u])(l);
        },
        function (u) {
          for (a.status = "rejected", a.reason = u, u = 0; u < e.length; u++)
            (0, e[u])(void 0);
        },
      ),
      a
    );
  }
  var er = D.S;
  D.S = function (t, l) {
    ((Ls = ul()),
      typeof l == "object" &&
        l !== null &&
        typeof l.then == "function" &&
        Gm(t, l),
      er !== null && er(t, l));
  };
  var Qe = g(null);
  function Pi() {
    var t = Qe.current;
    return t !== null ? t : Et.pooledCache;
  }
  function fn(t, l) {
    l === null ? j(Qe, Qe.current) : j(Qe, l.pool);
  }
  function ar() {
    var t = Pi();
    return t === null ? null : { parent: Ht._currentValue, pool: t };
  }
  var va = Error(o(460)),
    tf = Error(o(474)),
    cn = Error(o(542)),
    on = { then: function () {} };
  function ur(t) {
    return ((t = t.status), t === "fulfilled" || t === "rejected");
  }
  function nr(t, l, e) {
    switch (
      ((e = t[e]),
      e === void 0 ? t.push(l) : e !== l && (l.then(Ll, Ll), (l = e)),
      l.status)
    ) {
      case "fulfilled":
        return l.value;
      case "rejected":
        throw ((t = l.reason), fr(t), t);
      default:
        if (typeof l.status == "string") l.then(Ll, Ll);
        else {
          if (((t = Et), t !== null && 100 < t.shellSuspendCounter))
            throw Error(o(482));
          ((t = l),
            (t.status = "pending"),
            t.then(
              function (a) {
                if (l.status === "pending") {
                  var u = l;
                  ((u.status = "fulfilled"), (u.value = a));
                }
              },
              function (a) {
                if (l.status === "pending") {
                  var u = l;
                  ((u.status = "rejected"), (u.reason = a));
                }
              },
            ));
        }
        switch (l.status) {
          case "fulfilled":
            return l.value;
          case "rejected":
            throw ((t = l.reason), fr(t), t);
        }
        throw ((Ve = l), va);
    }
  }
  function Ze(t) {
    try {
      var l = t._init;
      return l(t._payload);
    } catch (e) {
      throw e !== null && typeof e == "object" && typeof e.then == "function"
        ? ((Ve = e), va)
        : e;
    }
  }
  var Ve = null;
  function ir() {
    if (Ve === null) throw Error(o(459));
    var t = Ve;
    return ((Ve = null), t);
  }
  function fr(t) {
    if (t === va || t === cn) throw Error(o(483));
  }
  var ga = null,
    eu = 0;
  function rn(t) {
    var l = eu;
    return ((eu += 1), ga === null && (ga = []), nr(ga, t, l));
  }
  function au(t, l) {
    ((l = l.props.ref), (t.ref = l !== void 0 ? l : null));
  }
  function sn(t, l) {
    throw l.$$typeof === H
      ? Error(o(525))
      : ((t = Object.prototype.toString.call(l)),
        Error(
          o(
            31,
            t === "[object Object]"
              ? "object with keys {" + Object.keys(l).join(", ") + "}"
              : t,
          ),
        ));
  }
  function cr(t) {
    function l(p, y) {
      if (t) {
        var b = p.deletions;
        b === null ? ((p.deletions = [y]), (p.flags |= 16)) : b.push(y);
      }
    }
    function e(p, y) {
      if (!t) return null;
      for (; y !== null; ) (l(p, y), (y = y.sibling));
      return null;
    }
    function a(p) {
      for (var y = new Map(); p !== null; )
        (p.key !== null ? y.set(p.key, p) : y.set(p.index, p), (p = p.sibling));
      return y;
    }
    function u(p, y) {
      return ((p = Xl(p, y)), (p.index = 0), (p.sibling = null), p);
    }
    function n(p, y, b) {
      return (
        (p.index = b),
        t
          ? ((b = p.alternate),
            b !== null
              ? ((b = b.index), b < y ? ((p.flags |= 67108866), y) : b)
              : ((p.flags |= 67108866), y))
          : ((p.flags |= 1048576), y)
      );
    }
    function i(p) {
      return (t && p.alternate === null && (p.flags |= 67108866), p);
    }
    function c(p, y, b, C) {
      return y === null || y.tag !== 6
        ? ((y = Qi(b, p.mode, C)), (y.return = p), y)
        : ((y = u(y, b)), (y.return = p), y);
    }
    function d(p, y, b, C) {
      var K = b.type;
      return K === Z
        ? R(p, y, b.props.children, C, b.key)
        : y !== null &&
            (y.elementType === K ||
              (typeof K == "object" &&
                K !== null &&
                K.$$typeof === Dt &&
                Ze(K) === y.type))
          ? ((y = u(y, b.props)), au(y, b), (y.return = p), y)
          : ((y = en(b.type, b.key, b.props, null, p.mode, C)),
            au(y, b),
            (y.return = p),
            y);
    }
    function T(p, y, b, C) {
      return y === null ||
        y.tag !== 4 ||
        y.stateNode.containerInfo !== b.containerInfo ||
        y.stateNode.implementation !== b.implementation
        ? ((y = Zi(b, p.mode, C)), (y.return = p), y)
        : ((y = u(y, b.children || [])), (y.return = p), y);
    }
    function R(p, y, b, C, K) {
      return y === null || y.tag !== 7
        ? ((y = Ye(b, p.mode, C, K)), (y.return = p), y)
        : ((y = u(y, b)), (y.return = p), y);
    }
    function N(p, y, b) {
      if (
        (typeof y == "string" && y !== "") ||
        typeof y == "number" ||
        typeof y == "bigint"
      )
        return ((y = Qi("" + y, p.mode, b)), (y.return = p), y);
      if (typeof y == "object" && y !== null) {
        switch (y.$$typeof) {
          case G:
            return (
              (b = en(y.type, y.key, y.props, null, p.mode, b)),
              au(b, y),
              (b.return = p),
              b
            );
          case w:
            return ((y = Zi(y, p.mode, b)), (y.return = p), y);
          case Dt:
            return ((y = Ze(y)), N(p, y, b));
        }
        if (Rl(y) || kt(y))
          return ((y = Ye(y, p.mode, b, null)), (y.return = p), y);
        if (typeof y.then == "function") return N(p, rn(y), b);
        if (y.$$typeof === Y) return N(p, nn(p, y), b);
        sn(p, y);
      }
      return null;
    }
    function z(p, y, b, C) {
      var K = y !== null ? y.key : null;
      if (
        (typeof b == "string" && b !== "") ||
        typeof b == "number" ||
        typeof b == "bigint"
      )
        return K !== null ? null : c(p, y, "" + b, C);
      if (typeof b == "object" && b !== null) {
        switch (b.$$typeof) {
          case G:
            return b.key === K ? d(p, y, b, C) : null;
          case w:
            return b.key === K ? T(p, y, b, C) : null;
          case Dt:
            return ((b = Ze(b)), z(p, y, b, C));
        }
        if (Rl(b) || kt(b)) return K !== null ? null : R(p, y, b, C, null);
        if (typeof b.then == "function") return z(p, y, rn(b), C);
        if (b.$$typeof === Y) return z(p, y, nn(p, b), C);
        sn(p, b);
      }
      return null;
    }
    function _(p, y, b, C, K) {
      if (
        (typeof C == "string" && C !== "") ||
        typeof C == "number" ||
        typeof C == "bigint"
      )
        return ((p = p.get(b) || null), c(y, p, "" + C, K));
      if (typeof C == "object" && C !== null) {
        switch (C.$$typeof) {
          case G:
            return (
              (p = p.get(C.key === null ? b : C.key) || null),
              d(y, p, C, K)
            );
          case w:
            return (
              (p = p.get(C.key === null ? b : C.key) || null),
              T(y, p, C, K)
            );
          case Dt:
            return ((C = Ze(C)), _(p, y, b, C, K));
        }
        if (Rl(C) || kt(C))
          return ((p = p.get(b) || null), R(y, p, C, K, null));
        if (typeof C.then == "function") return _(p, y, b, rn(C), K);
        if (C.$$typeof === Y) return _(p, y, b, nn(y, C), K);
        sn(y, C);
      }
      return null;
    }
    function L(p, y, b, C) {
      for (
        var K = null, ct = null, Q = y, tt = (y = 0), nt = null;
        Q !== null && tt < b.length;
        tt++
      ) {
        Q.index > tt ? ((nt = Q), (Q = null)) : (nt = Q.sibling);
        var ot = z(p, Q, b[tt], C);
        if (ot === null) {
          Q === null && (Q = nt);
          break;
        }
        (t && Q && ot.alternate === null && l(p, Q),
          (y = n(ot, y, tt)),
          ct === null ? (K = ot) : (ct.sibling = ot),
          (ct = ot),
          (Q = nt));
      }
      if (tt === b.length) return (e(p, Q), it && Ql(p, tt), K);
      if (Q === null) {
        for (; tt < b.length; tt++)
          ((Q = N(p, b[tt], C)),
            Q !== null &&
              ((y = n(Q, y, tt)),
              ct === null ? (K = Q) : (ct.sibling = Q),
              (ct = Q)));
        return (it && Ql(p, tt), K);
      }
      for (Q = a(Q); tt < b.length; tt++)
        ((nt = _(Q, p, tt, b[tt], C)),
          nt !== null &&
            (t &&
              nt.alternate !== null &&
              Q.delete(nt.key === null ? tt : nt.key),
            (y = n(nt, y, tt)),
            ct === null ? (K = nt) : (ct.sibling = nt),
            (ct = nt)));
      return (
        t &&
          Q.forEach(function (Me) {
            return l(p, Me);
          }),
        it && Ql(p, tt),
        K
      );
    }
    function J(p, y, b, C) {
      if (b == null) throw Error(o(151));
      for (
        var K = null, ct = null, Q = y, tt = (y = 0), nt = null, ot = b.next();
        Q !== null && !ot.done;
        tt++, ot = b.next()
      ) {
        Q.index > tt ? ((nt = Q), (Q = null)) : (nt = Q.sibling);
        var Me = z(p, Q, ot.value, C);
        if (Me === null) {
          Q === null && (Q = nt);
          break;
        }
        (t && Q && Me.alternate === null && l(p, Q),
          (y = n(Me, y, tt)),
          ct === null ? (K = Me) : (ct.sibling = Me),
          (ct = Me),
          (Q = nt));
      }
      if (ot.done) return (e(p, Q), it && Ql(p, tt), K);
      if (Q === null) {
        for (; !ot.done; tt++, ot = b.next())
          ((ot = N(p, ot.value, C)),
            ot !== null &&
              ((y = n(ot, y, tt)),
              ct === null ? (K = ot) : (ct.sibling = ot),
              (ct = ot)));
        return (it && Ql(p, tt), K);
      }
      for (Q = a(Q); !ot.done; tt++, ot = b.next())
        ((ot = _(Q, p, tt, ot.value, C)),
          ot !== null &&
            (t &&
              ot.alternate !== null &&
              Q.delete(ot.key === null ? tt : ot.key),
            (y = n(ot, y, tt)),
            ct === null ? (K = ot) : (ct.sibling = ot),
            (ct = ot)));
      return (
        t &&
          Q.forEach(function (Iy) {
            return l(p, Iy);
          }),
        it && Ql(p, tt),
        K
      );
    }
    function pt(p, y, b, C) {
      if (
        (typeof b == "object" &&
          b !== null &&
          b.type === Z &&
          b.key === null &&
          (b = b.props.children),
        typeof b == "object" && b !== null)
      ) {
        switch (b.$$typeof) {
          case G:
            t: {
              for (var K = b.key; y !== null; ) {
                if (y.key === K) {
                  if (((K = b.type), K === Z)) {
                    if (y.tag === 7) {
                      (e(p, y.sibling),
                        (C = u(y, b.props.children)),
                        (C.return = p),
                        (p = C));
                      break t;
                    }
                  } else if (
                    y.elementType === K ||
                    (typeof K == "object" &&
                      K !== null &&
                      K.$$typeof === Dt &&
                      Ze(K) === y.type)
                  ) {
                    (e(p, y.sibling),
                      (C = u(y, b.props)),
                      au(C, b),
                      (C.return = p),
                      (p = C));
                    break t;
                  }
                  e(p, y);
                  break;
                } else l(p, y);
                y = y.sibling;
              }
              b.type === Z
                ? ((C = Ye(b.props.children, p.mode, C, b.key)),
                  (C.return = p),
                  (p = C))
                : ((C = en(b.type, b.key, b.props, null, p.mode, C)),
                  au(C, b),
                  (C.return = p),
                  (p = C));
            }
            return i(p);
          case w:
            t: {
              for (K = b.key; y !== null; ) {
                if (y.key === K)
                  if (
                    y.tag === 4 &&
                    y.stateNode.containerInfo === b.containerInfo &&
                    y.stateNode.implementation === b.implementation
                  ) {
                    (e(p, y.sibling),
                      (C = u(y, b.children || [])),
                      (C.return = p),
                      (p = C));
                    break t;
                  } else {
                    e(p, y);
                    break;
                  }
                else l(p, y);
                y = y.sibling;
              }
              ((C = Zi(b, p.mode, C)), (C.return = p), (p = C));
            }
            return i(p);
          case Dt:
            return ((b = Ze(b)), pt(p, y, b, C));
        }
        if (Rl(b)) return L(p, y, b, C);
        if (kt(b)) {
          if (((K = kt(b)), typeof K != "function")) throw Error(o(150));
          return ((b = K.call(b)), J(p, y, b, C));
        }
        if (typeof b.then == "function") return pt(p, y, rn(b), C);
        if (b.$$typeof === Y) return pt(p, y, nn(p, b), C);
        sn(p, b);
      }
      return (typeof b == "string" && b !== "") ||
        typeof b == "number" ||
        typeof b == "bigint"
        ? ((b = "" + b),
          y !== null && y.tag === 6
            ? (e(p, y.sibling), (C = u(y, b)), (C.return = p), (p = C))
            : (e(p, y), (C = Qi(b, p.mode, C)), (C.return = p), (p = C)),
          i(p))
        : e(p, y);
    }
    return function (p, y, b, C) {
      try {
        eu = 0;
        var K = pt(p, y, b, C);
        return ((ga = null), K);
      } catch (Q) {
        if (Q === va || Q === cn) throw Q;
        var ct = cl(29, Q, null, p.mode);
        return ((ct.lanes = C), (ct.return = p), ct);
      } finally {
      }
    };
  }
  var Ke = cr(!0),
    or = cr(!1),
    se = !1;
  function lf(t) {
    t.updateQueue = {
      baseState: t.memoizedState,
      firstBaseUpdate: null,
      lastBaseUpdate: null,
      shared: { pending: null, lanes: 0, hiddenCallbacks: null },
      callbacks: null,
    };
  }
  function ef(t, l) {
    ((t = t.updateQueue),
      l.updateQueue === t &&
        (l.updateQueue = {
          baseState: t.baseState,
          firstBaseUpdate: t.firstBaseUpdate,
          lastBaseUpdate: t.lastBaseUpdate,
          shared: t.shared,
          callbacks: null,
        }));
  }
  function de(t) {
    return { lane: t, tag: 0, payload: null, callback: null, next: null };
  }
  function he(t, l, e) {
    var a = t.updateQueue;
    if (a === null) return null;
    if (((a = a.shared), (rt & 2) !== 0)) {
      var u = a.pending;
      return (
        u === null ? (l.next = l) : ((l.next = u.next), (u.next = l)),
        (a.pending = l),
        (l = ln(t)),
        Jo(t, null, e),
        l
      );
    }
    return (tn(t, a, l, e), ln(t));
  }
  function uu(t, l, e) {
    if (
      ((l = l.updateQueue), l !== null && ((l = l.shared), (e & 4194048) !== 0))
    ) {
      var a = l.lanes;
      ((a &= t.pendingLanes), (e |= a), (l.lanes = e), Pc(t, e));
    }
  }
  function af(t, l) {
    var e = t.updateQueue,
      a = t.alternate;
    if (a !== null && ((a = a.updateQueue), e === a)) {
      var u = null,
        n = null;
      if (((e = e.firstBaseUpdate), e !== null)) {
        do {
          var i = {
            lane: e.lane,
            tag: e.tag,
            payload: e.payload,
            callback: null,
            next: null,
          };
          (n === null ? (u = n = i) : (n = n.next = i), (e = e.next));
        } while (e !== null);
        n === null ? (u = n = l) : (n = n.next = l);
      } else u = n = l;
      ((e = {
        baseState: a.baseState,
        firstBaseUpdate: u,
        lastBaseUpdate: n,
        shared: a.shared,
        callbacks: a.callbacks,
      }),
        (t.updateQueue = e));
      return;
    }
    ((t = e.lastBaseUpdate),
      t === null ? (e.firstBaseUpdate = l) : (t.next = l),
      (e.lastBaseUpdate = l));
  }
  var uf = !1;
  function nu() {
    if (uf) {
      var t = ya;
      if (t !== null) throw t;
    }
  }
  function iu(t, l, e, a) {
    uf = !1;
    var u = t.updateQueue;
    se = !1;
    var n = u.firstBaseUpdate,
      i = u.lastBaseUpdate,
      c = u.shared.pending;
    if (c !== null) {
      u.shared.pending = null;
      var d = c,
        T = d.next;
      ((d.next = null), i === null ? (n = T) : (i.next = T), (i = d));
      var R = t.alternate;
      R !== null &&
        ((R = R.updateQueue),
        (c = R.lastBaseUpdate),
        c !== i &&
          (c === null ? (R.firstBaseUpdate = T) : (c.next = T),
          (R.lastBaseUpdate = d)));
    }
    if (n !== null) {
      var N = u.baseState;
      ((i = 0), (R = T = d = null), (c = n));
      do {
        var z = c.lane & -536870913,
          _ = z !== c.lane;
        if (_ ? (ut & z) === z : (a & z) === z) {
          (z !== 0 && z === ma && (uf = !0),
            R !== null &&
              (R = R.next =
                {
                  lane: 0,
                  tag: c.tag,
                  payload: c.payload,
                  callback: null,
                  next: null,
                }));
          t: {
            var L = t,
              J = c;
            z = l;
            var pt = e;
            switch (J.tag) {
              case 1:
                if (((L = J.payload), typeof L == "function")) {
                  N = L.call(pt, N, z);
                  break t;
                }
                N = L;
                break t;
              case 3:
                L.flags = (L.flags & -65537) | 128;
              case 0:
                if (
                  ((L = J.payload),
                  (z = typeof L == "function" ? L.call(pt, N, z) : L),
                  z == null)
                )
                  break t;
                N = A({}, N, z);
                break t;
              case 2:
                se = !0;
            }
          }
          ((z = c.callback),
            z !== null &&
              ((t.flags |= 64),
              _ && (t.flags |= 8192),
              (_ = u.callbacks),
              _ === null ? (u.callbacks = [z]) : _.push(z)));
        } else
          ((_ = {
            lane: z,
            tag: c.tag,
            payload: c.payload,
            callback: c.callback,
            next: null,
          }),
            R === null ? ((T = R = _), (d = N)) : (R = R.next = _),
            (i |= z));
        if (((c = c.next), c === null)) {
          if (((c = u.shared.pending), c === null)) break;
          ((_ = c),
            (c = _.next),
            (_.next = null),
            (u.lastBaseUpdate = _),
            (u.shared.pending = null));
        }
      } while (!0);
      (R === null && (d = N),
        (u.baseState = d),
        (u.firstBaseUpdate = T),
        (u.lastBaseUpdate = R),
        n === null && (u.shared.lanes = 0),
        (pe |= i),
        (t.lanes = i),
        (t.memoizedState = N));
    }
  }
  function rr(t, l) {
    if (typeof t != "function") throw Error(o(191, t));
    t.call(l);
  }
  function sr(t, l) {
    var e = t.callbacks;
    if (e !== null)
      for (t.callbacks = null, t = 0; t < e.length; t++) rr(e[t], l);
  }
  var pa = g(null),
    dn = g(0);
  function dr(t, l) {
    ((t = Pl), j(dn, t), j(pa, l), (Pl = t | l.baseLanes));
  }
  function nf() {
    (j(dn, Pl), j(pa, pa.current));
  }
  function ff() {
    ((Pl = dn.current), x(pa), x(dn));
  }
  var ol = g(null),
    zl = null;
  function me(t) {
    var l = t.alternate;
    (j(Ut, Ut.current & 1),
      j(ol, t),
      zl === null &&
        (l === null || pa.current !== null || l.memoizedState !== null) &&
        (zl = t));
  }
  function cf(t) {
    (j(Ut, Ut.current), j(ol, t), zl === null && (zl = t));
  }
  function hr(t) {
    t.tag === 22
      ? (j(Ut, Ut.current), j(ol, t), zl === null && (zl = t))
      : ye();
  }
  function ye() {
    (j(Ut, Ut.current), j(ol, ol.current));
  }
  function rl(t) {
    (x(ol), zl === t && (zl = null), x(Ut));
  }
  var Ut = g(0);
  function hn(t) {
    for (var l = t; l !== null; ) {
      if (l.tag === 13) {
        var e = l.memoizedState;
        if (e !== null && ((e = e.dehydrated), e === null || mc(e) || yc(e)))
          return l;
      } else if (
        l.tag === 19 &&
        (l.memoizedProps.revealOrder === "forwards" ||
          l.memoizedProps.revealOrder === "backwards" ||
          l.memoizedProps.revealOrder === "unstable_legacy-backwards" ||
          l.memoizedProps.revealOrder === "together")
      ) {
        if ((l.flags & 128) !== 0) return l;
      } else if (l.child !== null) {
        ((l.child.return = l), (l = l.child));
        continue;
      }
      if (l === t) break;
      for (; l.sibling === null; ) {
        if (l.return === null || l.return === t) return null;
        l = l.return;
      }
      ((l.sibling.return = l.return), (l = l.sibling));
    }
    return null;
  }
  var Kl = 0,
    P = null,
    vt = null,
    Bt = null,
    mn = !1,
    Sa = !1,
    Je = !1,
    yn = 0,
    fu = 0,
    ba = null,
    Qm = 0;
  function Ot() {
    throw Error(o(321));
  }
  function of(t, l) {
    if (l === null) return !1;
    for (var e = 0; e < l.length && e < t.length; e++)
      if (!fl(t[e], l[e])) return !1;
    return !0;
  }
  function rf(t, l, e, a, u, n) {
    return (
      (Kl = n),
      (P = l),
      (l.memoizedState = null),
      (l.updateQueue = null),
      (l.lanes = 0),
      (D.H = t === null || t.memoizedState === null ? kr : Af),
      (Je = !1),
      (n = e(a, u)),
      (Je = !1),
      Sa && (n = yr(l, e, a, u)),
      mr(t),
      n
    );
  }
  function mr(t) {
    D.H = ru;
    var l = vt !== null && vt.next !== null;
    if (((Kl = 0), (Bt = vt = P = null), (mn = !1), (fu = 0), (ba = null), l))
      throw Error(o(300));
    t === null ||
      qt ||
      ((t = t.dependencies), t !== null && un(t) && (qt = !0));
  }
  function yr(t, l, e, a) {
    P = t;
    var u = 0;
    do {
      if ((Sa && (ba = null), (fu = 0), (Sa = !1), 25 <= u))
        throw Error(o(301));
      if (((u += 1), (Bt = vt = null), t.updateQueue != null)) {
        var n = t.updateQueue;
        ((n.lastEffect = null),
          (n.events = null),
          (n.stores = null),
          n.memoCache != null && (n.memoCache.index = 0));
      }
      ((D.H = Fr), (n = l(e, a)));
    } while (Sa);
    return n;
  }
  function Zm() {
    var t = D.H,
      l = t.useState()[0];
    return (
      (l = typeof l.then == "function" ? cu(l) : l),
      (t = t.useState()[0]),
      (vt !== null ? vt.memoizedState : null) !== t && (P.flags |= 1024),
      l
    );
  }
  function sf() {
    var t = yn !== 0;
    return ((yn = 0), t);
  }
  function df(t, l, e) {
    ((l.updateQueue = t.updateQueue), (l.flags &= -2053), (t.lanes &= ~e));
  }
  function hf(t) {
    if (mn) {
      for (t = t.memoizedState; t !== null; ) {
        var l = t.queue;
        (l !== null && (l.pending = null), (t = t.next));
      }
      mn = !1;
    }
    ((Kl = 0), (Bt = vt = P = null), (Sa = !1), (fu = yn = 0), (ba = null));
  }
  function Wt() {
    var t = {
      memoizedState: null,
      baseState: null,
      baseQueue: null,
      queue: null,
      next: null,
    };
    return (Bt === null ? (P.memoizedState = Bt = t) : (Bt = Bt.next = t), Bt);
  }
  function Nt() {
    if (vt === null) {
      var t = P.alternate;
      t = t !== null ? t.memoizedState : null;
    } else t = vt.next;
    var l = Bt === null ? P.memoizedState : Bt.next;
    if (l !== null) ((Bt = l), (vt = t));
    else {
      if (t === null)
        throw P.alternate === null ? Error(o(467)) : Error(o(310));
      ((vt = t),
        (t = {
          memoizedState: vt.memoizedState,
          baseState: vt.baseState,
          baseQueue: vt.baseQueue,
          queue: vt.queue,
          next: null,
        }),
        Bt === null ? (P.memoizedState = Bt = t) : (Bt = Bt.next = t));
    }
    return Bt;
  }
  function vn() {
    return { lastEffect: null, events: null, stores: null, memoCache: null };
  }
  function cu(t) {
    var l = fu;
    return (
      (fu += 1),
      ba === null && (ba = []),
      (t = nr(ba, t, l)),
      (l = P),
      (Bt === null ? l.memoizedState : Bt.next) === null &&
        ((l = l.alternate),
        (D.H = l === null || l.memoizedState === null ? kr : Af)),
      t
    );
  }
  function gn(t) {
    if (t !== null && typeof t == "object") {
      if (typeof t.then == "function") return cu(t);
      if (t.$$typeof === Y) return Vt(t);
    }
    throw Error(o(438, String(t)));
  }
  function mf(t) {
    var l = null,
      e = P.updateQueue;
    if ((e !== null && (l = e.memoCache), l == null)) {
      var a = P.alternate;
      a !== null &&
        ((a = a.updateQueue),
        a !== null &&
          ((a = a.memoCache),
          a != null &&
            (l = {
              data: a.data.map(function (u) {
                return u.slice();
              }),
              index: 0,
            })));
    }
    if (
      (l == null && (l = { data: [], index: 0 }),
      e === null && ((e = vn()), (P.updateQueue = e)),
      (e.memoCache = l),
      (e = l.data[l.index]),
      e === void 0)
    )
      for (e = l.data[l.index] = Array(t), a = 0; a < t; a++) e[a] = yl;
    return (l.index++, e);
  }
  function Jl(t, l) {
    return typeof l == "function" ? l(t) : l;
  }
  function pn(t) {
    var l = Nt();
    return yf(l, vt, t);
  }
  function yf(t, l, e) {
    var a = t.queue;
    if (a === null) throw Error(o(311));
    a.lastRenderedReducer = e;
    var u = t.baseQueue,
      n = a.pending;
    if (n !== null) {
      if (u !== null) {
        var i = u.next;
        ((u.next = n.next), (n.next = i));
      }
      ((l.baseQueue = u = n), (a.pending = null));
    }
    if (((n = t.baseState), u === null)) t.memoizedState = n;
    else {
      l = u.next;
      var c = (i = null),
        d = null,
        T = l,
        R = !1;
      do {
        var N = T.lane & -536870913;
        if (N !== T.lane ? (ut & N) === N : (Kl & N) === N) {
          var z = T.revertLane;
          if (z === 0)
            (d !== null &&
              (d = d.next =
                {
                  lane: 0,
                  revertLane: 0,
                  gesture: null,
                  action: T.action,
                  hasEagerState: T.hasEagerState,
                  eagerState: T.eagerState,
                  next: null,
                }),
              N === ma && (R = !0));
          else if ((Kl & z) === z) {
            ((T = T.next), z === ma && (R = !0));
            continue;
          } else
            ((N = {
              lane: 0,
              revertLane: T.revertLane,
              gesture: null,
              action: T.action,
              hasEagerState: T.hasEagerState,
              eagerState: T.eagerState,
              next: null,
            }),
              d === null ? ((c = d = N), (i = n)) : (d = d.next = N),
              (P.lanes |= z),
              (pe |= z));
          ((N = T.action),
            Je && e(n, N),
            (n = T.hasEagerState ? T.eagerState : e(n, N)));
        } else
          ((z = {
            lane: N,
            revertLane: T.revertLane,
            gesture: T.gesture,
            action: T.action,
            hasEagerState: T.hasEagerState,
            eagerState: T.eagerState,
            next: null,
          }),
            d === null ? ((c = d = z), (i = n)) : (d = d.next = z),
            (P.lanes |= N),
            (pe |= N));
        T = T.next;
      } while (T !== null && T !== l);
      if (
        (d === null ? (i = n) : (d.next = c),
        !fl(n, t.memoizedState) && ((qt = !0), R && ((e = ya), e !== null)))
      )
        throw e;
      ((t.memoizedState = n),
        (t.baseState = i),
        (t.baseQueue = d),
        (a.lastRenderedState = n));
    }
    return (u === null && (a.lanes = 0), [t.memoizedState, a.dispatch]);
  }
  function vf(t) {
    var l = Nt(),
      e = l.queue;
    if (e === null) throw Error(o(311));
    e.lastRenderedReducer = t;
    var a = e.dispatch,
      u = e.pending,
      n = l.memoizedState;
    if (u !== null) {
      e.pending = null;
      var i = (u = u.next);
      do ((n = t(n, i.action)), (i = i.next));
      while (i !== u);
      (fl(n, l.memoizedState) || (qt = !0),
        (l.memoizedState = n),
        l.baseQueue === null && (l.baseState = n),
        (e.lastRenderedState = n));
    }
    return [n, a];
  }
  function vr(t, l, e) {
    var a = P,
      u = Nt(),
      n = it;
    if (n) {
      if (e === void 0) throw Error(o(407));
      e = e();
    } else e = l();
    var i = !fl((vt || u).memoizedState, e);
    if (
      (i && ((u.memoizedState = e), (qt = !0)),
      (u = u.queue),
      Sf(Sr.bind(null, a, u, t), [t]),
      u.getSnapshot !== l || i || (Bt !== null && Bt.memoizedState.tag & 1))
    ) {
      if (
        ((a.flags |= 2048),
        Ea(9, { destroy: void 0 }, pr.bind(null, a, u, e, l), null),
        Et === null)
      )
        throw Error(o(349));
      n || (Kl & 127) !== 0 || gr(a, l, e);
    }
    return e;
  }
  function gr(t, l, e) {
    ((t.flags |= 16384),
      (t = { getSnapshot: l, value: e }),
      (l = P.updateQueue),
      l === null
        ? ((l = vn()), (P.updateQueue = l), (l.stores = [t]))
        : ((e = l.stores), e === null ? (l.stores = [t]) : e.push(t)));
  }
  function pr(t, l, e, a) {
    ((l.value = e), (l.getSnapshot = a), br(l) && Er(t));
  }
  function Sr(t, l, e) {
    return e(function () {
      br(l) && Er(t);
    });
  }
  function br(t) {
    var l = t.getSnapshot;
    t = t.value;
    try {
      var e = l();
      return !fl(t, e);
    } catch {
      return !0;
    }
  }
  function Er(t) {
    var l = je(t, 2);
    l !== null && al(l, t, 2);
  }
  function gf(t) {
    var l = Wt();
    if (typeof t == "function") {
      var e = t;
      if (((t = e()), Je)) {
        ue(!0);
        try {
          e();
        } finally {
          ue(!1);
        }
      }
    }
    return (
      (l.memoizedState = l.baseState = t),
      (l.queue = {
        pending: null,
        lanes: 0,
        dispatch: null,
        lastRenderedReducer: Jl,
        lastRenderedState: t,
      }),
      l
    );
  }
  function Tr(t, l, e, a) {
    return ((t.baseState = e), yf(t, vt, typeof a == "function" ? a : Jl));
  }
  function Vm(t, l, e, a, u) {
    if (En(t)) throw Error(o(485));
    if (((t = l.action), t !== null)) {
      var n = {
        payload: u,
        action: t,
        next: null,
        isTransition: !0,
        status: "pending",
        value: null,
        reason: null,
        listeners: [],
        then: function (i) {
          n.listeners.push(i);
        },
      };
      (D.T !== null ? e(!0) : (n.isTransition = !1),
        a(n),
        (e = l.pending),
        e === null
          ? ((n.next = l.pending = n), zr(l, n))
          : ((n.next = e.next), (l.pending = e.next = n)));
    }
  }
  function zr(t, l) {
    var e = l.action,
      a = l.payload,
      u = t.state;
    if (l.isTransition) {
      var n = D.T,
        i = {};
      D.T = i;
      try {
        var c = e(u, a),
          d = D.S;
        (d !== null && d(i, c), _r(t, l, c));
      } catch (T) {
        pf(t, l, T);
      } finally {
        (n !== null && i.types !== null && (n.types = i.types), (D.T = n));
      }
    } else
      try {
        ((n = e(u, a)), _r(t, l, n));
      } catch (T) {
        pf(t, l, T);
      }
  }
  function _r(t, l, e) {
    e !== null && typeof e == "object" && typeof e.then == "function"
      ? e.then(
          function (a) {
            Ar(t, l, a);
          },
          function (a) {
            return pf(t, l, a);
          },
        )
      : Ar(t, l, e);
  }
  function Ar(t, l, e) {
    ((l.status = "fulfilled"),
      (l.value = e),
      Rr(l),
      (t.state = e),
      (l = t.pending),
      l !== null &&
        ((e = l.next),
        e === l ? (t.pending = null) : ((e = e.next), (l.next = e), zr(t, e))));
  }
  function pf(t, l, e) {
    var a = t.pending;
    if (((t.pending = null), a !== null)) {
      a = a.next;
      do ((l.status = "rejected"), (l.reason = e), Rr(l), (l = l.next));
      while (l !== a);
    }
    t.action = null;
  }
  function Rr(t) {
    t = t.listeners;
    for (var l = 0; l < t.length; l++) (0, t[l])();
  }
  function Or(t, l) {
    return l;
  }
  function Mr(t, l) {
    if (it) {
      var e = Et.formState;
      if (e !== null) {
        t: {
          var a = P;
          if (it) {
            if (Tt) {
              l: {
                for (var u = Tt, n = Tl; u.nodeType !== 8; ) {
                  if (!n) {
                    u = null;
                    break l;
                  }
                  if (((u = _l(u.nextSibling)), u === null)) {
                    u = null;
                    break l;
                  }
                }
                ((n = u.data), (u = n === "F!" || n === "F" ? u : null));
              }
              if (u) {
                ((Tt = _l(u.nextSibling)), (a = u.data === "F!"));
                break t;
              }
            }
            oe(a);
          }
          a = !1;
        }
        a && (l = e[0]);
      }
    }
    return (
      (e = Wt()),
      (e.memoizedState = e.baseState = l),
      (a = {
        pending: null,
        lanes: 0,
        dispatch: null,
        lastRenderedReducer: Or,
        lastRenderedState: l,
      }),
      (e.queue = a),
      (e = wr.bind(null, P, a)),
      (a.dispatch = e),
      (a = gf(!1)),
      (n = _f.bind(null, P, !1, a.queue)),
      (a = Wt()),
      (u = { state: l, dispatch: null, action: t, pending: null }),
      (a.queue = u),
      (e = Vm.bind(null, P, u, n, e)),
      (u.dispatch = e),
      (a.memoizedState = t),
      [l, e, !1]
    );
  }
  function Dr(t) {
    var l = Nt();
    return Cr(l, vt, t);
  }
  function Cr(t, l, e) {
    if (
      ((l = yf(t, l, Or)[0]),
      (t = pn(Jl)[0]),
      typeof l == "object" && l !== null && typeof l.then == "function")
    )
      try {
        var a = cu(l);
      } catch (i) {
        throw i === va ? cn : i;
      }
    else a = l;
    l = Nt();
    var u = l.queue,
      n = u.dispatch;
    return (
      e !== l.memoizedState &&
        ((P.flags |= 2048),
        Ea(9, { destroy: void 0 }, Km.bind(null, u, e), null)),
      [a, n, t]
    );
  }
  function Km(t, l) {
    t.action = l;
  }
  function Ur(t) {
    var l = Nt(),
      e = vt;
    if (e !== null) return Cr(l, e, t);
    (Nt(), (l = l.memoizedState), (e = Nt()));
    var a = e.queue.dispatch;
    return ((e.memoizedState = t), [l, a, !1]);
  }
  function Ea(t, l, e, a) {
    return (
      (t = { tag: t, create: e, deps: a, inst: l, next: null }),
      (l = P.updateQueue),
      l === null && ((l = vn()), (P.updateQueue = l)),
      (e = l.lastEffect),
      e === null
        ? (l.lastEffect = t.next = t)
        : ((a = e.next), (e.next = t), (t.next = a), (l.lastEffect = t)),
      t
    );
  }
  function Nr() {
    return Nt().memoizedState;
  }
  function Sn(t, l, e, a) {
    var u = Wt();
    ((P.flags |= t),
      (u.memoizedState = Ea(
        1 | l,
        { destroy: void 0 },
        e,
        a === void 0 ? null : a,
      )));
  }
  function bn(t, l, e, a) {
    var u = Nt();
    a = a === void 0 ? null : a;
    var n = u.memoizedState.inst;
    vt !== null && a !== null && of(a, vt.memoizedState.deps)
      ? (u.memoizedState = Ea(l, n, e, a))
      : ((P.flags |= t), (u.memoizedState = Ea(1 | l, n, e, a)));
  }
  function xr(t, l) {
    Sn(8390656, 8, t, l);
  }
  function Sf(t, l) {
    bn(2048, 8, t, l);
  }
  function Jm(t) {
    P.flags |= 4;
    var l = P.updateQueue;
    if (l === null) ((l = vn()), (P.updateQueue = l), (l.events = [t]));
    else {
      var e = l.events;
      e === null ? (l.events = [t]) : e.push(t);
    }
  }
  function Hr(t) {
    var l = Nt().memoizedState;
    return (
      Jm({ ref: l, nextImpl: t }),
      function () {
        if ((rt & 2) !== 0) throw Error(o(440));
        return l.impl.apply(void 0, arguments);
      }
    );
  }
  function Br(t, l) {
    return bn(4, 2, t, l);
  }
  function qr(t, l) {
    return bn(4, 4, t, l);
  }
  function jr(t, l) {
    if (typeof l == "function") {
      t = t();
      var e = l(t);
      return function () {
        typeof e == "function" ? e() : l(null);
      };
    }
    if (l != null)
      return (
        (t = t()),
        (l.current = t),
        function () {
          l.current = null;
        }
      );
  }
  function Yr(t, l, e) {
    ((e = e != null ? e.concat([t]) : null), bn(4, 4, jr.bind(null, l, t), e));
  }
  function bf() {}
  function Lr(t, l) {
    var e = Nt();
    l = l === void 0 ? null : l;
    var a = e.memoizedState;
    return l !== null && of(l, a[1]) ? a[0] : ((e.memoizedState = [t, l]), t);
  }
  function Gr(t, l) {
    var e = Nt();
    l = l === void 0 ? null : l;
    var a = e.memoizedState;
    if (l !== null && of(l, a[1])) return a[0];
    if (((a = t()), Je)) {
      ue(!0);
      try {
        t();
      } finally {
        ue(!1);
      }
    }
    return ((e.memoizedState = [a, l]), a);
  }
  function Ef(t, l, e) {
    return e === void 0 || ((Kl & 1073741824) !== 0 && (ut & 261930) === 0)
      ? (t.memoizedState = l)
      : ((t.memoizedState = e), (t = Xs()), (P.lanes |= t), (pe |= t), e);
  }
  function Xr(t, l, e, a) {
    return fl(e, l)
      ? e
      : pa.current !== null
        ? ((t = Ef(t, e, a)), fl(t, l) || (qt = !0), t)
        : (Kl & 42) === 0 || ((Kl & 1073741824) !== 0 && (ut & 261930) === 0)
          ? ((qt = !0), (t.memoizedState = e))
          : ((t = Xs()), (P.lanes |= t), (pe |= t), l);
  }
  function Qr(t, l, e, a, u) {
    var n = B.p;
    B.p = n !== 0 && 8 > n ? n : 8;
    var i = D.T,
      c = {};
    ((D.T = c), _f(t, !1, l, e));
    try {
      var d = u(),
        T = D.S;
      if (
        (T !== null && T(c, d),
        d !== null && typeof d == "object" && typeof d.then == "function")
      ) {
        var R = Xm(d, a);
        ou(t, l, R, hl(t));
      } else ou(t, l, a, hl(t));
    } catch (N) {
      ou(t, l, { then: function () {}, status: "rejected", reason: N }, hl());
    } finally {
      ((B.p = n),
        i !== null && c.types !== null && (i.types = c.types),
        (D.T = i));
    }
  }
  function wm() {}
  function Tf(t, l, e, a) {
    if (t.tag !== 5) throw Error(o(476));
    var u = Zr(t).queue;
    Qr(
      t,
      u,
      l,
      W,
      e === null
        ? wm
        : function () {
            return (Vr(t), e(a));
          },
    );
  }
  function Zr(t) {
    var l = t.memoizedState;
    if (l !== null) return l;
    l = {
      memoizedState: W,
      baseState: W,
      baseQueue: null,
      queue: {
        pending: null,
        lanes: 0,
        dispatch: null,
        lastRenderedReducer: Jl,
        lastRenderedState: W,
      },
      next: null,
    };
    var e = {};
    return (
      (l.next = {
        memoizedState: e,
        baseState: e,
        baseQueue: null,
        queue: {
          pending: null,
          lanes: 0,
          dispatch: null,
          lastRenderedReducer: Jl,
          lastRenderedState: e,
        },
        next: null,
      }),
      (t.memoizedState = l),
      (t = t.alternate),
      t !== null && (t.memoizedState = l),
      l
    );
  }
  function Vr(t) {
    var l = Zr(t);
    (l.next === null && (l = t.alternate.memoizedState),
      ou(t, l.next.queue, {}, hl()));
  }
  function zf() {
    return Vt(Ru);
  }
  function Kr() {
    return Nt().memoizedState;
  }
  function Jr() {
    return Nt().memoizedState;
  }
  function $m(t) {
    for (var l = t.return; l !== null; ) {
      switch (l.tag) {
        case 24:
        case 3:
          var e = hl();
          t = de(e);
          var a = he(l, t, e);
          (a !== null && (al(a, l, e), uu(a, l, e)),
            (l = { cache: Fi() }),
            (t.payload = l));
          return;
      }
      l = l.return;
    }
  }
  function Wm(t, l, e) {
    var a = hl();
    ((e = {
      lane: a,
      revertLane: 0,
      gesture: null,
      action: e,
      hasEagerState: !1,
      eagerState: null,
      next: null,
    }),
      En(t)
        ? $r(l, e)
        : ((e = Gi(t, l, e, a)), e !== null && (al(e, t, a), Wr(e, l, a))));
  }
  function wr(t, l, e) {
    var a = hl();
    ou(t, l, e, a);
  }
  function ou(t, l, e, a) {
    var u = {
      lane: a,
      revertLane: 0,
      gesture: null,
      action: e,
      hasEagerState: !1,
      eagerState: null,
      next: null,
    };
    if (En(t)) $r(l, u);
    else {
      var n = t.alternate;
      if (
        t.lanes === 0 &&
        (n === null || n.lanes === 0) &&
        ((n = l.lastRenderedReducer), n !== null)
      )
        try {
          var i = l.lastRenderedState,
            c = n(i, e);
          if (((u.hasEagerState = !0), (u.eagerState = c), fl(c, i)))
            return (tn(t, l, u, 0), Et === null && Pu(), !1);
        } catch {
        } finally {
        }
      if (((e = Gi(t, l, u, a)), e !== null))
        return (al(e, t, a), Wr(e, l, a), !0);
    }
    return !1;
  }
  function _f(t, l, e, a) {
    if (
      ((a = {
        lane: 2,
        revertLane: ec(),
        gesture: null,
        action: a,
        hasEagerState: !1,
        eagerState: null,
        next: null,
      }),
      En(t))
    ) {
      if (l) throw Error(o(479));
    } else ((l = Gi(t, e, a, 2)), l !== null && al(l, t, 2));
  }
  function En(t) {
    var l = t.alternate;
    return t === P || (l !== null && l === P);
  }
  function $r(t, l) {
    Sa = mn = !0;
    var e = t.pending;
    (e === null ? (l.next = l) : ((l.next = e.next), (e.next = l)),
      (t.pending = l));
  }
  function Wr(t, l, e) {
    if ((e & 4194048) !== 0) {
      var a = l.lanes;
      ((a &= t.pendingLanes), (e |= a), (l.lanes = e), Pc(t, e));
    }
  }
  var ru = {
    readContext: Vt,
    use: gn,
    useCallback: Ot,
    useContext: Ot,
    useEffect: Ot,
    useImperativeHandle: Ot,
    useLayoutEffect: Ot,
    useInsertionEffect: Ot,
    useMemo: Ot,
    useReducer: Ot,
    useRef: Ot,
    useState: Ot,
    useDebugValue: Ot,
    useDeferredValue: Ot,
    useTransition: Ot,
    useSyncExternalStore: Ot,
    useId: Ot,
    useHostTransitionStatus: Ot,
    useFormState: Ot,
    useActionState: Ot,
    useOptimistic: Ot,
    useMemoCache: Ot,
    useCacheRefresh: Ot,
  };
  ru.useEffectEvent = Ot;
  var kr = {
      readContext: Vt,
      use: gn,
      useCallback: function (t, l) {
        return ((Wt().memoizedState = [t, l === void 0 ? null : l]), t);
      },
      useContext: Vt,
      useEffect: xr,
      useImperativeHandle: function (t, l, e) {
        ((e = e != null ? e.concat([t]) : null),
          Sn(4194308, 4, jr.bind(null, l, t), e));
      },
      useLayoutEffect: function (t, l) {
        return Sn(4194308, 4, t, l);
      },
      useInsertionEffect: function (t, l) {
        Sn(4, 2, t, l);
      },
      useMemo: function (t, l) {
        var e = Wt();
        l = l === void 0 ? null : l;
        var a = t();
        if (Je) {
          ue(!0);
          try {
            t();
          } finally {
            ue(!1);
          }
        }
        return ((e.memoizedState = [a, l]), a);
      },
      useReducer: function (t, l, e) {
        var a = Wt();
        if (e !== void 0) {
          var u = e(l);
          if (Je) {
            ue(!0);
            try {
              e(l);
            } finally {
              ue(!1);
            }
          }
        } else u = l;
        return (
          (a.memoizedState = a.baseState = u),
          (t = {
            pending: null,
            lanes: 0,
            dispatch: null,
            lastRenderedReducer: t,
            lastRenderedState: u,
          }),
          (a.queue = t),
          (t = t.dispatch = Wm.bind(null, P, t)),
          [a.memoizedState, t]
        );
      },
      useRef: function (t) {
        var l = Wt();
        return ((t = { current: t }), (l.memoizedState = t));
      },
      useState: function (t) {
        t = gf(t);
        var l = t.queue,
          e = wr.bind(null, P, l);
        return ((l.dispatch = e), [t.memoizedState, e]);
      },
      useDebugValue: bf,
      useDeferredValue: function (t, l) {
        var e = Wt();
        return Ef(e, t, l);
      },
      useTransition: function () {
        var t = gf(!1);
        return (
          (t = Qr.bind(null, P, t.queue, !0, !1)),
          (Wt().memoizedState = t),
          [!1, t]
        );
      },
      useSyncExternalStore: function (t, l, e) {
        var a = P,
          u = Wt();
        if (it) {
          if (e === void 0) throw Error(o(407));
          e = e();
        } else {
          if (((e = l()), Et === null)) throw Error(o(349));
          (ut & 127) !== 0 || gr(a, l, e);
        }
        u.memoizedState = e;
        var n = { value: e, getSnapshot: l };
        return (
          (u.queue = n),
          xr(Sr.bind(null, a, n, t), [t]),
          (a.flags |= 2048),
          Ea(9, { destroy: void 0 }, pr.bind(null, a, n, e, l), null),
          e
        );
      },
      useId: function () {
        var t = Wt(),
          l = Et.identifierPrefix;
        if (it) {
          var e = xl,
            a = Nl;
          ((e = (a & ~(1 << (32 - il(a) - 1))).toString(32) + e),
            (l = "_" + l + "R_" + e),
            (e = yn++),
            0 < e && (l += "H" + e.toString(32)),
            (l += "_"));
        } else ((e = Qm++), (l = "_" + l + "r_" + e.toString(32) + "_"));
        return (t.memoizedState = l);
      },
      useHostTransitionStatus: zf,
      useFormState: Mr,
      useActionState: Mr,
      useOptimistic: function (t) {
        var l = Wt();
        l.memoizedState = l.baseState = t;
        var e = {
          pending: null,
          lanes: 0,
          dispatch: null,
          lastRenderedReducer: null,
          lastRenderedState: null,
        };
        return (
          (l.queue = e),
          (l = _f.bind(null, P, !0, e)),
          (e.dispatch = l),
          [t, l]
        );
      },
      useMemoCache: mf,
      useCacheRefresh: function () {
        return (Wt().memoizedState = $m.bind(null, P));
      },
      useEffectEvent: function (t) {
        var l = Wt(),
          e = { impl: t };
        return (
          (l.memoizedState = e),
          function () {
            if ((rt & 2) !== 0) throw Error(o(440));
            return e.impl.apply(void 0, arguments);
          }
        );
      },
    },
    Af = {
      readContext: Vt,
      use: gn,
      useCallback: Lr,
      useContext: Vt,
      useEffect: Sf,
      useImperativeHandle: Yr,
      useInsertionEffect: Br,
      useLayoutEffect: qr,
      useMemo: Gr,
      useReducer: pn,
      useRef: Nr,
      useState: function () {
        return pn(Jl);
      },
      useDebugValue: bf,
      useDeferredValue: function (t, l) {
        var e = Nt();
        return Xr(e, vt.memoizedState, t, l);
      },
      useTransition: function () {
        var t = pn(Jl)[0],
          l = Nt().memoizedState;
        return [typeof t == "boolean" ? t : cu(t), l];
      },
      useSyncExternalStore: vr,
      useId: Kr,
      useHostTransitionStatus: zf,
      useFormState: Dr,
      useActionState: Dr,
      useOptimistic: function (t, l) {
        var e = Nt();
        return Tr(e, vt, t, l);
      },
      useMemoCache: mf,
      useCacheRefresh: Jr,
    };
  Af.useEffectEvent = Hr;
  var Fr = {
    readContext: Vt,
    use: gn,
    useCallback: Lr,
    useContext: Vt,
    useEffect: Sf,
    useImperativeHandle: Yr,
    useInsertionEffect: Br,
    useLayoutEffect: qr,
    useMemo: Gr,
    useReducer: vf,
    useRef: Nr,
    useState: function () {
      return vf(Jl);
    },
    useDebugValue: bf,
    useDeferredValue: function (t, l) {
      var e = Nt();
      return vt === null ? Ef(e, t, l) : Xr(e, vt.memoizedState, t, l);
    },
    useTransition: function () {
      var t = vf(Jl)[0],
        l = Nt().memoizedState;
      return [typeof t == "boolean" ? t : cu(t), l];
    },
    useSyncExternalStore: vr,
    useId: Kr,
    useHostTransitionStatus: zf,
    useFormState: Ur,
    useActionState: Ur,
    useOptimistic: function (t, l) {
      var e = Nt();
      return vt !== null
        ? Tr(e, vt, t, l)
        : ((e.baseState = t), [t, e.queue.dispatch]);
    },
    useMemoCache: mf,
    useCacheRefresh: Jr,
  };
  Fr.useEffectEvent = Hr;
  function Rf(t, l, e, a) {
    ((l = t.memoizedState),
      (e = e(a, l)),
      (e = e == null ? l : A({}, l, e)),
      (t.memoizedState = e),
      t.lanes === 0 && (t.updateQueue.baseState = e));
  }
  var Of = {
    enqueueSetState: function (t, l, e) {
      t = t._reactInternals;
      var a = hl(),
        u = de(a);
      ((u.payload = l),
        e != null && (u.callback = e),
        (l = he(t, u, a)),
        l !== null && (al(l, t, a), uu(l, t, a)));
    },
    enqueueReplaceState: function (t, l, e) {
      t = t._reactInternals;
      var a = hl(),
        u = de(a);
      ((u.tag = 1),
        (u.payload = l),
        e != null && (u.callback = e),
        (l = he(t, u, a)),
        l !== null && (al(l, t, a), uu(l, t, a)));
    },
    enqueueForceUpdate: function (t, l) {
      t = t._reactInternals;
      var e = hl(),
        a = de(e);
      ((a.tag = 2),
        l != null && (a.callback = l),
        (l = he(t, a, e)),
        l !== null && (al(l, t, e), uu(l, t, e)));
    },
  };
  function Ir(t, l, e, a, u, n, i) {
    return (
      (t = t.stateNode),
      typeof t.shouldComponentUpdate == "function"
        ? t.shouldComponentUpdate(a, n, i)
        : l.prototype && l.prototype.isPureReactComponent
          ? !ka(e, a) || !ka(u, n)
          : !0
    );
  }
  function Pr(t, l, e, a) {
    ((t = l.state),
      typeof l.componentWillReceiveProps == "function" &&
        l.componentWillReceiveProps(e, a),
      typeof l.UNSAFE_componentWillReceiveProps == "function" &&
        l.UNSAFE_componentWillReceiveProps(e, a),
      l.state !== t && Of.enqueueReplaceState(l, l.state, null));
  }
  function we(t, l) {
    var e = l;
    if ("ref" in l) {
      e = {};
      for (var a in l) a !== "ref" && (e[a] = l[a]);
    }
    if ((t = t.defaultProps)) {
      e === l && (e = A({}, e));
      for (var u in t) e[u] === void 0 && (e[u] = t[u]);
    }
    return e;
  }
  function ts(t) {
    Iu(t);
  }
  function ls(t) {
    console.error(t);
  }
  function es(t) {
    Iu(t);
  }
  function Tn(t, l) {
    try {
      var e = t.onUncaughtError;
      e(l.value, { componentStack: l.stack });
    } catch (a) {
      setTimeout(function () {
        throw a;
      });
    }
  }
  function as(t, l, e) {
    try {
      var a = t.onCaughtError;
      a(e.value, {
        componentStack: e.stack,
        errorBoundary: l.tag === 1 ? l.stateNode : null,
      });
    } catch (u) {
      setTimeout(function () {
        throw u;
      });
    }
  }
  function Mf(t, l, e) {
    return (
      (e = de(e)),
      (e.tag = 3),
      (e.payload = { element: null }),
      (e.callback = function () {
        Tn(t, l);
      }),
      e
    );
  }
  function us(t) {
    return ((t = de(t)), (t.tag = 3), t);
  }
  function ns(t, l, e, a) {
    var u = e.type.getDerivedStateFromError;
    if (typeof u == "function") {
      var n = a.value;
      ((t.payload = function () {
        return u(n);
      }),
        (t.callback = function () {
          as(l, e, a);
        }));
    }
    var i = e.stateNode;
    i !== null &&
      typeof i.componentDidCatch == "function" &&
      (t.callback = function () {
        (as(l, e, a),
          typeof u != "function" &&
            (Se === null ? (Se = new Set([this])) : Se.add(this)));
        var c = a.stack;
        this.componentDidCatch(a.value, {
          componentStack: c !== null ? c : "",
        });
      });
  }
  function km(t, l, e, a, u) {
    if (
      ((e.flags |= 32768),
      a !== null && typeof a == "object" && typeof a.then == "function")
    ) {
      if (
        ((l = e.alternate),
        l !== null && ha(l, e, u, !0),
        (e = ol.current),
        e !== null)
      ) {
        switch (e.tag) {
          case 31:
          case 13:
            return (
              zl === null ? Hn() : e.alternate === null && Mt === 0 && (Mt = 3),
              (e.flags &= -257),
              (e.flags |= 65536),
              (e.lanes = u),
              a === on
                ? (e.flags |= 16384)
                : ((l = e.updateQueue),
                  l === null ? (e.updateQueue = new Set([a])) : l.add(a),
                  Pf(t, a, u)),
              !1
            );
          case 22:
            return (
              (e.flags |= 65536),
              a === on
                ? (e.flags |= 16384)
                : ((l = e.updateQueue),
                  l === null
                    ? ((l = {
                        transitions: null,
                        markerInstances: null,
                        retryQueue: new Set([a]),
                      }),
                      (e.updateQueue = l))
                    : ((e = l.retryQueue),
                      e === null ? (l.retryQueue = new Set([a])) : e.add(a)),
                  Pf(t, a, u)),
              !1
            );
        }
        throw Error(o(435, e.tag));
      }
      return (Pf(t, a, u), Hn(), !1);
    }
    if (it)
      return (
        (l = ol.current),
        l !== null
          ? ((l.flags & 65536) === 0 && (l.flags |= 256),
            (l.flags |= 65536),
            (l.lanes = u),
            a !== Ji && ((t = Error(o(422), { cause: a })), Pa(Sl(t, e))))
          : (a !== Ji && ((l = Error(o(423), { cause: a })), Pa(Sl(l, e))),
            (t = t.current.alternate),
            (t.flags |= 65536),
            (u &= -u),
            (t.lanes |= u),
            (a = Sl(a, e)),
            (u = Mf(t.stateNode, a, u)),
            af(t, u),
            Mt !== 4 && (Mt = 2)),
        !1
      );
    var n = Error(o(520), { cause: a });
    if (
      ((n = Sl(n, e)),
      pu === null ? (pu = [n]) : pu.push(n),
      Mt !== 4 && (Mt = 2),
      l === null)
    )
      return !0;
    ((a = Sl(a, e)), (e = l));
    do {
      switch (e.tag) {
        case 3:
          return (
            (e.flags |= 65536),
            (t = u & -u),
            (e.lanes |= t),
            (t = Mf(e.stateNode, a, t)),
            af(e, t),
            !1
          );
        case 1:
          if (
            ((l = e.type),
            (n = e.stateNode),
            (e.flags & 128) === 0 &&
              (typeof l.getDerivedStateFromError == "function" ||
                (n !== null &&
                  typeof n.componentDidCatch == "function" &&
                  (Se === null || !Se.has(n)))))
          )
            return (
              (e.flags |= 65536),
              (u &= -u),
              (e.lanes |= u),
              (u = us(u)),
              ns(u, t, e, a),
              af(e, u),
              !1
            );
      }
      e = e.return;
    } while (e !== null);
    return !1;
  }
  var Df = Error(o(461)),
    qt = !1;
  function Kt(t, l, e, a) {
    l.child = t === null ? or(l, null, e, a) : Ke(l, t.child, e, a);
  }
  function is(t, l, e, a, u) {
    e = e.render;
    var n = l.ref;
    if ("ref" in a) {
      var i = {};
      for (var c in a) c !== "ref" && (i[c] = a[c]);
    } else i = a;
    return (
      Xe(l),
      (a = rf(t, l, e, i, n, u)),
      (c = sf()),
      t !== null && !qt
        ? (df(t, l, u), wl(t, l, u))
        : (it && c && Vi(l), (l.flags |= 1), Kt(t, l, a, u), l.child)
    );
  }
  function fs(t, l, e, a, u) {
    if (t === null) {
      var n = e.type;
      return typeof n == "function" &&
        !Xi(n) &&
        n.defaultProps === void 0 &&
        e.compare === null
        ? ((l.tag = 15), (l.type = n), cs(t, l, n, a, u))
        : ((t = en(e.type, null, a, l, l.mode, u)),
          (t.ref = l.ref),
          (t.return = l),
          (l.child = t));
    }
    if (((n = t.child), !jf(t, u))) {
      var i = n.memoizedProps;
      if (
        ((e = e.compare), (e = e !== null ? e : ka), e(i, a) && t.ref === l.ref)
      )
        return wl(t, l, u);
    }
    return (
      (l.flags |= 1),
      (t = Xl(n, a)),
      (t.ref = l.ref),
      (t.return = l),
      (l.child = t)
    );
  }
  function cs(t, l, e, a, u) {
    if (t !== null) {
      var n = t.memoizedProps;
      if (ka(n, a) && t.ref === l.ref)
        if (((qt = !1), (l.pendingProps = a = n), jf(t, u)))
          (t.flags & 131072) !== 0 && (qt = !0);
        else return ((l.lanes = t.lanes), wl(t, l, u));
    }
    return Cf(t, l, e, a, u);
  }
  function os(t, l, e, a) {
    var u = a.children,
      n = t !== null ? t.memoizedState : null;
    if (
      (t === null &&
        l.stateNode === null &&
        (l.stateNode = {
          _visibility: 1,
          _pendingMarkers: null,
          _retryCache: null,
          _transitions: null,
        }),
      a.mode === "hidden")
    ) {
      if ((l.flags & 128) !== 0) {
        if (((n = n !== null ? n.baseLanes | e : e), t !== null)) {
          for (a = l.child = t.child, u = 0; a !== null; )
            ((u = u | a.lanes | a.childLanes), (a = a.sibling));
          a = u & ~n;
        } else ((a = 0), (l.child = null));
        return rs(t, l, n, e, a);
      }
      if ((e & 536870912) !== 0)
        ((l.memoizedState = { baseLanes: 0, cachePool: null }),
          t !== null && fn(l, n !== null ? n.cachePool : null),
          n !== null ? dr(l, n) : nf(),
          hr(l));
      else
        return (
          (a = l.lanes = 536870912),
          rs(t, l, n !== null ? n.baseLanes | e : e, e, a)
        );
    } else
      n !== null
        ? (fn(l, n.cachePool), dr(l, n), ye(), (l.memoizedState = null))
        : (t !== null && fn(l, null), nf(), ye());
    return (Kt(t, l, u, e), l.child);
  }
  function su(t, l) {
    return (
      (t !== null && t.tag === 22) ||
        l.stateNode !== null ||
        (l.stateNode = {
          _visibility: 1,
          _pendingMarkers: null,
          _retryCache: null,
          _transitions: null,
        }),
      l.sibling
    );
  }
  function rs(t, l, e, a, u) {
    var n = Pi();
    return (
      (n = n === null ? null : { parent: Ht._currentValue, pool: n }),
      (l.memoizedState = { baseLanes: e, cachePool: n }),
      t !== null && fn(l, null),
      nf(),
      hr(l),
      t !== null && ha(t, l, a, !0),
      (l.childLanes = u),
      null
    );
  }
  function zn(t, l) {
    return (
      (l = An({ mode: l.mode, children: l.children }, t.mode)),
      (l.ref = t.ref),
      (t.child = l),
      (l.return = t),
      l
    );
  }
  function ss(t, l, e) {
    return (
      Ke(l, t.child, null, e),
      (t = zn(l, l.pendingProps)),
      (t.flags |= 2),
      rl(l),
      (l.memoizedState = null),
      t
    );
  }
  function Fm(t, l, e) {
    var a = l.pendingProps,
      u = (l.flags & 128) !== 0;
    if (((l.flags &= -129), t === null)) {
      if (it) {
        if (a.mode === "hidden")
          return ((t = zn(l, a)), (l.lanes = 536870912), su(null, t));
        if (
          (cf(l),
          (t = Tt)
            ? ((t = zd(t, Tl)),
              (t = t !== null && t.data === "&" ? t : null),
              t !== null &&
                ((l.memoizedState = {
                  dehydrated: t,
                  treeContext: fe !== null ? { id: Nl, overflow: xl } : null,
                  retryLane: 536870912,
                  hydrationErrors: null,
                }),
                (e = $o(t)),
                (e.return = l),
                (l.child = e),
                (Zt = l),
                (Tt = null)))
            : (t = null),
          t === null)
        )
          throw oe(l);
        return ((l.lanes = 536870912), null);
      }
      return zn(l, a);
    }
    var n = t.memoizedState;
    if (n !== null) {
      var i = n.dehydrated;
      if ((cf(l), u))
        if (l.flags & 256) ((l.flags &= -257), (l = ss(t, l, e)));
        else if (l.memoizedState !== null)
          ((l.child = t.child), (l.flags |= 128), (l = null));
        else throw Error(o(558));
      else if (
        (qt || ha(t, l, e, !1), (u = (e & t.childLanes) !== 0), qt || u)
      ) {
        if (
          ((a = Et),
          a !== null && ((i = to(a, e)), i !== 0 && i !== n.retryLane))
        )
          throw ((n.retryLane = i), je(t, i), al(a, t, i), Df);
        (Hn(), (l = ss(t, l, e)));
      } else
        ((t = n.treeContext),
          (Tt = _l(i.nextSibling)),
          (Zt = l),
          (it = !0),
          (ce = null),
          (Tl = !1),
          t !== null && Fo(l, t),
          (l = zn(l, a)),
          (l.flags |= 4096));
      return l;
    }
    return (
      (t = Xl(t.child, { mode: a.mode, children: a.children })),
      (t.ref = l.ref),
      (l.child = t),
      (t.return = l),
      t
    );
  }
  function _n(t, l) {
    var e = l.ref;
    if (e === null) t !== null && t.ref !== null && (l.flags |= 4194816);
    else {
      if (typeof e != "function" && typeof e != "object") throw Error(o(284));
      (t === null || t.ref !== e) && (l.flags |= 4194816);
    }
  }
  function Cf(t, l, e, a, u) {
    return (
      Xe(l),
      (e = rf(t, l, e, a, void 0, u)),
      (a = sf()),
      t !== null && !qt
        ? (df(t, l, u), wl(t, l, u))
        : (it && a && Vi(l), (l.flags |= 1), Kt(t, l, e, u), l.child)
    );
  }
  function ds(t, l, e, a, u, n) {
    return (
      Xe(l),
      (l.updateQueue = null),
      (e = yr(l, a, e, u)),
      mr(t),
      (a = sf()),
      t !== null && !qt
        ? (df(t, l, n), wl(t, l, n))
        : (it && a && Vi(l), (l.flags |= 1), Kt(t, l, e, n), l.child)
    );
  }
  function hs(t, l, e, a, u) {
    if ((Xe(l), l.stateNode === null)) {
      var n = oa,
        i = e.contextType;
      (typeof i == "object" && i !== null && (n = Vt(i)),
        (n = new e(a, n)),
        (l.memoizedState =
          n.state !== null && n.state !== void 0 ? n.state : null),
        (n.updater = Of),
        (l.stateNode = n),
        (n._reactInternals = l),
        (n = l.stateNode),
        (n.props = a),
        (n.state = l.memoizedState),
        (n.refs = {}),
        lf(l),
        (i = e.contextType),
        (n.context = typeof i == "object" && i !== null ? Vt(i) : oa),
        (n.state = l.memoizedState),
        (i = e.getDerivedStateFromProps),
        typeof i == "function" && (Rf(l, e, i, a), (n.state = l.memoizedState)),
        typeof e.getDerivedStateFromProps == "function" ||
          typeof n.getSnapshotBeforeUpdate == "function" ||
          (typeof n.UNSAFE_componentWillMount != "function" &&
            typeof n.componentWillMount != "function") ||
          ((i = n.state),
          typeof n.componentWillMount == "function" && n.componentWillMount(),
          typeof n.UNSAFE_componentWillMount == "function" &&
            n.UNSAFE_componentWillMount(),
          i !== n.state && Of.enqueueReplaceState(n, n.state, null),
          iu(l, a, n, u),
          nu(),
          (n.state = l.memoizedState)),
        typeof n.componentDidMount == "function" && (l.flags |= 4194308),
        (a = !0));
    } else if (t === null) {
      n = l.stateNode;
      var c = l.memoizedProps,
        d = we(e, c);
      n.props = d;
      var T = n.context,
        R = e.contextType;
      ((i = oa), typeof R == "object" && R !== null && (i = Vt(R)));
      var N = e.getDerivedStateFromProps;
      ((R =
        typeof N == "function" ||
        typeof n.getSnapshotBeforeUpdate == "function"),
        (c = l.pendingProps !== c),
        R ||
          (typeof n.UNSAFE_componentWillReceiveProps != "function" &&
            typeof n.componentWillReceiveProps != "function") ||
          ((c || T !== i) && Pr(l, n, a, i)),
        (se = !1));
      var z = l.memoizedState;
      ((n.state = z),
        iu(l, a, n, u),
        nu(),
        (T = l.memoizedState),
        c || z !== T || se
          ? (typeof N == "function" && (Rf(l, e, N, a), (T = l.memoizedState)),
            (d = se || Ir(l, e, d, a, z, T, i))
              ? (R ||
                  (typeof n.UNSAFE_componentWillMount != "function" &&
                    typeof n.componentWillMount != "function") ||
                  (typeof n.componentWillMount == "function" &&
                    n.componentWillMount(),
                  typeof n.UNSAFE_componentWillMount == "function" &&
                    n.UNSAFE_componentWillMount()),
                typeof n.componentDidMount == "function" &&
                  (l.flags |= 4194308))
              : (typeof n.componentDidMount == "function" &&
                  (l.flags |= 4194308),
                (l.memoizedProps = a),
                (l.memoizedState = T)),
            (n.props = a),
            (n.state = T),
            (n.context = i),
            (a = d))
          : (typeof n.componentDidMount == "function" && (l.flags |= 4194308),
            (a = !1)));
    } else {
      ((n = l.stateNode),
        ef(t, l),
        (i = l.memoizedProps),
        (R = we(e, i)),
        (n.props = R),
        (N = l.pendingProps),
        (z = n.context),
        (T = e.contextType),
        (d = oa),
        typeof T == "object" && T !== null && (d = Vt(T)),
        (c = e.getDerivedStateFromProps),
        (T =
          typeof c == "function" ||
          typeof n.getSnapshotBeforeUpdate == "function") ||
          (typeof n.UNSAFE_componentWillReceiveProps != "function" &&
            typeof n.componentWillReceiveProps != "function") ||
          ((i !== N || z !== d) && Pr(l, n, a, d)),
        (se = !1),
        (z = l.memoizedState),
        (n.state = z),
        iu(l, a, n, u),
        nu());
      var _ = l.memoizedState;
      i !== N ||
      z !== _ ||
      se ||
      (t !== null && t.dependencies !== null && un(t.dependencies))
        ? (typeof c == "function" && (Rf(l, e, c, a), (_ = l.memoizedState)),
          (R =
            se ||
            Ir(l, e, R, a, z, _, d) ||
            (t !== null && t.dependencies !== null && un(t.dependencies)))
            ? (T ||
                (typeof n.UNSAFE_componentWillUpdate != "function" &&
                  typeof n.componentWillUpdate != "function") ||
                (typeof n.componentWillUpdate == "function" &&
                  n.componentWillUpdate(a, _, d),
                typeof n.UNSAFE_componentWillUpdate == "function" &&
                  n.UNSAFE_componentWillUpdate(a, _, d)),
              typeof n.componentDidUpdate == "function" && (l.flags |= 4),
              typeof n.getSnapshotBeforeUpdate == "function" &&
                (l.flags |= 1024))
            : (typeof n.componentDidUpdate != "function" ||
                (i === t.memoizedProps && z === t.memoizedState) ||
                (l.flags |= 4),
              typeof n.getSnapshotBeforeUpdate != "function" ||
                (i === t.memoizedProps && z === t.memoizedState) ||
                (l.flags |= 1024),
              (l.memoizedProps = a),
              (l.memoizedState = _)),
          (n.props = a),
          (n.state = _),
          (n.context = d),
          (a = R))
        : (typeof n.componentDidUpdate != "function" ||
            (i === t.memoizedProps && z === t.memoizedState) ||
            (l.flags |= 4),
          typeof n.getSnapshotBeforeUpdate != "function" ||
            (i === t.memoizedProps && z === t.memoizedState) ||
            (l.flags |= 1024),
          (a = !1));
    }
    return (
      (n = a),
      _n(t, l),
      (a = (l.flags & 128) !== 0),
      n || a
        ? ((n = l.stateNode),
          (e =
            a && typeof e.getDerivedStateFromError != "function"
              ? null
              : n.render()),
          (l.flags |= 1),
          t !== null && a
            ? ((l.child = Ke(l, t.child, null, u)),
              (l.child = Ke(l, null, e, u)))
            : Kt(t, l, e, u),
          (l.memoizedState = n.state),
          (t = l.child))
        : (t = wl(t, l, u)),
      t
    );
  }
  function ms(t, l, e, a) {
    return (Le(), (l.flags |= 256), Kt(t, l, e, a), l.child);
  }
  var Uf = {
    dehydrated: null,
    treeContext: null,
    retryLane: 0,
    hydrationErrors: null,
  };
  function Nf(t) {
    return { baseLanes: t, cachePool: ar() };
  }
  function xf(t, l, e) {
    return ((t = t !== null ? t.childLanes & ~e : 0), l && (t |= dl), t);
  }
  function ys(t, l, e) {
    var a = l.pendingProps,
      u = !1,
      n = (l.flags & 128) !== 0,
      i;
    if (
      ((i = n) ||
        (i =
          t !== null && t.memoizedState === null ? !1 : (Ut.current & 2) !== 0),
      i && ((u = !0), (l.flags &= -129)),
      (i = (l.flags & 32) !== 0),
      (l.flags &= -33),
      t === null)
    ) {
      if (it) {
        if (
          (u ? me(l) : ye(),
          (t = Tt)
            ? ((t = zd(t, Tl)),
              (t = t !== null && t.data !== "&" ? t : null),
              t !== null &&
                ((l.memoizedState = {
                  dehydrated: t,
                  treeContext: fe !== null ? { id: Nl, overflow: xl } : null,
                  retryLane: 536870912,
                  hydrationErrors: null,
                }),
                (e = $o(t)),
                (e.return = l),
                (l.child = e),
                (Zt = l),
                (Tt = null)))
            : (t = null),
          t === null)
        )
          throw oe(l);
        return (yc(t) ? (l.lanes = 32) : (l.lanes = 536870912), null);
      }
      var c = a.children;
      return (
        (a = a.fallback),
        u
          ? (ye(),
            (u = l.mode),
            (c = An({ mode: "hidden", children: c }, u)),
            (a = Ye(a, u, e, null)),
            (c.return = l),
            (a.return = l),
            (c.sibling = a),
            (l.child = c),
            (a = l.child),
            (a.memoizedState = Nf(e)),
            (a.childLanes = xf(t, i, e)),
            (l.memoizedState = Uf),
            su(null, a))
          : (me(l), Hf(l, c))
      );
    }
    var d = t.memoizedState;
    if (d !== null && ((c = d.dehydrated), c !== null)) {
      if (n)
        l.flags & 256
          ? (me(l), (l.flags &= -257), (l = Bf(t, l, e)))
          : l.memoizedState !== null
            ? (ye(), (l.child = t.child), (l.flags |= 128), (l = null))
            : (ye(),
              (c = a.fallback),
              (u = l.mode),
              (a = An({ mode: "visible", children: a.children }, u)),
              (c = Ye(c, u, e, null)),
              (c.flags |= 2),
              (a.return = l),
              (c.return = l),
              (a.sibling = c),
              (l.child = a),
              Ke(l, t.child, null, e),
              (a = l.child),
              (a.memoizedState = Nf(e)),
              (a.childLanes = xf(t, i, e)),
              (l.memoizedState = Uf),
              (l = su(null, a)));
      else if ((me(l), yc(c))) {
        if (((i = c.nextSibling && c.nextSibling.dataset), i)) var T = i.dgst;
        ((i = T),
          (a = Error(o(419))),
          (a.stack = ""),
          (a.digest = i),
          Pa({ value: a, source: null, stack: null }),
          (l = Bf(t, l, e)));
      } else if (
        (qt || ha(t, l, e, !1), (i = (e & t.childLanes) !== 0), qt || i)
      ) {
        if (
          ((i = Et),
          i !== null && ((a = to(i, e)), a !== 0 && a !== d.retryLane))
        )
          throw ((d.retryLane = a), je(t, a), al(i, t, a), Df);
        (mc(c) || Hn(), (l = Bf(t, l, e)));
      } else
        mc(c)
          ? ((l.flags |= 192), (l.child = t.child), (l = null))
          : ((t = d.treeContext),
            (Tt = _l(c.nextSibling)),
            (Zt = l),
            (it = !0),
            (ce = null),
            (Tl = !1),
            t !== null && Fo(l, t),
            (l = Hf(l, a.children)),
            (l.flags |= 4096));
      return l;
    }
    return u
      ? (ye(),
        (c = a.fallback),
        (u = l.mode),
        (d = t.child),
        (T = d.sibling),
        (a = Xl(d, { mode: "hidden", children: a.children })),
        (a.subtreeFlags = d.subtreeFlags & 65011712),
        T !== null ? (c = Xl(T, c)) : ((c = Ye(c, u, e, null)), (c.flags |= 2)),
        (c.return = l),
        (a.return = l),
        (a.sibling = c),
        (l.child = a),
        su(null, a),
        (a = l.child),
        (c = t.child.memoizedState),
        c === null
          ? (c = Nf(e))
          : ((u = c.cachePool),
            u !== null
              ? ((d = Ht._currentValue),
                (u = u.parent !== d ? { parent: d, pool: d } : u))
              : (u = ar()),
            (c = { baseLanes: c.baseLanes | e, cachePool: u })),
        (a.memoizedState = c),
        (a.childLanes = xf(t, i, e)),
        (l.memoizedState = Uf),
        su(t.child, a))
      : (me(l),
        (e = t.child),
        (t = e.sibling),
        (e = Xl(e, { mode: "visible", children: a.children })),
        (e.return = l),
        (e.sibling = null),
        t !== null &&
          ((i = l.deletions),
          i === null ? ((l.deletions = [t]), (l.flags |= 16)) : i.push(t)),
        (l.child = e),
        (l.memoizedState = null),
        e);
  }
  function Hf(t, l) {
    return (
      (l = An({ mode: "visible", children: l }, t.mode)),
      (l.return = t),
      (t.child = l)
    );
  }
  function An(t, l) {
    return ((t = cl(22, t, null, l)), (t.lanes = 0), t);
  }
  function Bf(t, l, e) {
    return (
      Ke(l, t.child, null, e),
      (t = Hf(l, l.pendingProps.children)),
      (t.flags |= 2),
      (l.memoizedState = null),
      t
    );
  }
  function vs(t, l, e) {
    t.lanes |= l;
    var a = t.alternate;
    (a !== null && (a.lanes |= l), Wi(t.return, l, e));
  }
  function qf(t, l, e, a, u, n) {
    var i = t.memoizedState;
    i === null
      ? (t.memoizedState = {
          isBackwards: l,
          rendering: null,
          renderingStartTime: 0,
          last: a,
          tail: e,
          tailMode: u,
          treeForkCount: n,
        })
      : ((i.isBackwards = l),
        (i.rendering = null),
        (i.renderingStartTime = 0),
        (i.last = a),
        (i.tail = e),
        (i.tailMode = u),
        (i.treeForkCount = n));
  }
  function gs(t, l, e) {
    var a = l.pendingProps,
      u = a.revealOrder,
      n = a.tail;
    a = a.children;
    var i = Ut.current,
      c = (i & 2) !== 0;
    if (
      (c ? ((i = (i & 1) | 2), (l.flags |= 128)) : (i &= 1),
      j(Ut, i),
      Kt(t, l, a, e),
      (a = it ? Ia : 0),
      !c && t !== null && (t.flags & 128) !== 0)
    )
      t: for (t = l.child; t !== null; ) {
        if (t.tag === 13) t.memoizedState !== null && vs(t, e, l);
        else if (t.tag === 19) vs(t, e, l);
        else if (t.child !== null) {
          ((t.child.return = t), (t = t.child));
          continue;
        }
        if (t === l) break t;
        for (; t.sibling === null; ) {
          if (t.return === null || t.return === l) break t;
          t = t.return;
        }
        ((t.sibling.return = t.return), (t = t.sibling));
      }
    switch (u) {
      case "forwards":
        for (e = l.child, u = null; e !== null; )
          ((t = e.alternate),
            t !== null && hn(t) === null && (u = e),
            (e = e.sibling));
        ((e = u),
          e === null
            ? ((u = l.child), (l.child = null))
            : ((u = e.sibling), (e.sibling = null)),
          qf(l, !1, u, e, n, a));
        break;
      case "backwards":
      case "unstable_legacy-backwards":
        for (e = null, u = l.child, l.child = null; u !== null; ) {
          if (((t = u.alternate), t !== null && hn(t) === null)) {
            l.child = u;
            break;
          }
          ((t = u.sibling), (u.sibling = e), (e = u), (u = t));
        }
        qf(l, !0, e, null, n, a);
        break;
      case "together":
        qf(l, !1, null, null, void 0, a);
        break;
      default:
        l.memoizedState = null;
    }
    return l.child;
  }
  function wl(t, l, e) {
    if (
      (t !== null && (l.dependencies = t.dependencies),
      (pe |= l.lanes),
      (e & l.childLanes) === 0)
    )
      if (t !== null) {
        if ((ha(t, l, e, !1), (e & l.childLanes) === 0)) return null;
      } else return null;
    if (t !== null && l.child !== t.child) throw Error(o(153));
    if (l.child !== null) {
      for (
        t = l.child, e = Xl(t, t.pendingProps), l.child = e, e.return = l;
        t.sibling !== null;
      )
        ((t = t.sibling),
          (e = e.sibling = Xl(t, t.pendingProps)),
          (e.return = l));
      e.sibling = null;
    }
    return l.child;
  }
  function jf(t, l) {
    return (t.lanes & l) !== 0
      ? !0
      : ((t = t.dependencies), !!(t !== null && un(t)));
  }
  function Im(t, l, e) {
    switch (l.tag) {
      case 3:
        ($t(l, l.stateNode.containerInfo),
          re(l, Ht, t.memoizedState.cache),
          Le());
        break;
      case 27:
      case 5:
        ja(l);
        break;
      case 4:
        $t(l, l.stateNode.containerInfo);
        break;
      case 10:
        re(l, l.type, l.memoizedProps.value);
        break;
      case 31:
        if (l.memoizedState !== null) return ((l.flags |= 128), cf(l), null);
        break;
      case 13:
        var a = l.memoizedState;
        if (a !== null)
          return a.dehydrated !== null
            ? (me(l), (l.flags |= 128), null)
            : (e & l.child.childLanes) !== 0
              ? ys(t, l, e)
              : (me(l), (t = wl(t, l, e)), t !== null ? t.sibling : null);
        me(l);
        break;
      case 19:
        var u = (t.flags & 128) !== 0;
        if (
          ((a = (e & l.childLanes) !== 0),
          a || (ha(t, l, e, !1), (a = (e & l.childLanes) !== 0)),
          u)
        ) {
          if (a) return gs(t, l, e);
          l.flags |= 128;
        }
        if (
          ((u = l.memoizedState),
          u !== null &&
            ((u.rendering = null), (u.tail = null), (u.lastEffect = null)),
          j(Ut, Ut.current),
          a)
        )
          break;
        return null;
      case 22:
        return ((l.lanes = 0), os(t, l, e, l.pendingProps));
      case 24:
        re(l, Ht, t.memoizedState.cache);
    }
    return wl(t, l, e);
  }
  function ps(t, l, e) {
    if (t !== null)
      if (t.memoizedProps !== l.pendingProps) qt = !0;
      else {
        if (!jf(t, e) && (l.flags & 128) === 0) return ((qt = !1), Im(t, l, e));
        qt = (t.flags & 131072) !== 0;
      }
    else ((qt = !1), it && (l.flags & 1048576) !== 0 && ko(l, Ia, l.index));
    switch (((l.lanes = 0), l.tag)) {
      case 16:
        t: {
          var a = l.pendingProps;
          if (((t = Ze(l.elementType)), (l.type = t), typeof t == "function"))
            Xi(t)
              ? ((a = we(t, a)), (l.tag = 1), (l = hs(null, l, t, a, e)))
              : ((l.tag = 0), (l = Cf(null, l, t, a, e)));
          else {
            if (t != null) {
              var u = t.$$typeof;
              if (u === St) {
                ((l.tag = 11), (l = is(null, l, t, a, e)));
                break t;
              } else if (u === F) {
                ((l.tag = 14), (l = fs(null, l, t, a, e)));
                break t;
              }
            }
            throw ((l = jl(t) || t), Error(o(306, l, "")));
          }
        }
        return l;
      case 0:
        return Cf(t, l, l.type, l.pendingProps, e);
      case 1:
        return ((a = l.type), (u = we(a, l.pendingProps)), hs(t, l, a, u, e));
      case 3:
        t: {
          if (($t(l, l.stateNode.containerInfo), t === null))
            throw Error(o(387));
          a = l.pendingProps;
          var n = l.memoizedState;
          ((u = n.element), ef(t, l), iu(l, a, null, e));
          var i = l.memoizedState;
          if (
            ((a = i.cache),
            re(l, Ht, a),
            a !== n.cache && ki(l, [Ht], e, !0),
            nu(),
            (a = i.element),
            n.isDehydrated)
          )
            if (
              ((n = { element: a, isDehydrated: !1, cache: i.cache }),
              (l.updateQueue.baseState = n),
              (l.memoizedState = n),
              l.flags & 256)
            ) {
              l = ms(t, l, a, e);
              break t;
            } else if (a !== u) {
              ((u = Sl(Error(o(424)), l)), Pa(u), (l = ms(t, l, a, e)));
              break t;
            } else {
              switch (((t = l.stateNode.containerInfo), t.nodeType)) {
                case 9:
                  t = t.body;
                  break;
                default:
                  t = t.nodeName === "HTML" ? t.ownerDocument.body : t;
              }
              for (
                Tt = _l(t.firstChild),
                  Zt = l,
                  it = !0,
                  ce = null,
                  Tl = !0,
                  e = or(l, null, a, e),
                  l.child = e;
                e;
              )
                ((e.flags = (e.flags & -3) | 4096), (e = e.sibling));
            }
          else {
            if ((Le(), a === u)) {
              l = wl(t, l, e);
              break t;
            }
            Kt(t, l, a, e);
          }
          l = l.child;
        }
        return l;
      case 26:
        return (
          _n(t, l),
          t === null
            ? (e = Dd(l.type, null, l.pendingProps, null))
              ? (l.memoizedState = e)
              : it ||
                ((e = l.type),
                (t = l.pendingProps),
                (a = Xn(lt.current).createElement(e)),
                (a[Qt] = l),
                (a[Ft] = t),
                Jt(a, e, t),
                Lt(a),
                (l.stateNode = a))
            : (l.memoizedState = Dd(
                l.type,
                t.memoizedProps,
                l.pendingProps,
                t.memoizedState,
              )),
          null
        );
      case 27:
        return (
          ja(l),
          t === null &&
            it &&
            ((a = l.stateNode = Rd(l.type, l.pendingProps, lt.current)),
            (Zt = l),
            (Tl = !0),
            (u = Tt),
            ze(l.type) ? ((vc = u), (Tt = _l(a.firstChild))) : (Tt = u)),
          Kt(t, l, l.pendingProps.children, e),
          _n(t, l),
          t === null && (l.flags |= 4194304),
          l.child
        );
      case 5:
        return (
          t === null &&
            it &&
            ((u = a = Tt) &&
              ((a = My(a, l.type, l.pendingProps, Tl)),
              a !== null
                ? ((l.stateNode = a),
                  (Zt = l),
                  (Tt = _l(a.firstChild)),
                  (Tl = !1),
                  (u = !0))
                : (u = !1)),
            u || oe(l)),
          ja(l),
          (u = l.type),
          (n = l.pendingProps),
          (i = t !== null ? t.memoizedProps : null),
          (a = n.children),
          sc(u, n) ? (a = null) : i !== null && sc(u, i) && (l.flags |= 32),
          l.memoizedState !== null &&
            ((u = rf(t, l, Zm, null, null, e)), (Ru._currentValue = u)),
          _n(t, l),
          Kt(t, l, a, e),
          l.child
        );
      case 6:
        return (
          t === null &&
            it &&
            ((t = e = Tt) &&
              ((e = Dy(e, l.pendingProps, Tl)),
              e !== null
                ? ((l.stateNode = e), (Zt = l), (Tt = null), (t = !0))
                : (t = !1)),
            t || oe(l)),
          null
        );
      case 13:
        return ys(t, l, e);
      case 4:
        return (
          $t(l, l.stateNode.containerInfo),
          (a = l.pendingProps),
          t === null ? (l.child = Ke(l, null, a, e)) : Kt(t, l, a, e),
          l.child
        );
      case 11:
        return is(t, l, l.type, l.pendingProps, e);
      case 7:
        return (Kt(t, l, l.pendingProps, e), l.child);
      case 8:
        return (Kt(t, l, l.pendingProps.children, e), l.child);
      case 12:
        return (Kt(t, l, l.pendingProps.children, e), l.child);
      case 10:
        return (
          (a = l.pendingProps),
          re(l, l.type, a.value),
          Kt(t, l, a.children, e),
          l.child
        );
      case 9:
        return (
          (u = l.type._context),
          (a = l.pendingProps.children),
          Xe(l),
          (u = Vt(u)),
          (a = a(u)),
          (l.flags |= 1),
          Kt(t, l, a, e),
          l.child
        );
      case 14:
        return fs(t, l, l.type, l.pendingProps, e);
      case 15:
        return cs(t, l, l.type, l.pendingProps, e);
      case 19:
        return gs(t, l, e);
      case 31:
        return Fm(t, l, e);
      case 22:
        return os(t, l, e, l.pendingProps);
      case 24:
        return (
          Xe(l),
          (a = Vt(Ht)),
          t === null
            ? ((u = Pi()),
              u === null &&
                ((u = Et),
                (n = Fi()),
                (u.pooledCache = n),
                n.refCount++,
                n !== null && (u.pooledCacheLanes |= e),
                (u = n)),
              (l.memoizedState = { parent: a, cache: u }),
              lf(l),
              re(l, Ht, u))
            : ((t.lanes & e) !== 0 && (ef(t, l), iu(l, null, null, e), nu()),
              (u = t.memoizedState),
              (n = l.memoizedState),
              u.parent !== a
                ? ((u = { parent: a, cache: a }),
                  (l.memoizedState = u),
                  l.lanes === 0 &&
                    (l.memoizedState = l.updateQueue.baseState = u),
                  re(l, Ht, a))
                : ((a = n.cache),
                  re(l, Ht, a),
                  a !== u.cache && ki(l, [Ht], e, !0))),
          Kt(t, l, l.pendingProps.children, e),
          l.child
        );
      case 29:
        throw l.pendingProps;
    }
    throw Error(o(156, l.tag));
  }
  function $l(t) {
    t.flags |= 4;
  }
  function Yf(t, l, e, a, u) {
    if (((l = (t.mode & 32) !== 0) && (l = !1), l)) {
      if (((t.flags |= 16777216), (u & 335544128) === u))
        if (t.stateNode.complete) t.flags |= 8192;
        else if (Ks()) t.flags |= 8192;
        else throw ((Ve = on), tf);
    } else t.flags &= -16777217;
  }
  function Ss(t, l) {
    if (l.type !== "stylesheet" || (l.state.loading & 4) !== 0)
      t.flags &= -16777217;
    else if (((t.flags |= 16777216), !Hd(l)))
      if (Ks()) t.flags |= 8192;
      else throw ((Ve = on), tf);
  }
  function Rn(t, l) {
    (l !== null && (t.flags |= 4),
      t.flags & 16384 &&
        ((l = t.tag !== 22 ? Fc() : 536870912), (t.lanes |= l), (Aa |= l)));
  }
  function du(t, l) {
    if (!it)
      switch (t.tailMode) {
        case "hidden":
          l = t.tail;
          for (var e = null; l !== null; )
            (l.alternate !== null && (e = l), (l = l.sibling));
          e === null ? (t.tail = null) : (e.sibling = null);
          break;
        case "collapsed":
          e = t.tail;
          for (var a = null; e !== null; )
            (e.alternate !== null && (a = e), (e = e.sibling));
          a === null
            ? l || t.tail === null
              ? (t.tail = null)
              : (t.tail.sibling = null)
            : (a.sibling = null);
      }
  }
  function zt(t) {
    var l = t.alternate !== null && t.alternate.child === t.child,
      e = 0,
      a = 0;
    if (l)
      for (var u = t.child; u !== null; )
        ((e |= u.lanes | u.childLanes),
          (a |= u.subtreeFlags & 65011712),
          (a |= u.flags & 65011712),
          (u.return = t),
          (u = u.sibling));
    else
      for (u = t.child; u !== null; )
        ((e |= u.lanes | u.childLanes),
          (a |= u.subtreeFlags),
          (a |= u.flags),
          (u.return = t),
          (u = u.sibling));
    return ((t.subtreeFlags |= a), (t.childLanes = e), l);
  }
  function Pm(t, l, e) {
    var a = l.pendingProps;
    switch ((Ki(l), l.tag)) {
      case 16:
      case 15:
      case 0:
      case 11:
      case 7:
      case 8:
      case 12:
      case 9:
      case 14:
        return (zt(l), null);
      case 1:
        return (zt(l), null);
      case 3:
        return (
          (e = l.stateNode),
          (a = null),
          t !== null && (a = t.memoizedState.cache),
          l.memoizedState.cache !== a && (l.flags |= 2048),
          Vl(Ht),
          Ct(),
          e.pendingContext &&
            ((e.context = e.pendingContext), (e.pendingContext = null)),
          (t === null || t.child === null) &&
            (da(l)
              ? $l(l)
              : t === null ||
                (t.memoizedState.isDehydrated && (l.flags & 256) === 0) ||
                ((l.flags |= 1024), wi())),
          zt(l),
          null
        );
      case 26:
        var u = l.type,
          n = l.memoizedState;
        return (
          t === null
            ? ($l(l),
              n !== null ? (zt(l), Ss(l, n)) : (zt(l), Yf(l, u, null, a, e)))
            : n
              ? n !== t.memoizedState
                ? ($l(l), zt(l), Ss(l, n))
                : (zt(l), (l.flags &= -16777217))
              : ((t = t.memoizedProps),
                t !== a && $l(l),
                zt(l),
                Yf(l, u, t, a, e)),
          null
        );
      case 27:
        if (
          (qu(l),
          (e = lt.current),
          (u = l.type),
          t !== null && l.stateNode != null)
        )
          t.memoizedProps !== a && $l(l);
        else {
          if (!a) {
            if (l.stateNode === null) throw Error(o(166));
            return (zt(l), null);
          }
          ((t = X.current),
            da(l) ? Io(l) : ((t = Rd(u, a, e)), (l.stateNode = t), $l(l)));
        }
        return (zt(l), null);
      case 5:
        if ((qu(l), (u = l.type), t !== null && l.stateNode != null))
          t.memoizedProps !== a && $l(l);
        else {
          if (!a) {
            if (l.stateNode === null) throw Error(o(166));
            return (zt(l), null);
          }
          if (((n = X.current), da(l))) Io(l);
          else {
            var i = Xn(lt.current);
            switch (n) {
              case 1:
                n = i.createElementNS("http://www.w3.org/2000/svg", u);
                break;
              case 2:
                n = i.createElementNS("http://www.w3.org/1998/Math/MathML", u);
                break;
              default:
                switch (u) {
                  case "svg":
                    n = i.createElementNS("http://www.w3.org/2000/svg", u);
                    break;
                  case "math":
                    n = i.createElementNS(
                      "http://www.w3.org/1998/Math/MathML",
                      u,
                    );
                    break;
                  case "script":
                    ((n = i.createElement("div")),
                      (n.innerHTML = "<script><\/script>"),
                      (n = n.removeChild(n.firstChild)));
                    break;
                  case "select":
                    ((n =
                      typeof a.is == "string"
                        ? i.createElement("select", { is: a.is })
                        : i.createElement("select")),
                      a.multiple
                        ? (n.multiple = !0)
                        : a.size && (n.size = a.size));
                    break;
                  default:
                    n =
                      typeof a.is == "string"
                        ? i.createElement(u, { is: a.is })
                        : i.createElement(u);
                }
            }
            ((n[Qt] = l), (n[Ft] = a));
            t: for (i = l.child; i !== null; ) {
              if (i.tag === 5 || i.tag === 6) n.appendChild(i.stateNode);
              else if (i.tag !== 4 && i.tag !== 27 && i.child !== null) {
                ((i.child.return = i), (i = i.child));
                continue;
              }
              if (i === l) break t;
              for (; i.sibling === null; ) {
                if (i.return === null || i.return === l) break t;
                i = i.return;
              }
              ((i.sibling.return = i.return), (i = i.sibling));
            }
            l.stateNode = n;
            t: switch ((Jt(n, u, a), u)) {
              case "button":
              case "input":
              case "select":
              case "textarea":
                a = !!a.autoFocus;
                break t;
              case "img":
                a = !0;
                break t;
              default:
                a = !1;
            }
            a && $l(l);
          }
        }
        return (
          zt(l),
          Yf(l, l.type, t === null ? null : t.memoizedProps, l.pendingProps, e),
          null
        );
      case 6:
        if (t && l.stateNode != null) t.memoizedProps !== a && $l(l);
        else {
          if (typeof a != "string" && l.stateNode === null) throw Error(o(166));
          if (((t = lt.current), da(l))) {
            if (
              ((t = l.stateNode),
              (e = l.memoizedProps),
              (a = null),
              (u = Zt),
              u !== null)
            )
              switch (u.tag) {
                case 27:
                case 5:
                  a = u.memoizedProps;
              }
            ((t[Qt] = l),
              (t = !!(
                t.nodeValue === e ||
                (a !== null && a.suppressHydrationWarning === !0) ||
                yd(t.nodeValue, e)
              )),
              t || oe(l, !0));
          } else
            ((t = Xn(t).createTextNode(a)), (t[Qt] = l), (l.stateNode = t));
        }
        return (zt(l), null);
      case 31:
        if (((e = l.memoizedState), t === null || t.memoizedState !== null)) {
          if (((a = da(l)), e !== null)) {
            if (t === null) {
              if (!a) throw Error(o(318));
              if (
                ((t = l.memoizedState),
                (t = t !== null ? t.dehydrated : null),
                !t)
              )
                throw Error(o(557));
              t[Qt] = l;
            } else
              (Le(),
                (l.flags & 128) === 0 && (l.memoizedState = null),
                (l.flags |= 4));
            (zt(l), (t = !1));
          } else
            ((e = wi()),
              t !== null &&
                t.memoizedState !== null &&
                (t.memoizedState.hydrationErrors = e),
              (t = !0));
          if (!t) return l.flags & 256 ? (rl(l), l) : (rl(l), null);
          if ((l.flags & 128) !== 0) throw Error(o(558));
        }
        return (zt(l), null);
      case 13:
        if (
          ((a = l.memoizedState),
          t === null ||
            (t.memoizedState !== null && t.memoizedState.dehydrated !== null))
        ) {
          if (((u = da(l)), a !== null && a.dehydrated !== null)) {
            if (t === null) {
              if (!u) throw Error(o(318));
              if (
                ((u = l.memoizedState),
                (u = u !== null ? u.dehydrated : null),
                !u)
              )
                throw Error(o(317));
              u[Qt] = l;
            } else
              (Le(),
                (l.flags & 128) === 0 && (l.memoizedState = null),
                (l.flags |= 4));
            (zt(l), (u = !1));
          } else
            ((u = wi()),
              t !== null &&
                t.memoizedState !== null &&
                (t.memoizedState.hydrationErrors = u),
              (u = !0));
          if (!u) return l.flags & 256 ? (rl(l), l) : (rl(l), null);
        }
        return (
          rl(l),
          (l.flags & 128) !== 0
            ? ((l.lanes = e), l)
            : ((e = a !== null),
              (t = t !== null && t.memoizedState !== null),
              e &&
                ((a = l.child),
                (u = null),
                a.alternate !== null &&
                  a.alternate.memoizedState !== null &&
                  a.alternate.memoizedState.cachePool !== null &&
                  (u = a.alternate.memoizedState.cachePool.pool),
                (n = null),
                a.memoizedState !== null &&
                  a.memoizedState.cachePool !== null &&
                  (n = a.memoizedState.cachePool.pool),
                n !== u && (a.flags |= 2048)),
              e !== t && e && (l.child.flags |= 8192),
              Rn(l, l.updateQueue),
              zt(l),
              null)
        );
      case 4:
        return (Ct(), t === null && ic(l.stateNode.containerInfo), zt(l), null);
      case 10:
        return (Vl(l.type), zt(l), null);
      case 19:
        if ((x(Ut), (a = l.memoizedState), a === null)) return (zt(l), null);
        if (((u = (l.flags & 128) !== 0), (n = a.rendering), n === null))
          if (u) du(a, !1);
          else {
            if (Mt !== 0 || (t !== null && (t.flags & 128) !== 0))
              for (t = l.child; t !== null; ) {
                if (((n = hn(t)), n !== null)) {
                  for (
                    l.flags |= 128,
                      du(a, !1),
                      t = n.updateQueue,
                      l.updateQueue = t,
                      Rn(l, t),
                      l.subtreeFlags = 0,
                      t = e,
                      e = l.child;
                    e !== null;
                  )
                    (wo(e, t), (e = e.sibling));
                  return (
                    j(Ut, (Ut.current & 1) | 2),
                    it && Ql(l, a.treeForkCount),
                    l.child
                  );
                }
                t = t.sibling;
              }
            a.tail !== null &&
              ul() > Un &&
              ((l.flags |= 128), (u = !0), du(a, !1), (l.lanes = 4194304));
          }
        else {
          if (!u)
            if (((t = hn(n)), t !== null)) {
              if (
                ((l.flags |= 128),
                (u = !0),
                (t = t.updateQueue),
                (l.updateQueue = t),
                Rn(l, t),
                du(a, !0),
                a.tail === null &&
                  a.tailMode === "hidden" &&
                  !n.alternate &&
                  !it)
              )
                return (zt(l), null);
            } else
              2 * ul() - a.renderingStartTime > Un &&
                e !== 536870912 &&
                ((l.flags |= 128), (u = !0), du(a, !1), (l.lanes = 4194304));
          a.isBackwards
            ? ((n.sibling = l.child), (l.child = n))
            : ((t = a.last),
              t !== null ? (t.sibling = n) : (l.child = n),
              (a.last = n));
        }
        return a.tail !== null
          ? ((t = a.tail),
            (a.rendering = t),
            (a.tail = t.sibling),
            (a.renderingStartTime = ul()),
            (t.sibling = null),
            (e = Ut.current),
            j(Ut, u ? (e & 1) | 2 : e & 1),
            it && Ql(l, a.treeForkCount),
            t)
          : (zt(l), null);
      case 22:
      case 23:
        return (
          rl(l),
          ff(),
          (a = l.memoizedState !== null),
          t !== null
            ? (t.memoizedState !== null) !== a && (l.flags |= 8192)
            : a && (l.flags |= 8192),
          a
            ? (e & 536870912) !== 0 &&
              (l.flags & 128) === 0 &&
              (zt(l), l.subtreeFlags & 6 && (l.flags |= 8192))
            : zt(l),
          (e = l.updateQueue),
          e !== null && Rn(l, e.retryQueue),
          (e = null),
          t !== null &&
            t.memoizedState !== null &&
            t.memoizedState.cachePool !== null &&
            (e = t.memoizedState.cachePool.pool),
          (a = null),
          l.memoizedState !== null &&
            l.memoizedState.cachePool !== null &&
            (a = l.memoizedState.cachePool.pool),
          a !== e && (l.flags |= 2048),
          t !== null && x(Qe),
          null
        );
      case 24:
        return (
          (e = null),
          t !== null && (e = t.memoizedState.cache),
          l.memoizedState.cache !== e && (l.flags |= 2048),
          Vl(Ht),
          zt(l),
          null
        );
      case 25:
        return null;
      case 30:
        return null;
    }
    throw Error(o(156, l.tag));
  }
  function ty(t, l) {
    switch ((Ki(l), l.tag)) {
      case 1:
        return (
          (t = l.flags),
          t & 65536 ? ((l.flags = (t & -65537) | 128), l) : null
        );
      case 3:
        return (
          Vl(Ht),
          Ct(),
          (t = l.flags),
          (t & 65536) !== 0 && (t & 128) === 0
            ? ((l.flags = (t & -65537) | 128), l)
            : null
        );
      case 26:
      case 27:
      case 5:
        return (qu(l), null);
      case 31:
        if (l.memoizedState !== null) {
          if ((rl(l), l.alternate === null)) throw Error(o(340));
          Le();
        }
        return (
          (t = l.flags),
          t & 65536 ? ((l.flags = (t & -65537) | 128), l) : null
        );
      case 13:
        if (
          (rl(l), (t = l.memoizedState), t !== null && t.dehydrated !== null)
        ) {
          if (l.alternate === null) throw Error(o(340));
          Le();
        }
        return (
          (t = l.flags),
          t & 65536 ? ((l.flags = (t & -65537) | 128), l) : null
        );
      case 19:
        return (x(Ut), null);
      case 4:
        return (Ct(), null);
      case 10:
        return (Vl(l.type), null);
      case 22:
      case 23:
        return (
          rl(l),
          ff(),
          t !== null && x(Qe),
          (t = l.flags),
          t & 65536 ? ((l.flags = (t & -65537) | 128), l) : null
        );
      case 24:
        return (Vl(Ht), null);
      case 25:
        return null;
      default:
        return null;
    }
  }
  function bs(t, l) {
    switch ((Ki(l), l.tag)) {
      case 3:
        (Vl(Ht), Ct());
        break;
      case 26:
      case 27:
      case 5:
        qu(l);
        break;
      case 4:
        Ct();
        break;
      case 31:
        l.memoizedState !== null && rl(l);
        break;
      case 13:
        rl(l);
        break;
      case 19:
        x(Ut);
        break;
      case 10:
        Vl(l.type);
        break;
      case 22:
      case 23:
        (rl(l), ff(), t !== null && x(Qe));
        break;
      case 24:
        Vl(Ht);
    }
  }
  function hu(t, l) {
    try {
      var e = l.updateQueue,
        a = e !== null ? e.lastEffect : null;
      if (a !== null) {
        var u = a.next;
        e = u;
        do {
          if ((e.tag & t) === t) {
            a = void 0;
            var n = e.create,
              i = e.inst;
            ((a = n()), (i.destroy = a));
          }
          e = e.next;
        } while (e !== u);
      }
    } catch (c) {
      ht(l, l.return, c);
    }
  }
  function ve(t, l, e) {
    try {
      var a = l.updateQueue,
        u = a !== null ? a.lastEffect : null;
      if (u !== null) {
        var n = u.next;
        a = n;
        do {
          if ((a.tag & t) === t) {
            var i = a.inst,
              c = i.destroy;
            if (c !== void 0) {
              ((i.destroy = void 0), (u = l));
              var d = e,
                T = c;
              try {
                T();
              } catch (R) {
                ht(u, d, R);
              }
            }
          }
          a = a.next;
        } while (a !== n);
      }
    } catch (R) {
      ht(l, l.return, R);
    }
  }
  function Es(t) {
    var l = t.updateQueue;
    if (l !== null) {
      var e = t.stateNode;
      try {
        sr(l, e);
      } catch (a) {
        ht(t, t.return, a);
      }
    }
  }
  function Ts(t, l, e) {
    ((e.props = we(t.type, t.memoizedProps)), (e.state = t.memoizedState));
    try {
      e.componentWillUnmount();
    } catch (a) {
      ht(t, l, a);
    }
  }
  function mu(t, l) {
    try {
      var e = t.ref;
      if (e !== null) {
        switch (t.tag) {
          case 26:
          case 27:
          case 5:
            var a = t.stateNode;
            break;
          case 30:
            a = t.stateNode;
            break;
          default:
            a = t.stateNode;
        }
        typeof e == "function" ? (t.refCleanup = e(a)) : (e.current = a);
      }
    } catch (u) {
      ht(t, l, u);
    }
  }
  function Hl(t, l) {
    var e = t.ref,
      a = t.refCleanup;
    if (e !== null)
      if (typeof a == "function")
        try {
          a();
        } catch (u) {
          ht(t, l, u);
        } finally {
          ((t.refCleanup = null),
            (t = t.alternate),
            t != null && (t.refCleanup = null));
        }
      else if (typeof e == "function")
        try {
          e(null);
        } catch (u) {
          ht(t, l, u);
        }
      else e.current = null;
  }
  function zs(t) {
    var l = t.type,
      e = t.memoizedProps,
      a = t.stateNode;
    try {
      t: switch (l) {
        case "button":
        case "input":
        case "select":
        case "textarea":
          e.autoFocus && a.focus();
          break t;
        case "img":
          e.src ? (a.src = e.src) : e.srcSet && (a.srcset = e.srcSet);
      }
    } catch (u) {
      ht(t, t.return, u);
    }
  }
  function Lf(t, l, e) {
    try {
      var a = t.stateNode;
      (Ty(a, t.type, e, l), (a[Ft] = l));
    } catch (u) {
      ht(t, t.return, u);
    }
  }
  function _s(t) {
    return (
      t.tag === 5 ||
      t.tag === 3 ||
      t.tag === 26 ||
      (t.tag === 27 && ze(t.type)) ||
      t.tag === 4
    );
  }
  function Gf(t) {
    t: for (;;) {
      for (; t.sibling === null; ) {
        if (t.return === null || _s(t.return)) return null;
        t = t.return;
      }
      for (
        t.sibling.return = t.return, t = t.sibling;
        t.tag !== 5 && t.tag !== 6 && t.tag !== 18;
      ) {
        if (
          (t.tag === 27 && ze(t.type)) ||
          t.flags & 2 ||
          t.child === null ||
          t.tag === 4
        )
          continue t;
        ((t.child.return = t), (t = t.child));
      }
      if (!(t.flags & 2)) return t.stateNode;
    }
  }
  function Xf(t, l, e) {
    var a = t.tag;
    if (a === 5 || a === 6)
      ((t = t.stateNode),
        l
          ? (e.nodeType === 9
              ? e.body
              : e.nodeName === "HTML"
                ? e.ownerDocument.body
                : e
            ).insertBefore(t, l)
          : ((l =
              e.nodeType === 9
                ? e.body
                : e.nodeName === "HTML"
                  ? e.ownerDocument.body
                  : e),
            l.appendChild(t),
            (e = e._reactRootContainer),
            e != null || l.onclick !== null || (l.onclick = Ll)));
    else if (
      a !== 4 &&
      (a === 27 && ze(t.type) && ((e = t.stateNode), (l = null)),
      (t = t.child),
      t !== null)
    )
      for (Xf(t, l, e), t = t.sibling; t !== null; )
        (Xf(t, l, e), (t = t.sibling));
  }
  function On(t, l, e) {
    var a = t.tag;
    if (a === 5 || a === 6)
      ((t = t.stateNode), l ? e.insertBefore(t, l) : e.appendChild(t));
    else if (
      a !== 4 &&
      (a === 27 && ze(t.type) && (e = t.stateNode), (t = t.child), t !== null)
    )
      for (On(t, l, e), t = t.sibling; t !== null; )
        (On(t, l, e), (t = t.sibling));
  }
  function As(t) {
    var l = t.stateNode,
      e = t.memoizedProps;
    try {
      for (var a = t.type, u = l.attributes; u.length; )
        l.removeAttributeNode(u[0]);
      (Jt(l, a, e), (l[Qt] = t), (l[Ft] = e));
    } catch (n) {
      ht(t, t.return, n);
    }
  }
  var Wl = !1,
    jt = !1,
    Qf = !1,
    Rs = typeof WeakSet == "function" ? WeakSet : Set,
    Gt = null;
  function ly(t, l) {
    if (((t = t.containerInfo), (oc = $n), (t = Yo(t)), Hi(t))) {
      if ("selectionStart" in t)
        var e = { start: t.selectionStart, end: t.selectionEnd };
      else
        t: {
          e = ((e = t.ownerDocument) && e.defaultView) || window;
          var a = e.getSelection && e.getSelection();
          if (a && a.rangeCount !== 0) {
            e = a.anchorNode;
            var u = a.anchorOffset,
              n = a.focusNode;
            a = a.focusOffset;
            try {
              (e.nodeType, n.nodeType);
            } catch {
              e = null;
              break t;
            }
            var i = 0,
              c = -1,
              d = -1,
              T = 0,
              R = 0,
              N = t,
              z = null;
            l: for (;;) {
              for (
                var _;
                N !== e || (u !== 0 && N.nodeType !== 3) || (c = i + u),
                  N !== n || (a !== 0 && N.nodeType !== 3) || (d = i + a),
                  N.nodeType === 3 && (i += N.nodeValue.length),
                  (_ = N.firstChild) !== null;
              )
                ((z = N), (N = _));
              for (;;) {
                if (N === t) break l;
                if (
                  (z === e && ++T === u && (c = i),
                  z === n && ++R === a && (d = i),
                  (_ = N.nextSibling) !== null)
                )
                  break;
                ((N = z), (z = N.parentNode));
              }
              N = _;
            }
            e = c === -1 || d === -1 ? null : { start: c, end: d };
          } else e = null;
        }
      e = e || { start: 0, end: 0 };
    } else e = null;
    for (
      rc = { focusedElem: t, selectionRange: e }, $n = !1, Gt = l;
      Gt !== null;
    )
      if (
        ((l = Gt), (t = l.child), (l.subtreeFlags & 1028) !== 0 && t !== null)
      )
        ((t.return = l), (Gt = t));
      else
        for (; Gt !== null; ) {
          switch (((l = Gt), (n = l.alternate), (t = l.flags), l.tag)) {
            case 0:
              if (
                (t & 4) !== 0 &&
                ((t = l.updateQueue),
                (t = t !== null ? t.events : null),
                t !== null)
              )
                for (e = 0; e < t.length; e++)
                  ((u = t[e]), (u.ref.impl = u.nextImpl));
              break;
            case 11:
            case 15:
              break;
            case 1:
              if ((t & 1024) !== 0 && n !== null) {
                ((t = void 0),
                  (e = l),
                  (u = n.memoizedProps),
                  (n = n.memoizedState),
                  (a = e.stateNode));
                try {
                  var L = we(e.type, u);
                  ((t = a.getSnapshotBeforeUpdate(L, n)),
                    (a.__reactInternalSnapshotBeforeUpdate = t));
                } catch (J) {
                  ht(e, e.return, J);
                }
              }
              break;
            case 3:
              if ((t & 1024) !== 0) {
                if (
                  ((t = l.stateNode.containerInfo), (e = t.nodeType), e === 9)
                )
                  hc(t);
                else if (e === 1)
                  switch (t.nodeName) {
                    case "HEAD":
                    case "HTML":
                    case "BODY":
                      hc(t);
                      break;
                    default:
                      t.textContent = "";
                  }
              }
              break;
            case 5:
            case 26:
            case 27:
            case 6:
            case 4:
            case 17:
              break;
            default:
              if ((t & 1024) !== 0) throw Error(o(163));
          }
          if (((t = l.sibling), t !== null)) {
            ((t.return = l.return), (Gt = t));
            break;
          }
          Gt = l.return;
        }
  }
  function Os(t, l, e) {
    var a = e.flags;
    switch (e.tag) {
      case 0:
      case 11:
      case 15:
        (Fl(t, e), a & 4 && hu(5, e));
        break;
      case 1:
        if ((Fl(t, e), a & 4))
          if (((t = e.stateNode), l === null))
            try {
              t.componentDidMount();
            } catch (i) {
              ht(e, e.return, i);
            }
          else {
            var u = we(e.type, l.memoizedProps);
            l = l.memoizedState;
            try {
              t.componentDidUpdate(u, l, t.__reactInternalSnapshotBeforeUpdate);
            } catch (i) {
              ht(e, e.return, i);
            }
          }
        (a & 64 && Es(e), a & 512 && mu(e, e.return));
        break;
      case 3:
        if ((Fl(t, e), a & 64 && ((t = e.updateQueue), t !== null))) {
          if (((l = null), e.child !== null))
            switch (e.child.tag) {
              case 27:
              case 5:
                l = e.child.stateNode;
                break;
              case 1:
                l = e.child.stateNode;
            }
          try {
            sr(t, l);
          } catch (i) {
            ht(e, e.return, i);
          }
        }
        break;
      case 27:
        l === null && a & 4 && As(e);
      case 26:
      case 5:
        (Fl(t, e), l === null && a & 4 && zs(e), a & 512 && mu(e, e.return));
        break;
      case 12:
        Fl(t, e);
        break;
      case 31:
        (Fl(t, e), a & 4 && Cs(t, e));
        break;
      case 13:
        (Fl(t, e),
          a & 4 && Us(t, e),
          a & 64 &&
            ((t = e.memoizedState),
            t !== null &&
              ((t = t.dehydrated),
              t !== null && ((e = ry.bind(null, e)), Cy(t, e)))));
        break;
      case 22:
        if (((a = e.memoizedState !== null || Wl), !a)) {
          ((l = (l !== null && l.memoizedState !== null) || jt), (u = Wl));
          var n = jt;
          ((Wl = a),
            (jt = l) && !n ? Il(t, e, (e.subtreeFlags & 8772) !== 0) : Fl(t, e),
            (Wl = u),
            (jt = n));
        }
        break;
      case 30:
        break;
      default:
        Fl(t, e);
    }
  }
  function Ms(t) {
    var l = t.alternate;
    (l !== null && ((t.alternate = null), Ms(l)),
      (t.child = null),
      (t.deletions = null),
      (t.sibling = null),
      t.tag === 5 && ((l = t.stateNode), l !== null && gi(l)),
      (t.stateNode = null),
      (t.return = null),
      (t.dependencies = null),
      (t.memoizedProps = null),
      (t.memoizedState = null),
      (t.pendingProps = null),
      (t.stateNode = null),
      (t.updateQueue = null));
  }
  var At = null,
    Pt = !1;
  function kl(t, l, e) {
    for (e = e.child; e !== null; ) (Ds(t, l, e), (e = e.sibling));
  }
  function Ds(t, l, e) {
    if (nl && typeof nl.onCommitFiberUnmount == "function")
      try {
        nl.onCommitFiberUnmount(Ya, e);
      } catch {}
    switch (e.tag) {
      case 26:
        (jt || Hl(e, l),
          kl(t, l, e),
          e.memoizedState
            ? e.memoizedState.count--
            : e.stateNode && ((e = e.stateNode), e.parentNode.removeChild(e)));
        break;
      case 27:
        jt || Hl(e, l);
        var a = At,
          u = Pt;
        (ze(e.type) && ((At = e.stateNode), (Pt = !1)),
          kl(t, l, e),
          zu(e.stateNode),
          (At = a),
          (Pt = u));
        break;
      case 5:
        jt || Hl(e, l);
      case 6:
        if (
          ((a = At),
          (u = Pt),
          (At = null),
          kl(t, l, e),
          (At = a),
          (Pt = u),
          At !== null)
        )
          if (Pt)
            try {
              (At.nodeType === 9
                ? At.body
                : At.nodeName === "HTML"
                  ? At.ownerDocument.body
                  : At
              ).removeChild(e.stateNode);
            } catch (n) {
              ht(e, l, n);
            }
          else
            try {
              At.removeChild(e.stateNode);
            } catch (n) {
              ht(e, l, n);
            }
        break;
      case 18:
        At !== null &&
          (Pt
            ? ((t = At),
              Ed(
                t.nodeType === 9
                  ? t.body
                  : t.nodeName === "HTML"
                    ? t.ownerDocument.body
                    : t,
                e.stateNode,
              ),
              xa(t))
            : Ed(At, e.stateNode));
        break;
      case 4:
        ((a = At),
          (u = Pt),
          (At = e.stateNode.containerInfo),
          (Pt = !0),
          kl(t, l, e),
          (At = a),
          (Pt = u));
        break;
      case 0:
      case 11:
      case 14:
      case 15:
        (ve(2, e, l), jt || ve(4, e, l), kl(t, l, e));
        break;
      case 1:
        (jt ||
          (Hl(e, l),
          (a = e.stateNode),
          typeof a.componentWillUnmount == "function" && Ts(e, l, a)),
          kl(t, l, e));
        break;
      case 21:
        kl(t, l, e);
        break;
      case 22:
        ((jt = (a = jt) || e.memoizedState !== null), kl(t, l, e), (jt = a));
        break;
      default:
        kl(t, l, e);
    }
  }
  function Cs(t, l) {
    if (
      l.memoizedState === null &&
      ((t = l.alternate), t !== null && ((t = t.memoizedState), t !== null))
    ) {
      t = t.dehydrated;
      try {
        xa(t);
      } catch (e) {
        ht(l, l.return, e);
      }
    }
  }
  function Us(t, l) {
    if (
      l.memoizedState === null &&
      ((t = l.alternate),
      t !== null &&
        ((t = t.memoizedState), t !== null && ((t = t.dehydrated), t !== null)))
    )
      try {
        xa(t);
      } catch (e) {
        ht(l, l.return, e);
      }
  }
  function ey(t) {
    switch (t.tag) {
      case 31:
      case 13:
      case 19:
        var l = t.stateNode;
        return (l === null && (l = t.stateNode = new Rs()), l);
      case 22:
        return (
          (t = t.stateNode),
          (l = t._retryCache),
          l === null && (l = t._retryCache = new Rs()),
          l
        );
      default:
        throw Error(o(435, t.tag));
    }
  }
  function Mn(t, l) {
    var e = ey(t);
    l.forEach(function (a) {
      if (!e.has(a)) {
        e.add(a);
        var u = sy.bind(null, t, a);
        a.then(u, u);
      }
    });
  }
  function tl(t, l) {
    var e = l.deletions;
    if (e !== null)
      for (var a = 0; a < e.length; a++) {
        var u = e[a],
          n = t,
          i = l,
          c = i;
        t: for (; c !== null; ) {
          switch (c.tag) {
            case 27:
              if (ze(c.type)) {
                ((At = c.stateNode), (Pt = !1));
                break t;
              }
              break;
            case 5:
              ((At = c.stateNode), (Pt = !1));
              break t;
            case 3:
            case 4:
              ((At = c.stateNode.containerInfo), (Pt = !0));
              break t;
          }
          c = c.return;
        }
        if (At === null) throw Error(o(160));
        (Ds(n, i, u),
          (At = null),
          (Pt = !1),
          (n = u.alternate),
          n !== null && (n.return = null),
          (u.return = null));
      }
    if (l.subtreeFlags & 13886)
      for (l = l.child; l !== null; ) (Ns(l, t), (l = l.sibling));
  }
  var Ml = null;
  function Ns(t, l) {
    var e = t.alternate,
      a = t.flags;
    switch (t.tag) {
      case 0:
      case 11:
      case 14:
      case 15:
        (tl(l, t),
          ll(t),
          a & 4 && (ve(3, t, t.return), hu(3, t), ve(5, t, t.return)));
        break;
      case 1:
        (tl(l, t),
          ll(t),
          a & 512 && (jt || e === null || Hl(e, e.return)),
          a & 64 &&
            Wl &&
            ((t = t.updateQueue),
            t !== null &&
              ((a = t.callbacks),
              a !== null &&
                ((e = t.shared.hiddenCallbacks),
                (t.shared.hiddenCallbacks = e === null ? a : e.concat(a))))));
        break;
      case 26:
        var u = Ml;
        if (
          (tl(l, t),
          ll(t),
          a & 512 && (jt || e === null || Hl(e, e.return)),
          a & 4)
        ) {
          var n = e !== null ? e.memoizedState : null;
          if (((a = t.memoizedState), e === null))
            if (a === null)
              if (t.stateNode === null) {
                t: {
                  ((a = t.type),
                    (e = t.memoizedProps),
                    (u = u.ownerDocument || u));
                  l: switch (a) {
                    case "title":
                      ((n = u.getElementsByTagName("title")[0]),
                        (!n ||
                          n[Xa] ||
                          n[Qt] ||
                          n.namespaceURI === "http://www.w3.org/2000/svg" ||
                          n.hasAttribute("itemprop")) &&
                          ((n = u.createElement(a)),
                          u.head.insertBefore(
                            n,
                            u.querySelector("head > title"),
                          )),
                        Jt(n, a, e),
                        (n[Qt] = t),
                        Lt(n),
                        (a = n));
                      break t;
                    case "link":
                      var i = Nd("link", "href", u).get(a + (e.href || ""));
                      if (i) {
                        for (var c = 0; c < i.length; c++)
                          if (
                            ((n = i[c]),
                            n.getAttribute("href") ===
                              (e.href == null || e.href === ""
                                ? null
                                : e.href) &&
                              n.getAttribute("rel") ===
                                (e.rel == null ? null : e.rel) &&
                              n.getAttribute("title") ===
                                (e.title == null ? null : e.title) &&
                              n.getAttribute("crossorigin") ===
                                (e.crossOrigin == null ? null : e.crossOrigin))
                          ) {
                            i.splice(c, 1);
                            break l;
                          }
                      }
                      ((n = u.createElement(a)),
                        Jt(n, a, e),
                        u.head.appendChild(n));
                      break;
                    case "meta":
                      if (
                        (i = Nd("meta", "content", u).get(
                          a + (e.content || ""),
                        ))
                      ) {
                        for (c = 0; c < i.length; c++)
                          if (
                            ((n = i[c]),
                            n.getAttribute("content") ===
                              (e.content == null ? null : "" + e.content) &&
                              n.getAttribute("name") ===
                                (e.name == null ? null : e.name) &&
                              n.getAttribute("property") ===
                                (e.property == null ? null : e.property) &&
                              n.getAttribute("http-equiv") ===
                                (e.httpEquiv == null ? null : e.httpEquiv) &&
                              n.getAttribute("charset") ===
                                (e.charSet == null ? null : e.charSet))
                          ) {
                            i.splice(c, 1);
                            break l;
                          }
                      }
                      ((n = u.createElement(a)),
                        Jt(n, a, e),
                        u.head.appendChild(n));
                      break;
                    default:
                      throw Error(o(468, a));
                  }
                  ((n[Qt] = t), Lt(n), (a = n));
                }
                t.stateNode = a;
              } else xd(u, t.type, t.stateNode);
            else t.stateNode = Ud(u, a, t.memoizedProps);
          else
            n !== a
              ? (n === null
                  ? e.stateNode !== null &&
                    ((e = e.stateNode), e.parentNode.removeChild(e))
                  : n.count--,
                a === null
                  ? xd(u, t.type, t.stateNode)
                  : Ud(u, a, t.memoizedProps))
              : a === null &&
                t.stateNode !== null &&
                Lf(t, t.memoizedProps, e.memoizedProps);
        }
        break;
      case 27:
        (tl(l, t),
          ll(t),
          a & 512 && (jt || e === null || Hl(e, e.return)),
          e !== null && a & 4 && Lf(t, t.memoizedProps, e.memoizedProps));
        break;
      case 5:
        if (
          (tl(l, t),
          ll(t),
          a & 512 && (jt || e === null || Hl(e, e.return)),
          t.flags & 32)
        ) {
          u = t.stateNode;
          try {
            ea(u, "");
          } catch (L) {
            ht(t, t.return, L);
          }
        }
        (a & 4 &&
          t.stateNode != null &&
          ((u = t.memoizedProps), Lf(t, u, e !== null ? e.memoizedProps : u)),
          a & 1024 && (Qf = !0));
        break;
      case 6:
        if ((tl(l, t), ll(t), a & 4)) {
          if (t.stateNode === null) throw Error(o(162));
          ((a = t.memoizedProps), (e = t.stateNode));
          try {
            e.nodeValue = a;
          } catch (L) {
            ht(t, t.return, L);
          }
        }
        break;
      case 3:
        if (
          ((Vn = null),
          (u = Ml),
          (Ml = Qn(l.containerInfo)),
          tl(l, t),
          (Ml = u),
          ll(t),
          a & 4 && e !== null && e.memoizedState.isDehydrated)
        )
          try {
            xa(l.containerInfo);
          } catch (L) {
            ht(t, t.return, L);
          }
        Qf && ((Qf = !1), xs(t));
        break;
      case 4:
        ((a = Ml),
          (Ml = Qn(t.stateNode.containerInfo)),
          tl(l, t),
          ll(t),
          (Ml = a));
        break;
      case 12:
        (tl(l, t), ll(t));
        break;
      case 31:
        (tl(l, t),
          ll(t),
          a & 4 &&
            ((a = t.updateQueue),
            a !== null && ((t.updateQueue = null), Mn(t, a))));
        break;
      case 13:
        (tl(l, t),
          ll(t),
          t.child.flags & 8192 &&
            (t.memoizedState !== null) !=
              (e !== null && e.memoizedState !== null) &&
            (Cn = ul()),
          a & 4 &&
            ((a = t.updateQueue),
            a !== null && ((t.updateQueue = null), Mn(t, a))));
        break;
      case 22:
        u = t.memoizedState !== null;
        var d = e !== null && e.memoizedState !== null,
          T = Wl,
          R = jt;
        if (
          ((Wl = T || u),
          (jt = R || d),
          tl(l, t),
          (jt = R),
          (Wl = T),
          ll(t),
          a & 8192)
        )
          t: for (
            l = t.stateNode,
              l._visibility = u ? l._visibility & -2 : l._visibility | 1,
              u && (e === null || d || Wl || jt || $e(t)),
              e = null,
              l = t;
            ;
          ) {
            if (l.tag === 5 || l.tag === 26) {
              if (e === null) {
                d = e = l;
                try {
                  if (((n = d.stateNode), u))
                    ((i = n.style),
                      typeof i.setProperty == "function"
                        ? i.setProperty("display", "none", "important")
                        : (i.display = "none"));
                  else {
                    c = d.stateNode;
                    var N = d.memoizedProps.style,
                      z =
                        N != null && N.hasOwnProperty("display")
                          ? N.display
                          : null;
                    c.style.display =
                      z == null || typeof z == "boolean" ? "" : ("" + z).trim();
                  }
                } catch (L) {
                  ht(d, d.return, L);
                }
              }
            } else if (l.tag === 6) {
              if (e === null) {
                d = l;
                try {
                  d.stateNode.nodeValue = u ? "" : d.memoizedProps;
                } catch (L) {
                  ht(d, d.return, L);
                }
              }
            } else if (l.tag === 18) {
              if (e === null) {
                d = l;
                try {
                  var _ = d.stateNode;
                  u ? Td(_, !0) : Td(d.stateNode, !1);
                } catch (L) {
                  ht(d, d.return, L);
                }
              }
            } else if (
              ((l.tag !== 22 && l.tag !== 23) ||
                l.memoizedState === null ||
                l === t) &&
              l.child !== null
            ) {
              ((l.child.return = l), (l = l.child));
              continue;
            }
            if (l === t) break t;
            for (; l.sibling === null; ) {
              if (l.return === null || l.return === t) break t;
              (e === l && (e = null), (l = l.return));
            }
            (e === l && (e = null),
              (l.sibling.return = l.return),
              (l = l.sibling));
          }
        a & 4 &&
          ((a = t.updateQueue),
          a !== null &&
            ((e = a.retryQueue),
            e !== null && ((a.retryQueue = null), Mn(t, e))));
        break;
      case 19:
        (tl(l, t),
          ll(t),
          a & 4 &&
            ((a = t.updateQueue),
            a !== null && ((t.updateQueue = null), Mn(t, a))));
        break;
      case 30:
        break;
      case 21:
        break;
      default:
        (tl(l, t), ll(t));
    }
  }
  function ll(t) {
    var l = t.flags;
    if (l & 2) {
      try {
        for (var e, a = t.return; a !== null; ) {
          if (_s(a)) {
            e = a;
            break;
          }
          a = a.return;
        }
        if (e == null) throw Error(o(160));
        switch (e.tag) {
          case 27:
            var u = e.stateNode,
              n = Gf(t);
            On(t, n, u);
            break;
          case 5:
            var i = e.stateNode;
            e.flags & 32 && (ea(i, ""), (e.flags &= -33));
            var c = Gf(t);
            On(t, c, i);
            break;
          case 3:
          case 4:
            var d = e.stateNode.containerInfo,
              T = Gf(t);
            Xf(t, T, d);
            break;
          default:
            throw Error(o(161));
        }
      } catch (R) {
        ht(t, t.return, R);
      }
      t.flags &= -3;
    }
    l & 4096 && (t.flags &= -4097);
  }
  function xs(t) {
    if (t.subtreeFlags & 1024)
      for (t = t.child; t !== null; ) {
        var l = t;
        (xs(l),
          l.tag === 5 && l.flags & 1024 && l.stateNode.reset(),
          (t = t.sibling));
      }
  }
  function Fl(t, l) {
    if (l.subtreeFlags & 8772)
      for (l = l.child; l !== null; ) (Os(t, l.alternate, l), (l = l.sibling));
  }
  function $e(t) {
    for (t = t.child; t !== null; ) {
      var l = t;
      switch (l.tag) {
        case 0:
        case 11:
        case 14:
        case 15:
          (ve(4, l, l.return), $e(l));
          break;
        case 1:
          Hl(l, l.return);
          var e = l.stateNode;
          (typeof e.componentWillUnmount == "function" && Ts(l, l.return, e),
            $e(l));
          break;
        case 27:
          zu(l.stateNode);
        case 26:
        case 5:
          (Hl(l, l.return), $e(l));
          break;
        case 22:
          l.memoizedState === null && $e(l);
          break;
        case 30:
          $e(l);
          break;
        default:
          $e(l);
      }
      t = t.sibling;
    }
  }
  function Il(t, l, e) {
    for (e = e && (l.subtreeFlags & 8772) !== 0, l = l.child; l !== null; ) {
      var a = l.alternate,
        u = t,
        n = l,
        i = n.flags;
      switch (n.tag) {
        case 0:
        case 11:
        case 15:
          (Il(u, n, e), hu(4, n));
          break;
        case 1:
          if (
            (Il(u, n, e),
            (a = n),
            (u = a.stateNode),
            typeof u.componentDidMount == "function")
          )
            try {
              u.componentDidMount();
            } catch (T) {
              ht(a, a.return, T);
            }
          if (((a = n), (u = a.updateQueue), u !== null)) {
            var c = a.stateNode;
            try {
              var d = u.shared.hiddenCallbacks;
              if (d !== null)
                for (u.shared.hiddenCallbacks = null, u = 0; u < d.length; u++)
                  rr(d[u], c);
            } catch (T) {
              ht(a, a.return, T);
            }
          }
          (e && i & 64 && Es(n), mu(n, n.return));
          break;
        case 27:
          As(n);
        case 26:
        case 5:
          (Il(u, n, e), e && a === null && i & 4 && zs(n), mu(n, n.return));
          break;
        case 12:
          Il(u, n, e);
          break;
        case 31:
          (Il(u, n, e), e && i & 4 && Cs(u, n));
          break;
        case 13:
          (Il(u, n, e), e && i & 4 && Us(u, n));
          break;
        case 22:
          (n.memoizedState === null && Il(u, n, e), mu(n, n.return));
          break;
        case 30:
          break;
        default:
          Il(u, n, e);
      }
      l = l.sibling;
    }
  }
  function Zf(t, l) {
    var e = null;
    (t !== null &&
      t.memoizedState !== null &&
      t.memoizedState.cachePool !== null &&
      (e = t.memoizedState.cachePool.pool),
      (t = null),
      l.memoizedState !== null &&
        l.memoizedState.cachePool !== null &&
        (t = l.memoizedState.cachePool.pool),
      t !== e && (t != null && t.refCount++, e != null && tu(e)));
  }
  function Vf(t, l) {
    ((t = null),
      l.alternate !== null && (t = l.alternate.memoizedState.cache),
      (l = l.memoizedState.cache),
      l !== t && (l.refCount++, t != null && tu(t)));
  }
  function Dl(t, l, e, a) {
    if (l.subtreeFlags & 10256)
      for (l = l.child; l !== null; ) (Hs(t, l, e, a), (l = l.sibling));
  }
  function Hs(t, l, e, a) {
    var u = l.flags;
    switch (l.tag) {
      case 0:
      case 11:
      case 15:
        (Dl(t, l, e, a), u & 2048 && hu(9, l));
        break;
      case 1:
        Dl(t, l, e, a);
        break;
      case 3:
        (Dl(t, l, e, a),
          u & 2048 &&
            ((t = null),
            l.alternate !== null && (t = l.alternate.memoizedState.cache),
            (l = l.memoizedState.cache),
            l !== t && (l.refCount++, t != null && tu(t))));
        break;
      case 12:
        if (u & 2048) {
          (Dl(t, l, e, a), (t = l.stateNode));
          try {
            var n = l.memoizedProps,
              i = n.id,
              c = n.onPostCommit;
            typeof c == "function" &&
              c(
                i,
                l.alternate === null ? "mount" : "update",
                t.passiveEffectDuration,
                -0,
              );
          } catch (d) {
            ht(l, l.return, d);
          }
        } else Dl(t, l, e, a);
        break;
      case 31:
        Dl(t, l, e, a);
        break;
      case 13:
        Dl(t, l, e, a);
        break;
      case 23:
        break;
      case 22:
        ((n = l.stateNode),
          (i = l.alternate),
          l.memoizedState !== null
            ? n._visibility & 2
              ? Dl(t, l, e, a)
              : yu(t, l)
            : n._visibility & 2
              ? Dl(t, l, e, a)
              : ((n._visibility |= 2),
                Ta(t, l, e, a, (l.subtreeFlags & 10256) !== 0 || !1)),
          u & 2048 && Zf(i, l));
        break;
      case 24:
        (Dl(t, l, e, a), u & 2048 && Vf(l.alternate, l));
        break;
      default:
        Dl(t, l, e, a);
    }
  }
  function Ta(t, l, e, a, u) {
    for (
      u = u && ((l.subtreeFlags & 10256) !== 0 || !1), l = l.child;
      l !== null;
    ) {
      var n = t,
        i = l,
        c = e,
        d = a,
        T = i.flags;
      switch (i.tag) {
        case 0:
        case 11:
        case 15:
          (Ta(n, i, c, d, u), hu(8, i));
          break;
        case 23:
          break;
        case 22:
          var R = i.stateNode;
          (i.memoizedState !== null
            ? R._visibility & 2
              ? Ta(n, i, c, d, u)
              : yu(n, i)
            : ((R._visibility |= 2), Ta(n, i, c, d, u)),
            u && T & 2048 && Zf(i.alternate, i));
          break;
        case 24:
          (Ta(n, i, c, d, u), u && T & 2048 && Vf(i.alternate, i));
          break;
        default:
          Ta(n, i, c, d, u);
      }
      l = l.sibling;
    }
  }
  function yu(t, l) {
    if (l.subtreeFlags & 10256)
      for (l = l.child; l !== null; ) {
        var e = t,
          a = l,
          u = a.flags;
        switch (a.tag) {
          case 22:
            (yu(e, a), u & 2048 && Zf(a.alternate, a));
            break;
          case 24:
            (yu(e, a), u & 2048 && Vf(a.alternate, a));
            break;
          default:
            yu(e, a);
        }
        l = l.sibling;
      }
  }
  var vu = 8192;
  function za(t, l, e) {
    if (t.subtreeFlags & vu)
      for (t = t.child; t !== null; ) (Bs(t, l, e), (t = t.sibling));
  }
  function Bs(t, l, e) {
    switch (t.tag) {
      case 26:
        (za(t, l, e),
          t.flags & vu &&
            t.memoizedState !== null &&
            Qy(e, Ml, t.memoizedState, t.memoizedProps));
        break;
      case 5:
        za(t, l, e);
        break;
      case 3:
      case 4:
        var a = Ml;
        ((Ml = Qn(t.stateNode.containerInfo)), za(t, l, e), (Ml = a));
        break;
      case 22:
        t.memoizedState === null &&
          ((a = t.alternate),
          a !== null && a.memoizedState !== null
            ? ((a = vu), (vu = 16777216), za(t, l, e), (vu = a))
            : za(t, l, e));
        break;
      default:
        za(t, l, e);
    }
  }
  function qs(t) {
    var l = t.alternate;
    if (l !== null && ((t = l.child), t !== null)) {
      l.child = null;
      do ((l = t.sibling), (t.sibling = null), (t = l));
      while (t !== null);
    }
  }
  function gu(t) {
    var l = t.deletions;
    if ((t.flags & 16) !== 0) {
      if (l !== null)
        for (var e = 0; e < l.length; e++) {
          var a = l[e];
          ((Gt = a), Ys(a, t));
        }
      qs(t);
    }
    if (t.subtreeFlags & 10256)
      for (t = t.child; t !== null; ) (js(t), (t = t.sibling));
  }
  function js(t) {
    switch (t.tag) {
      case 0:
      case 11:
      case 15:
        (gu(t), t.flags & 2048 && ve(9, t, t.return));
        break;
      case 3:
        gu(t);
        break;
      case 12:
        gu(t);
        break;
      case 22:
        var l = t.stateNode;
        t.memoizedState !== null &&
        l._visibility & 2 &&
        (t.return === null || t.return.tag !== 13)
          ? ((l._visibility &= -3), Dn(t))
          : gu(t);
        break;
      default:
        gu(t);
    }
  }
  function Dn(t) {
    var l = t.deletions;
    if ((t.flags & 16) !== 0) {
      if (l !== null)
        for (var e = 0; e < l.length; e++) {
          var a = l[e];
          ((Gt = a), Ys(a, t));
        }
      qs(t);
    }
    for (t = t.child; t !== null; ) {
      switch (((l = t), l.tag)) {
        case 0:
        case 11:
        case 15:
          (ve(8, l, l.return), Dn(l));
          break;
        case 22:
          ((e = l.stateNode),
            e._visibility & 2 && ((e._visibility &= -3), Dn(l)));
          break;
        default:
          Dn(l);
      }
      t = t.sibling;
    }
  }
  function Ys(t, l) {
    for (; Gt !== null; ) {
      var e = Gt;
      switch (e.tag) {
        case 0:
        case 11:
        case 15:
          ve(8, e, l);
          break;
        case 23:
        case 22:
          if (e.memoizedState !== null && e.memoizedState.cachePool !== null) {
            var a = e.memoizedState.cachePool.pool;
            a != null && a.refCount++;
          }
          break;
        case 24:
          tu(e.memoizedState.cache);
      }
      if (((a = e.child), a !== null)) ((a.return = e), (Gt = a));
      else
        t: for (e = t; Gt !== null; ) {
          a = Gt;
          var u = a.sibling,
            n = a.return;
          if ((Ms(a), a === e)) {
            Gt = null;
            break t;
          }
          if (u !== null) {
            ((u.return = n), (Gt = u));
            break t;
          }
          Gt = n;
        }
    }
  }
  var ay = {
      getCacheForType: function (t) {
        var l = Vt(Ht),
          e = l.data.get(t);
        return (e === void 0 && ((e = t()), l.data.set(t, e)), e);
      },
      cacheSignal: function () {
        return Vt(Ht).controller.signal;
      },
    },
    uy = typeof WeakMap == "function" ? WeakMap : Map,
    rt = 0,
    Et = null,
    et = null,
    ut = 0,
    dt = 0,
    sl = null,
    ge = !1,
    _a = !1,
    Kf = !1,
    Pl = 0,
    Mt = 0,
    pe = 0,
    We = 0,
    Jf = 0,
    dl = 0,
    Aa = 0,
    pu = null,
    el = null,
    wf = !1,
    Cn = 0,
    Ls = 0,
    Un = 1 / 0,
    Nn = null,
    Se = null,
    Yt = 0,
    be = null,
    Ra = null,
    te = 0,
    $f = 0,
    Wf = null,
    Gs = null,
    Su = 0,
    kf = null;
  function hl() {
    return (rt & 2) !== 0 && ut !== 0 ? ut & -ut : D.T !== null ? ec() : lo();
  }
  function Xs() {
    if (dl === 0)
      if ((ut & 536870912) === 0 || it) {
        var t = Lu;
        ((Lu <<= 1), (Lu & 3932160) === 0 && (Lu = 262144), (dl = t));
      } else dl = 536870912;
    return ((t = ol.current), t !== null && (t.flags |= 32), dl);
  }
  function al(t, l, e) {
    (((t === Et && (dt === 2 || dt === 9)) || t.cancelPendingCommit !== null) &&
      (Oa(t, 0), Ee(t, ut, dl, !1)),
      Ga(t, e),
      ((rt & 2) === 0 || t !== Et) &&
        (t === Et &&
          ((rt & 2) === 0 && (We |= e), Mt === 4 && Ee(t, ut, dl, !1)),
        Bl(t)));
  }
  function Qs(t, l, e) {
    if ((rt & 6) !== 0) throw Error(o(327));
    var a = (!e && (l & 127) === 0 && (l & t.expiredLanes) === 0) || La(t, l),
      u = a ? fy(t, l) : If(t, l, !0),
      n = a;
    do {
      if (u === 0) {
        _a && !a && Ee(t, l, 0, !1);
        break;
      } else {
        if (((e = t.current.alternate), n && !ny(e))) {
          ((u = If(t, l, !1)), (n = !1));
          continue;
        }
        if (u === 2) {
          if (((n = l), t.errorRecoveryDisabledLanes & n)) var i = 0;
          else
            ((i = t.pendingLanes & -536870913),
              (i = i !== 0 ? i : i & 536870912 ? 536870912 : 0));
          if (i !== 0) {
            l = i;
            t: {
              var c = t;
              u = pu;
              var d = c.current.memoizedState.isDehydrated;
              if ((d && (Oa(c, i).flags |= 256), (i = If(c, i, !1)), i !== 2)) {
                if (Kf && !d) {
                  ((c.errorRecoveryDisabledLanes |= n), (We |= n), (u = 4));
                  break t;
                }
                ((n = el),
                  (el = u),
                  n !== null &&
                    (el === null ? (el = n) : el.push.apply(el, n)));
              }
              u = i;
            }
            if (((n = !1), u !== 2)) continue;
          }
        }
        if (u === 1) {
          (Oa(t, 0), Ee(t, l, 0, !0));
          break;
        }
        t: {
          switch (((a = t), (n = u), n)) {
            case 0:
            case 1:
              throw Error(o(345));
            case 4:
              if ((l & 4194048) !== l) break;
            case 6:
              Ee(a, l, dl, !ge);
              break t;
            case 2:
              el = null;
              break;
            case 3:
            case 5:
              break;
            default:
              throw Error(o(329));
          }
          if ((l & 62914560) === l && ((u = Cn + 300 - ul()), 10 < u)) {
            if ((Ee(a, l, dl, !ge), Xu(a, 0, !0) !== 0)) break t;
            ((te = l),
              (a.timeoutHandle = Sd(
                Zs.bind(
                  null,
                  a,
                  e,
                  el,
                  Nn,
                  wf,
                  l,
                  dl,
                  We,
                  Aa,
                  ge,
                  n,
                  "Throttled",
                  -0,
                  0,
                ),
                u,
              )));
            break t;
          }
          Zs(a, e, el, Nn, wf, l, dl, We, Aa, ge, n, null, -0, 0);
        }
      }
      break;
    } while (!0);
    Bl(t);
  }
  function Zs(t, l, e, a, u, n, i, c, d, T, R, N, z, _) {
    if (
      ((t.timeoutHandle = -1),
      (N = l.subtreeFlags),
      N & 8192 || (N & 16785408) === 16785408)
    ) {
      ((N = {
        stylesheets: null,
        count: 0,
        imgCount: 0,
        imgBytes: 0,
        suspenseyImages: [],
        waitingForImages: !0,
        waitingForViewTransition: !1,
        unsuspend: Ll,
      }),
        Bs(l, n, N));
      var L =
        (n & 62914560) === n ? Cn - ul() : (n & 4194048) === n ? Ls - ul() : 0;
      if (((L = Zy(N, L)), L !== null)) {
        ((te = n),
          (t.cancelPendingCommit = L(
            Fs.bind(null, t, l, n, e, a, u, i, c, d, R, N, null, z, _),
          )),
          Ee(t, n, i, !T));
        return;
      }
    }
    Fs(t, l, n, e, a, u, i, c, d);
  }
  function ny(t) {
    for (var l = t; ; ) {
      var e = l.tag;
      if (
        (e === 0 || e === 11 || e === 15) &&
        l.flags & 16384 &&
        ((e = l.updateQueue), e !== null && ((e = e.stores), e !== null))
      )
        for (var a = 0; a < e.length; a++) {
          var u = e[a],
            n = u.getSnapshot;
          u = u.value;
          try {
            if (!fl(n(), u)) return !1;
          } catch {
            return !1;
          }
        }
      if (((e = l.child), l.subtreeFlags & 16384 && e !== null))
        ((e.return = l), (l = e));
      else {
        if (l === t) break;
        for (; l.sibling === null; ) {
          if (l.return === null || l.return === t) return !0;
          l = l.return;
        }
        ((l.sibling.return = l.return), (l = l.sibling));
      }
    }
    return !0;
  }
  function Ee(t, l, e, a) {
    ((l &= ~Jf),
      (l &= ~We),
      (t.suspendedLanes |= l),
      (t.pingedLanes &= ~l),
      a && (t.warmLanes |= l),
      (a = t.expirationTimes));
    for (var u = l; 0 < u; ) {
      var n = 31 - il(u),
        i = 1 << n;
      ((a[n] = -1), (u &= ~i));
    }
    e !== 0 && Ic(t, e, l);
  }
  function xn() {
    return (rt & 6) === 0 ? (bu(0), !1) : !0;
  }
  function Ff() {
    if (et !== null) {
      if (dt === 0) var t = et.return;
      else ((t = et), (Zl = Ge = null), hf(t), (ga = null), (eu = 0), (t = et));
      for (; t !== null; ) (bs(t.alternate, t), (t = t.return));
      et = null;
    }
  }
  function Oa(t, l) {
    var e = t.timeoutHandle;
    (e !== -1 && ((t.timeoutHandle = -1), Ay(e)),
      (e = t.cancelPendingCommit),
      e !== null && ((t.cancelPendingCommit = null), e()),
      (te = 0),
      Ff(),
      (Et = t),
      (et = e = Xl(t.current, null)),
      (ut = l),
      (dt = 0),
      (sl = null),
      (ge = !1),
      (_a = La(t, l)),
      (Kf = !1),
      (Aa = dl = Jf = We = pe = Mt = 0),
      (el = pu = null),
      (wf = !1),
      (l & 8) !== 0 && (l |= l & 32));
    var a = t.entangledLanes;
    if (a !== 0)
      for (t = t.entanglements, a &= l; 0 < a; ) {
        var u = 31 - il(a),
          n = 1 << u;
        ((l |= t[u]), (a &= ~n));
      }
    return ((Pl = l), Pu(), e);
  }
  function Vs(t, l) {
    ((P = null),
      (D.H = ru),
      l === va || l === cn
        ? ((l = ir()), (dt = 3))
        : l === tf
          ? ((l = ir()), (dt = 4))
          : (dt =
              l === Df
                ? 8
                : l !== null &&
                    typeof l == "object" &&
                    typeof l.then == "function"
                  ? 6
                  : 1),
      (sl = l),
      et === null && ((Mt = 1), Tn(t, Sl(l, t.current))));
  }
  function Ks() {
    var t = ol.current;
    return t === null
      ? !0
      : (ut & 4194048) === ut
        ? zl === null
        : (ut & 62914560) === ut || (ut & 536870912) !== 0
          ? t === zl
          : !1;
  }
  function Js() {
    var t = D.H;
    return ((D.H = ru), t === null ? ru : t);
  }
  function ws() {
    var t = D.A;
    return ((D.A = ay), t);
  }
  function Hn() {
    ((Mt = 4),
      ge || ((ut & 4194048) !== ut && ol.current !== null) || (_a = !0),
      ((pe & 134217727) === 0 && (We & 134217727) === 0) ||
        Et === null ||
        Ee(Et, ut, dl, !1));
  }
  function If(t, l, e) {
    var a = rt;
    rt |= 2;
    var u = Js(),
      n = ws();
    ((Et !== t || ut !== l) && ((Nn = null), Oa(t, l)), (l = !1));
    var i = Mt;
    t: do
      try {
        if (dt !== 0 && et !== null) {
          var c = et,
            d = sl;
          switch (dt) {
            case 8:
              (Ff(), (i = 6));
              break t;
            case 3:
            case 2:
            case 9:
            case 6:
              ol.current === null && (l = !0);
              var T = dt;
              if (((dt = 0), (sl = null), Ma(t, c, d, T), e && _a)) {
                i = 0;
                break t;
              }
              break;
            default:
              ((T = dt), (dt = 0), (sl = null), Ma(t, c, d, T));
          }
        }
        (iy(), (i = Mt));
        break;
      } catch (R) {
        Vs(t, R);
      }
    while (!0);
    return (
      l && t.shellSuspendCounter++,
      (Zl = Ge = null),
      (rt = a),
      (D.H = u),
      (D.A = n),
      et === null && ((Et = null), (ut = 0), Pu()),
      i
    );
  }
  function iy() {
    for (; et !== null; ) $s(et);
  }
  function fy(t, l) {
    var e = rt;
    rt |= 2;
    var a = Js(),
      u = ws();
    Et !== t || ut !== l
      ? ((Nn = null), (Un = ul() + 500), Oa(t, l))
      : (_a = La(t, l));
    t: do
      try {
        if (dt !== 0 && et !== null) {
          l = et;
          var n = sl;
          l: switch (dt) {
            case 1:
              ((dt = 0), (sl = null), Ma(t, l, n, 1));
              break;
            case 2:
            case 9:
              if (ur(n)) {
                ((dt = 0), (sl = null), Ws(l));
                break;
              }
              ((l = function () {
                ((dt !== 2 && dt !== 9) || Et !== t || (dt = 7), Bl(t));
              }),
                n.then(l, l));
              break t;
            case 3:
              dt = 7;
              break t;
            case 4:
              dt = 5;
              break t;
            case 7:
              ur(n)
                ? ((dt = 0), (sl = null), Ws(l))
                : ((dt = 0), (sl = null), Ma(t, l, n, 7));
              break;
            case 5:
              var i = null;
              switch (et.tag) {
                case 26:
                  i = et.memoizedState;
                case 5:
                case 27:
                  var c = et;
                  if (i ? Hd(i) : c.stateNode.complete) {
                    ((dt = 0), (sl = null));
                    var d = c.sibling;
                    if (d !== null) et = d;
                    else {
                      var T = c.return;
                      T !== null ? ((et = T), Bn(T)) : (et = null);
                    }
                    break l;
                  }
              }
              ((dt = 0), (sl = null), Ma(t, l, n, 5));
              break;
            case 6:
              ((dt = 0), (sl = null), Ma(t, l, n, 6));
              break;
            case 8:
              (Ff(), (Mt = 6));
              break t;
            default:
              throw Error(o(462));
          }
        }
        cy();
        break;
      } catch (R) {
        Vs(t, R);
      }
    while (!0);
    return (
      (Zl = Ge = null),
      (D.H = a),
      (D.A = u),
      (rt = e),
      et !== null ? 0 : ((Et = null), (ut = 0), Pu(), Mt)
    );
  }
  function cy() {
    for (; et !== null && !Uh(); ) $s(et);
  }
  function $s(t) {
    var l = ps(t.alternate, t, Pl);
    ((t.memoizedProps = t.pendingProps), l === null ? Bn(t) : (et = l));
  }
  function Ws(t) {
    var l = t,
      e = l.alternate;
    switch (l.tag) {
      case 15:
      case 0:
        l = ds(e, l, l.pendingProps, l.type, void 0, ut);
        break;
      case 11:
        l = ds(e, l, l.pendingProps, l.type.render, l.ref, ut);
        break;
      case 5:
        hf(l);
      default:
        (bs(e, l), (l = et = wo(l, Pl)), (l = ps(e, l, Pl)));
    }
    ((t.memoizedProps = t.pendingProps), l === null ? Bn(t) : (et = l));
  }
  function Ma(t, l, e, a) {
    ((Zl = Ge = null), hf(l), (ga = null), (eu = 0));
    var u = l.return;
    try {
      if (km(t, u, l, e, ut)) {
        ((Mt = 1), Tn(t, Sl(e, t.current)), (et = null));
        return;
      }
    } catch (n) {
      if (u !== null) throw ((et = u), n);
      ((Mt = 1), Tn(t, Sl(e, t.current)), (et = null));
      return;
    }
    l.flags & 32768
      ? (it || a === 1
          ? (t = !0)
          : _a || (ut & 536870912) !== 0
            ? (t = !1)
            : ((ge = t = !0),
              (a === 2 || a === 9 || a === 3 || a === 6) &&
                ((a = ol.current),
                a !== null && a.tag === 13 && (a.flags |= 16384))),
        ks(l, t))
      : Bn(l);
  }
  function Bn(t) {
    var l = t;
    do {
      if ((l.flags & 32768) !== 0) {
        ks(l, ge);
        return;
      }
      t = l.return;
      var e = Pm(l.alternate, l, Pl);
      if (e !== null) {
        et = e;
        return;
      }
      if (((l = l.sibling), l !== null)) {
        et = l;
        return;
      }
      et = l = t;
    } while (l !== null);
    Mt === 0 && (Mt = 5);
  }
  function ks(t, l) {
    do {
      var e = ty(t.alternate, t);
      if (e !== null) {
        ((e.flags &= 32767), (et = e));
        return;
      }
      if (
        ((e = t.return),
        e !== null &&
          ((e.flags |= 32768), (e.subtreeFlags = 0), (e.deletions = null)),
        !l && ((t = t.sibling), t !== null))
      ) {
        et = t;
        return;
      }
      et = t = e;
    } while (t !== null);
    ((Mt = 6), (et = null));
  }
  function Fs(t, l, e, a, u, n, i, c, d) {
    t.cancelPendingCommit = null;
    do qn();
    while (Yt !== 0);
    if ((rt & 6) !== 0) throw Error(o(327));
    if (l !== null) {
      if (l === t.current) throw Error(o(177));
      if (
        ((n = l.lanes | l.childLanes),
        (n |= Li),
        Xh(t, e, n, i, c, d),
        t === Et && ((et = Et = null), (ut = 0)),
        (Ra = l),
        (be = t),
        (te = e),
        ($f = n),
        (Wf = u),
        (Gs = a),
        (l.subtreeFlags & 10256) !== 0 || (l.flags & 10256) !== 0
          ? ((t.callbackNode = null),
            (t.callbackPriority = 0),
            dy(ju, function () {
              return (ed(), null);
            }))
          : ((t.callbackNode = null), (t.callbackPriority = 0)),
        (a = (l.flags & 13878) !== 0),
        (l.subtreeFlags & 13878) !== 0 || a)
      ) {
        ((a = D.T), (D.T = null), (u = B.p), (B.p = 2), (i = rt), (rt |= 4));
        try {
          ly(t, l, e);
        } finally {
          ((rt = i), (B.p = u), (D.T = a));
        }
      }
      ((Yt = 1), Is(), Ps(), td());
    }
  }
  function Is() {
    if (Yt === 1) {
      Yt = 0;
      var t = be,
        l = Ra,
        e = (l.flags & 13878) !== 0;
      if ((l.subtreeFlags & 13878) !== 0 || e) {
        ((e = D.T), (D.T = null));
        var a = B.p;
        B.p = 2;
        var u = rt;
        rt |= 4;
        try {
          Ns(l, t);
          var n = rc,
            i = Yo(t.containerInfo),
            c = n.focusedElem,
            d = n.selectionRange;
          if (
            i !== c &&
            c &&
            c.ownerDocument &&
            jo(c.ownerDocument.documentElement, c)
          ) {
            if (d !== null && Hi(c)) {
              var T = d.start,
                R = d.end;
              if ((R === void 0 && (R = T), "selectionStart" in c))
                ((c.selectionStart = T),
                  (c.selectionEnd = Math.min(R, c.value.length)));
              else {
                var N = c.ownerDocument || document,
                  z = (N && N.defaultView) || window;
                if (z.getSelection) {
                  var _ = z.getSelection(),
                    L = c.textContent.length,
                    J = Math.min(d.start, L),
                    pt = d.end === void 0 ? J : Math.min(d.end, L);
                  !_.extend && J > pt && ((i = pt), (pt = J), (J = i));
                  var p = qo(c, J),
                    y = qo(c, pt);
                  if (
                    p &&
                    y &&
                    (_.rangeCount !== 1 ||
                      _.anchorNode !== p.node ||
                      _.anchorOffset !== p.offset ||
                      _.focusNode !== y.node ||
                      _.focusOffset !== y.offset)
                  ) {
                    var b = N.createRange();
                    (b.setStart(p.node, p.offset),
                      _.removeAllRanges(),
                      J > pt
                        ? (_.addRange(b), _.extend(y.node, y.offset))
                        : (b.setEnd(y.node, y.offset), _.addRange(b)));
                  }
                }
              }
            }
            for (N = [], _ = c; (_ = _.parentNode); )
              _.nodeType === 1 &&
                N.push({ element: _, left: _.scrollLeft, top: _.scrollTop });
            for (
              typeof c.focus == "function" && c.focus(), c = 0;
              c < N.length;
              c++
            ) {
              var C = N[c];
              ((C.element.scrollLeft = C.left), (C.element.scrollTop = C.top));
            }
          }
          (($n = !!oc), (rc = oc = null));
        } finally {
          ((rt = u), (B.p = a), (D.T = e));
        }
      }
      ((t.current = l), (Yt = 2));
    }
  }
  function Ps() {
    if (Yt === 2) {
      Yt = 0;
      var t = be,
        l = Ra,
        e = (l.flags & 8772) !== 0;
      if ((l.subtreeFlags & 8772) !== 0 || e) {
        ((e = D.T), (D.T = null));
        var a = B.p;
        B.p = 2;
        var u = rt;
        rt |= 4;
        try {
          Os(t, l.alternate, l);
        } finally {
          ((rt = u), (B.p = a), (D.T = e));
        }
      }
      Yt = 3;
    }
  }
  function td() {
    if (Yt === 4 || Yt === 3) {
      ((Yt = 0), Nh());
      var t = be,
        l = Ra,
        e = te,
        a = Gs;
      (l.subtreeFlags & 10256) !== 0 || (l.flags & 10256) !== 0
        ? (Yt = 5)
        : ((Yt = 0), (Ra = be = null), ld(t, t.pendingLanes));
      var u = t.pendingLanes;
      if (
        (u === 0 && (Se = null),
        yi(e),
        (l = l.stateNode),
        nl && typeof nl.onCommitFiberRoot == "function")
      )
        try {
          nl.onCommitFiberRoot(Ya, l, void 0, (l.current.flags & 128) === 128);
        } catch {}
      if (a !== null) {
        ((l = D.T), (u = B.p), (B.p = 2), (D.T = null));
        try {
          for (var n = t.onRecoverableError, i = 0; i < a.length; i++) {
            var c = a[i];
            n(c.value, { componentStack: c.stack });
          }
        } finally {
          ((D.T = l), (B.p = u));
        }
      }
      ((te & 3) !== 0 && qn(),
        Bl(t),
        (u = t.pendingLanes),
        (e & 261930) !== 0 && (u & 42) !== 0
          ? t === kf
            ? Su++
            : ((Su = 0), (kf = t))
          : (Su = 0),
        bu(0));
    }
  }
  function ld(t, l) {
    (t.pooledCacheLanes &= l) === 0 &&
      ((l = t.pooledCache), l != null && ((t.pooledCache = null), tu(l)));
  }
  function qn() {
    return (Is(), Ps(), td(), ed());
  }
  function ed() {
    if (Yt !== 5) return !1;
    var t = be,
      l = $f;
    $f = 0;
    var e = yi(te),
      a = D.T,
      u = B.p;
    try {
      ((B.p = 32 > e ? 32 : e), (D.T = null), (e = Wf), (Wf = null));
      var n = be,
        i = te;
      if (((Yt = 0), (Ra = be = null), (te = 0), (rt & 6) !== 0))
        throw Error(o(331));
      var c = rt;
      if (
        ((rt |= 4),
        js(n.current),
        Hs(n, n.current, i, e),
        (rt = c),
        bu(0, !1),
        nl && typeof nl.onPostCommitFiberRoot == "function")
      )
        try {
          nl.onPostCommitFiberRoot(Ya, n);
        } catch {}
      return !0;
    } finally {
      ((B.p = u), (D.T = a), ld(t, l));
    }
  }
  function ad(t, l, e) {
    ((l = Sl(e, l)),
      (l = Mf(t.stateNode, l, 2)),
      (t = he(t, l, 2)),
      t !== null && (Ga(t, 2), Bl(t)));
  }
  function ht(t, l, e) {
    if (t.tag === 3) ad(t, t, e);
    else
      for (; l !== null; ) {
        if (l.tag === 3) {
          ad(l, t, e);
          break;
        } else if (l.tag === 1) {
          var a = l.stateNode;
          if (
            typeof l.type.getDerivedStateFromError == "function" ||
            (typeof a.componentDidCatch == "function" &&
              (Se === null || !Se.has(a)))
          ) {
            ((t = Sl(e, t)),
              (e = us(2)),
              (a = he(l, e, 2)),
              a !== null && (ns(e, a, l, t), Ga(a, 2), Bl(a)));
            break;
          }
        }
        l = l.return;
      }
  }
  function Pf(t, l, e) {
    var a = t.pingCache;
    if (a === null) {
      a = t.pingCache = new uy();
      var u = new Set();
      a.set(l, u);
    } else ((u = a.get(l)), u === void 0 && ((u = new Set()), a.set(l, u)));
    u.has(e) ||
      ((Kf = !0), u.add(e), (t = oy.bind(null, t, l, e)), l.then(t, t));
  }
  function oy(t, l, e) {
    var a = t.pingCache;
    (a !== null && a.delete(l),
      (t.pingedLanes |= t.suspendedLanes & e),
      (t.warmLanes &= ~e),
      Et === t &&
        (ut & e) === e &&
        (Mt === 4 || (Mt === 3 && (ut & 62914560) === ut && 300 > ul() - Cn)
          ? (rt & 2) === 0 && Oa(t, 0)
          : (Jf |= e),
        Aa === ut && (Aa = 0)),
      Bl(t));
  }
  function ud(t, l) {
    (l === 0 && (l = Fc()), (t = je(t, l)), t !== null && (Ga(t, l), Bl(t)));
  }
  function ry(t) {
    var l = t.memoizedState,
      e = 0;
    (l !== null && (e = l.retryLane), ud(t, e));
  }
  function sy(t, l) {
    var e = 0;
    switch (t.tag) {
      case 31:
      case 13:
        var a = t.stateNode,
          u = t.memoizedState;
        u !== null && (e = u.retryLane);
        break;
      case 19:
        a = t.stateNode;
        break;
      case 22:
        a = t.stateNode._retryCache;
        break;
      default:
        throw Error(o(314));
    }
    (a !== null && a.delete(l), ud(t, e));
  }
  function dy(t, l) {
    return si(t, l);
  }
  var jn = null,
    Da = null,
    tc = !1,
    Yn = !1,
    lc = !1,
    Te = 0;
  function Bl(t) {
    (t !== Da &&
      t.next === null &&
      (Da === null ? (jn = Da = t) : (Da = Da.next = t)),
      (Yn = !0),
      tc || ((tc = !0), my()));
  }
  function bu(t, l) {
    if (!lc && Yn) {
      lc = !0;
      do
        for (var e = !1, a = jn; a !== null; ) {
          if (t !== 0) {
            var u = a.pendingLanes;
            if (u === 0) var n = 0;
            else {
              var i = a.suspendedLanes,
                c = a.pingedLanes;
              ((n = (1 << (31 - il(42 | t) + 1)) - 1),
                (n &= u & ~(i & ~c)),
                (n = n & 201326741 ? (n & 201326741) | 1 : n ? n | 2 : 0));
            }
            n !== 0 && ((e = !0), cd(a, n));
          } else
            ((n = ut),
              (n = Xu(
                a,
                a === Et ? n : 0,
                a.cancelPendingCommit !== null || a.timeoutHandle !== -1,
              )),
              (n & 3) === 0 || La(a, n) || ((e = !0), cd(a, n)));
          a = a.next;
        }
      while (e);
      lc = !1;
    }
  }
  function hy() {
    nd();
  }
  function nd() {
    Yn = tc = !1;
    var t = 0;
    Te !== 0 && _y() && (t = Te);
    for (var l = ul(), e = null, a = jn; a !== null; ) {
      var u = a.next,
        n = id(a, l);
      (n === 0
        ? ((a.next = null),
          e === null ? (jn = u) : (e.next = u),
          u === null && (Da = e))
        : ((e = a), (t !== 0 || (n & 3) !== 0) && (Yn = !0)),
        (a = u));
    }
    ((Yt !== 0 && Yt !== 5) || bu(t), Te !== 0 && (Te = 0));
  }
  function id(t, l) {
    for (
      var e = t.suspendedLanes,
        a = t.pingedLanes,
        u = t.expirationTimes,
        n = t.pendingLanes & -62914561;
      0 < n;
    ) {
      var i = 31 - il(n),
        c = 1 << i,
        d = u[i];
      (d === -1
        ? ((c & e) === 0 || (c & a) !== 0) && (u[i] = Gh(c, l))
        : d <= l && (t.expiredLanes |= c),
        (n &= ~c));
    }
    if (
      ((l = Et),
      (e = ut),
      (e = Xu(
        t,
        t === l ? e : 0,
        t.cancelPendingCommit !== null || t.timeoutHandle !== -1,
      )),
      (a = t.callbackNode),
      e === 0 ||
        (t === l && (dt === 2 || dt === 9)) ||
        t.cancelPendingCommit !== null)
    )
      return (
        a !== null && a !== null && di(a),
        (t.callbackNode = null),
        (t.callbackPriority = 0)
      );
    if ((e & 3) === 0 || La(t, e)) {
      if (((l = e & -e), l === t.callbackPriority)) return l;
      switch ((a !== null && di(a), yi(e))) {
        case 2:
        case 8:
          e = Wc;
          break;
        case 32:
          e = ju;
          break;
        case 268435456:
          e = kc;
          break;
        default:
          e = ju;
      }
      return (
        (a = fd.bind(null, t)),
        (e = si(e, a)),
        (t.callbackPriority = l),
        (t.callbackNode = e),
        l
      );
    }
    return (
      a !== null && a !== null && di(a),
      (t.callbackPriority = 2),
      (t.callbackNode = null),
      2
    );
  }
  function fd(t, l) {
    if (Yt !== 0 && Yt !== 5)
      return ((t.callbackNode = null), (t.callbackPriority = 0), null);
    var e = t.callbackNode;
    if (qn() && t.callbackNode !== e) return null;
    var a = ut;
    return (
      (a = Xu(
        t,
        t === Et ? a : 0,
        t.cancelPendingCommit !== null || t.timeoutHandle !== -1,
      )),
      a === 0
        ? null
        : (Qs(t, a, l),
          id(t, ul()),
          t.callbackNode != null && t.callbackNode === e
            ? fd.bind(null, t)
            : null)
    );
  }
  function cd(t, l) {
    if (qn()) return null;
    Qs(t, l, !0);
  }
  function my() {
    Ry(function () {
      (rt & 6) !== 0 ? si($c, hy) : nd();
    });
  }
  function ec() {
    if (Te === 0) {
      var t = ma;
      (t === 0 && ((t = Yu), (Yu <<= 1), (Yu & 261888) === 0 && (Yu = 256)),
        (Te = t));
    }
    return Te;
  }
  function od(t) {
    return t == null || typeof t == "symbol" || typeof t == "boolean"
      ? null
      : typeof t == "function"
        ? t
        : Ku("" + t);
  }
  function rd(t, l) {
    var e = l.ownerDocument.createElement("input");
    return (
      (e.name = l.name),
      (e.value = l.value),
      t.id && e.setAttribute("form", t.id),
      l.parentNode.insertBefore(e, l),
      (t = new FormData(t)),
      e.parentNode.removeChild(e),
      t
    );
  }
  function yy(t, l, e, a, u) {
    if (l === "submit" && e && e.stateNode === u) {
      var n = od((u[Ft] || null).action),
        i = a.submitter;
      i &&
        ((l = (l = i[Ft] || null)
          ? od(l.formAction)
          : i.getAttribute("formAction")),
        l !== null && ((n = l), (i = null)));
      var c = new Wu("action", "action", null, a, u);
      t.push({
        event: c,
        listeners: [
          {
            instance: null,
            listener: function () {
              if (a.defaultPrevented) {
                if (Te !== 0) {
                  var d = i ? rd(u, i) : new FormData(u);
                  Tf(
                    e,
                    { pending: !0, data: d, method: u.method, action: n },
                    null,
                    d,
                  );
                }
              } else
                typeof n == "function" &&
                  (c.preventDefault(),
                  (d = i ? rd(u, i) : new FormData(u)),
                  Tf(
                    e,
                    { pending: !0, data: d, method: u.method, action: n },
                    n,
                    d,
                  ));
            },
            currentTarget: u,
          },
        ],
      });
    }
  }
  for (var ac = 0; ac < Yi.length; ac++) {
    var uc = Yi[ac],
      vy = uc.toLowerCase(),
      gy = uc[0].toUpperCase() + uc.slice(1);
    Ol(vy, "on" + gy);
  }
  (Ol(Xo, "onAnimationEnd"),
    Ol(Qo, "onAnimationIteration"),
    Ol(Zo, "onAnimationStart"),
    Ol("dblclick", "onDoubleClick"),
    Ol("focusin", "onFocus"),
    Ol("focusout", "onBlur"),
    Ol(xm, "onTransitionRun"),
    Ol(Hm, "onTransitionStart"),
    Ol(Bm, "onTransitionCancel"),
    Ol(Vo, "onTransitionEnd"),
    ta("onMouseEnter", ["mouseout", "mouseover"]),
    ta("onMouseLeave", ["mouseout", "mouseover"]),
    ta("onPointerEnter", ["pointerout", "pointerover"]),
    ta("onPointerLeave", ["pointerout", "pointerover"]),
    xe(
      "onChange",
      "change click focusin focusout input keydown keyup selectionchange".split(
        " ",
      ),
    ),
    xe(
      "onSelect",
      "focusout contextmenu dragend focusin keydown keyup mousedown mouseup selectionchange".split(
        " ",
      ),
    ),
    xe("onBeforeInput", ["compositionend", "keypress", "textInput", "paste"]),
    xe(
      "onCompositionEnd",
      "compositionend focusout keydown keypress keyup mousedown".split(" "),
    ),
    xe(
      "onCompositionStart",
      "compositionstart focusout keydown keypress keyup mousedown".split(" "),
    ),
    xe(
      "onCompositionUpdate",
      "compositionupdate focusout keydown keypress keyup mousedown".split(" "),
    ));
  var Eu =
      "abort canplay canplaythrough durationchange emptied encrypted ended error loadeddata loadedmetadata loadstart pause play playing progress ratechange resize seeked seeking stalled suspend timeupdate volumechange waiting".split(
        " ",
      ),
    py = new Set(
      "beforetoggle cancel close invalid load scroll scrollend toggle"
        .split(" ")
        .concat(Eu),
    );
  function sd(t, l) {
    l = (l & 4) !== 0;
    for (var e = 0; e < t.length; e++) {
      var a = t[e],
        u = a.event;
      a = a.listeners;
      t: {
        var n = void 0;
        if (l)
          for (var i = a.length - 1; 0 <= i; i--) {
            var c = a[i],
              d = c.instance,
              T = c.currentTarget;
            if (((c = c.listener), d !== n && u.isPropagationStopped()))
              break t;
            ((n = c), (u.currentTarget = T));
            try {
              n(u);
            } catch (R) {
              Iu(R);
            }
            ((u.currentTarget = null), (n = d));
          }
        else
          for (i = 0; i < a.length; i++) {
            if (
              ((c = a[i]),
              (d = c.instance),
              (T = c.currentTarget),
              (c = c.listener),
              d !== n && u.isPropagationStopped())
            )
              break t;
            ((n = c), (u.currentTarget = T));
            try {
              n(u);
            } catch (R) {
              Iu(R);
            }
            ((u.currentTarget = null), (n = d));
          }
      }
    }
  }
  function at(t, l) {
    var e = l[vi];
    e === void 0 && (e = l[vi] = new Set());
    var a = t + "__bubble";
    e.has(a) || (dd(l, t, 2, !1), e.add(a));
  }
  function nc(t, l, e) {
    var a = 0;
    (l && (a |= 4), dd(e, t, a, l));
  }
  var Ln = "_reactListening" + Math.random().toString(36).slice(2);
  function ic(t) {
    if (!t[Ln]) {
      ((t[Ln] = !0),
        uo.forEach(function (e) {
          e !== "selectionchange" && (py.has(e) || nc(e, !1, t), nc(e, !0, t));
        }));
      var l = t.nodeType === 9 ? t : t.ownerDocument;
      l === null || l[Ln] || ((l[Ln] = !0), nc("selectionchange", !1, l));
    }
  }
  function dd(t, l, e, a) {
    switch (Xd(l)) {
      case 2:
        var u = Jy;
        break;
      case 8:
        u = wy;
        break;
      default:
        u = Ec;
    }
    ((e = u.bind(null, l, e, t)),
      (u = void 0),
      !Ai ||
        (l !== "touchstart" && l !== "touchmove" && l !== "wheel") ||
        (u = !0),
      a
        ? u !== void 0
          ? t.addEventListener(l, e, { capture: !0, passive: u })
          : t.addEventListener(l, e, !0)
        : u !== void 0
          ? t.addEventListener(l, e, { passive: u })
          : t.addEventListener(l, e, !1));
  }
  function fc(t, l, e, a, u) {
    var n = a;
    if ((l & 1) === 0 && (l & 2) === 0 && a !== null)
      t: for (;;) {
        if (a === null) return;
        var i = a.tag;
        if (i === 3 || i === 4) {
          var c = a.stateNode.containerInfo;
          if (c === u) break;
          if (i === 4)
            for (i = a.return; i !== null; ) {
              var d = i.tag;
              if ((d === 3 || d === 4) && i.stateNode.containerInfo === u)
                return;
              i = i.return;
            }
          for (; c !== null; ) {
            if (((i = Fe(c)), i === null)) return;
            if (((d = i.tag), d === 5 || d === 6 || d === 26 || d === 27)) {
              a = n = i;
              continue t;
            }
            c = c.parentNode;
          }
        }
        a = a.return;
      }
    go(function () {
      var T = n,
        R = zi(e),
        N = [];
      t: {
        var z = Ko.get(t);
        if (z !== void 0) {
          var _ = Wu,
            L = t;
          switch (t) {
            case "keypress":
              if (wu(e) === 0) break t;
            case "keydown":
            case "keyup":
              _ = sm;
              break;
            case "focusin":
              ((L = "focus"), (_ = Di));
              break;
            case "focusout":
              ((L = "blur"), (_ = Di));
              break;
            case "beforeblur":
            case "afterblur":
              _ = Di;
              break;
            case "click":
              if (e.button === 2) break t;
            case "auxclick":
            case "dblclick":
            case "mousedown":
            case "mousemove":
            case "mouseup":
            case "mouseout":
            case "mouseover":
            case "contextmenu":
              _ = bo;
              break;
            case "drag":
            case "dragend":
            case "dragenter":
            case "dragexit":
            case "dragleave":
            case "dragover":
            case "dragstart":
            case "drop":
              _ = Ph;
              break;
            case "touchcancel":
            case "touchend":
            case "touchmove":
            case "touchstart":
              _ = mm;
              break;
            case Xo:
            case Qo:
            case Zo:
              _ = em;
              break;
            case Vo:
              _ = vm;
              break;
            case "scroll":
            case "scrollend":
              _ = Fh;
              break;
            case "wheel":
              _ = pm;
              break;
            case "copy":
            case "cut":
            case "paste":
              _ = um;
              break;
            case "gotpointercapture":
            case "lostpointercapture":
            case "pointercancel":
            case "pointerdown":
            case "pointermove":
            case "pointerout":
            case "pointerover":
            case "pointerup":
              _ = To;
              break;
            case "toggle":
            case "beforetoggle":
              _ = bm;
          }
          var J = (l & 4) !== 0,
            pt = !J && (t === "scroll" || t === "scrollend"),
            p = J ? (z !== null ? z + "Capture" : null) : z;
          J = [];
          for (var y = T, b; y !== null; ) {
            var C = y;
            if (
              ((b = C.stateNode),
              (C = C.tag),
              (C !== 5 && C !== 26 && C !== 27) ||
                b === null ||
                p === null ||
                ((C = Za(y, p)), C != null && J.push(Tu(y, C, b))),
              pt)
            )
              break;
            y = y.return;
          }
          0 < J.length &&
            ((z = new _(z, L, null, e, R)), N.push({ event: z, listeners: J }));
        }
      }
      if ((l & 7) === 0) {
        t: {
          if (
            ((z = t === "mouseover" || t === "pointerover"),
            (_ = t === "mouseout" || t === "pointerout"),
            z &&
              e !== Ti &&
              (L = e.relatedTarget || e.fromElement) &&
              (Fe(L) || L[ke]))
          )
            break t;
          if (
            (_ || z) &&
            ((z =
              R.window === R
                ? R
                : (z = R.ownerDocument)
                  ? z.defaultView || z.parentWindow
                  : window),
            _
              ? ((L = e.relatedTarget || e.toElement),
                (_ = T),
                (L = L ? Fe(L) : null),
                L !== null &&
                  ((pt = m(L)),
                  (J = L.tag),
                  L !== pt || (J !== 5 && J !== 27 && J !== 6)) &&
                  (L = null))
              : ((_ = null), (L = T)),
            _ !== L)
          ) {
            if (
              ((J = bo),
              (C = "onMouseLeave"),
              (p = "onMouseEnter"),
              (y = "mouse"),
              (t === "pointerout" || t === "pointerover") &&
                ((J = To),
                (C = "onPointerLeave"),
                (p = "onPointerEnter"),
                (y = "pointer")),
              (pt = _ == null ? z : Qa(_)),
              (b = L == null ? z : Qa(L)),
              (z = new J(C, y + "leave", _, e, R)),
              (z.target = pt),
              (z.relatedTarget = b),
              (C = null),
              Fe(R) === T &&
                ((J = new J(p, y + "enter", L, e, R)),
                (J.target = b),
                (J.relatedTarget = pt),
                (C = J)),
              (pt = C),
              _ && L)
            )
              l: {
                for (J = Sy, p = _, y = L, b = 0, C = p; C; C = J(C)) b++;
                C = 0;
                for (var K = y; K; K = J(K)) C++;
                for (; 0 < b - C; ) ((p = J(p)), b--);
                for (; 0 < C - b; ) ((y = J(y)), C--);
                for (; b--; ) {
                  if (p === y || (y !== null && p === y.alternate)) {
                    J = p;
                    break l;
                  }
                  ((p = J(p)), (y = J(y)));
                }
                J = null;
              }
            else J = null;
            (_ !== null && hd(N, z, _, J, !1),
              L !== null && pt !== null && hd(N, pt, L, J, !0));
          }
        }
        t: {
          if (
            ((z = T ? Qa(T) : window),
            (_ = z.nodeName && z.nodeName.toLowerCase()),
            _ === "select" || (_ === "input" && z.type === "file"))
          )
            var ct = Co;
          else if (Mo(z))
            if (Uo) ct = Cm;
            else {
              ct = Mm;
              var Q = Om;
            }
          else
            ((_ = z.nodeName),
              !_ ||
              _.toLowerCase() !== "input" ||
              (z.type !== "checkbox" && z.type !== "radio")
                ? T && Ei(T.elementType) && (ct = Co)
                : (ct = Dm));
          if (ct && (ct = ct(t, T))) {
            Do(N, ct, e, R);
            break t;
          }
          (Q && Q(t, z, T),
            t === "focusout" &&
              T &&
              z.type === "number" &&
              T.memoizedProps.value != null &&
              bi(z, "number", z.value));
        }
        switch (((Q = T ? Qa(T) : window), t)) {
          case "focusin":
            (Mo(Q) || Q.contentEditable === "true") &&
              ((ia = Q), (Bi = T), (Fa = null));
            break;
          case "focusout":
            Fa = Bi = ia = null;
            break;
          case "mousedown":
            qi = !0;
            break;
          case "contextmenu":
          case "mouseup":
          case "dragend":
            ((qi = !1), Lo(N, e, R));
            break;
          case "selectionchange":
            if (Nm) break;
          case "keydown":
          case "keyup":
            Lo(N, e, R);
        }
        var tt;
        if (Ui)
          t: {
            switch (t) {
              case "compositionstart":
                var nt = "onCompositionStart";
                break t;
              case "compositionend":
                nt = "onCompositionEnd";
                break t;
              case "compositionupdate":
                nt = "onCompositionUpdate";
                break t;
            }
            nt = void 0;
          }
        else
          na
            ? Ro(t, e) && (nt = "onCompositionEnd")
            : t === "keydown" &&
              e.keyCode === 229 &&
              (nt = "onCompositionStart");
        (nt &&
          (zo &&
            e.locale !== "ko" &&
            (na || nt !== "onCompositionStart"
              ? nt === "onCompositionEnd" && na && (tt = po())
              : ((ie = R),
                (Ri = "value" in ie ? ie.value : ie.textContent),
                (na = !0))),
          (Q = Gn(T, nt)),
          0 < Q.length &&
            ((nt = new Eo(nt, t, null, e, R)),
            N.push({ event: nt, listeners: Q }),
            tt
              ? (nt.data = tt)
              : ((tt = Oo(e)), tt !== null && (nt.data = tt)))),
          (tt = Tm ? zm(t, e) : _m(t, e)) &&
            ((nt = Gn(T, "onBeforeInput")),
            0 < nt.length &&
              ((Q = new Eo("onBeforeInput", "beforeinput", null, e, R)),
              N.push({ event: Q, listeners: nt }),
              (Q.data = tt))),
          yy(N, t, T, e, R));
      }
      sd(N, l);
    });
  }
  function Tu(t, l, e) {
    return { instance: t, listener: l, currentTarget: e };
  }
  function Gn(t, l) {
    for (var e = l + "Capture", a = []; t !== null; ) {
      var u = t,
        n = u.stateNode;
      if (
        ((u = u.tag),
        (u !== 5 && u !== 26 && u !== 27) ||
          n === null ||
          ((u = Za(t, e)),
          u != null && a.unshift(Tu(t, u, n)),
          (u = Za(t, l)),
          u != null && a.push(Tu(t, u, n))),
        t.tag === 3)
      )
        return a;
      t = t.return;
    }
    return [];
  }
  function Sy(t) {
    if (t === null) return null;
    do t = t.return;
    while (t && t.tag !== 5 && t.tag !== 27);
    return t || null;
  }
  function hd(t, l, e, a, u) {
    for (var n = l._reactName, i = []; e !== null && e !== a; ) {
      var c = e,
        d = c.alternate,
        T = c.stateNode;
      if (((c = c.tag), d !== null && d === a)) break;
      ((c !== 5 && c !== 26 && c !== 27) ||
        T === null ||
        ((d = T),
        u
          ? ((T = Za(e, n)), T != null && i.unshift(Tu(e, T, d)))
          : u || ((T = Za(e, n)), T != null && i.push(Tu(e, T, d)))),
        (e = e.return));
    }
    i.length !== 0 && t.push({ event: l, listeners: i });
  }
  var by = /\r\n?/g,
    Ey = /\u0000|\uFFFD/g;
  function md(t) {
    return (typeof t == "string" ? t : "" + t)
      .replace(
        by,
        `
`,
      )
      .replace(Ey, "");
  }
  function yd(t, l) {
    return ((l = md(l)), md(t) === l);
  }
  function gt(t, l, e, a, u, n) {
    switch (e) {
      case "children":
        typeof a == "string"
          ? l === "body" || (l === "textarea" && a === "") || ea(t, a)
          : (typeof a == "number" || typeof a == "bigint") &&
            l !== "body" &&
            ea(t, "" + a);
        break;
      case "className":
        Zu(t, "class", a);
        break;
      case "tabIndex":
        Zu(t, "tabindex", a);
        break;
      case "dir":
      case "role":
      case "viewBox":
      case "width":
      case "height":
        Zu(t, e, a);
        break;
      case "style":
        yo(t, a, n);
        break;
      case "data":
        if (l !== "object") {
          Zu(t, "data", a);
          break;
        }
      case "src":
      case "href":
        if (a === "" && (l !== "a" || e !== "href")) {
          t.removeAttribute(e);
          break;
        }
        if (
          a == null ||
          typeof a == "function" ||
          typeof a == "symbol" ||
          typeof a == "boolean"
        ) {
          t.removeAttribute(e);
          break;
        }
        ((a = Ku("" + a)), t.setAttribute(e, a));
        break;
      case "action":
      case "formAction":
        if (typeof a == "function") {
          t.setAttribute(
            e,
            "javascript:throw new Error('A React form was unexpectedly submitted. If you called form.submit() manually, consider using form.requestSubmit() instead. If you\\'re trying to use event.stopPropagation() in a submit event handler, consider also calling event.preventDefault().')",
          );
          break;
        } else
          typeof n == "function" &&
            (e === "formAction"
              ? (l !== "input" && gt(t, l, "name", u.name, u, null),
                gt(t, l, "formEncType", u.formEncType, u, null),
                gt(t, l, "formMethod", u.formMethod, u, null),
                gt(t, l, "formTarget", u.formTarget, u, null))
              : (gt(t, l, "encType", u.encType, u, null),
                gt(t, l, "method", u.method, u, null),
                gt(t, l, "target", u.target, u, null)));
        if (a == null || typeof a == "symbol" || typeof a == "boolean") {
          t.removeAttribute(e);
          break;
        }
        ((a = Ku("" + a)), t.setAttribute(e, a));
        break;
      case "onClick":
        a != null && (t.onclick = Ll);
        break;
      case "onScroll":
        a != null && at("scroll", t);
        break;
      case "onScrollEnd":
        a != null && at("scrollend", t);
        break;
      case "dangerouslySetInnerHTML":
        if (a != null) {
          if (typeof a != "object" || !("__html" in a)) throw Error(o(61));
          if (((e = a.__html), e != null)) {
            if (u.children != null) throw Error(o(60));
            t.innerHTML = e;
          }
        }
        break;
      case "multiple":
        t.multiple = a && typeof a != "function" && typeof a != "symbol";
        break;
      case "muted":
        t.muted = a && typeof a != "function" && typeof a != "symbol";
        break;
      case "suppressContentEditableWarning":
      case "suppressHydrationWarning":
      case "defaultValue":
      case "defaultChecked":
      case "innerHTML":
      case "ref":
        break;
      case "autoFocus":
        break;
      case "xlinkHref":
        if (
          a == null ||
          typeof a == "function" ||
          typeof a == "boolean" ||
          typeof a == "symbol"
        ) {
          t.removeAttribute("xlink:href");
          break;
        }
        ((e = Ku("" + a)),
          t.setAttributeNS("http://www.w3.org/1999/xlink", "xlink:href", e));
        break;
      case "contentEditable":
      case "spellCheck":
      case "draggable":
      case "value":
      case "autoReverse":
      case "externalResourcesRequired":
      case "focusable":
      case "preserveAlpha":
        a != null && typeof a != "function" && typeof a != "symbol"
          ? t.setAttribute(e, "" + a)
          : t.removeAttribute(e);
        break;
      case "inert":
      case "allowFullScreen":
      case "async":
      case "autoPlay":
      case "controls":
      case "default":
      case "defer":
      case "disabled":
      case "disablePictureInPicture":
      case "disableRemotePlayback":
      case "formNoValidate":
      case "hidden":
      case "loop":
      case "noModule":
      case "noValidate":
      case "open":
      case "playsInline":
      case "readOnly":
      case "required":
      case "reversed":
      case "scoped":
      case "seamless":
      case "itemScope":
        a && typeof a != "function" && typeof a != "symbol"
          ? t.setAttribute(e, "")
          : t.removeAttribute(e);
        break;
      case "capture":
      case "download":
        a === !0
          ? t.setAttribute(e, "")
          : a !== !1 &&
              a != null &&
              typeof a != "function" &&
              typeof a != "symbol"
            ? t.setAttribute(e, a)
            : t.removeAttribute(e);
        break;
      case "cols":
      case "rows":
      case "size":
      case "span":
        a != null &&
        typeof a != "function" &&
        typeof a != "symbol" &&
        !isNaN(a) &&
        1 <= a
          ? t.setAttribute(e, a)
          : t.removeAttribute(e);
        break;
      case "rowSpan":
      case "start":
        a == null || typeof a == "function" || typeof a == "symbol" || isNaN(a)
          ? t.removeAttribute(e)
          : t.setAttribute(e, a);
        break;
      case "popover":
        (at("beforetoggle", t), at("toggle", t), Qu(t, "popover", a));
        break;
      case "xlinkActuate":
        Yl(t, "http://www.w3.org/1999/xlink", "xlink:actuate", a);
        break;
      case "xlinkArcrole":
        Yl(t, "http://www.w3.org/1999/xlink", "xlink:arcrole", a);
        break;
      case "xlinkRole":
        Yl(t, "http://www.w3.org/1999/xlink", "xlink:role", a);
        break;
      case "xlinkShow":
        Yl(t, "http://www.w3.org/1999/xlink", "xlink:show", a);
        break;
      case "xlinkTitle":
        Yl(t, "http://www.w3.org/1999/xlink", "xlink:title", a);
        break;
      case "xlinkType":
        Yl(t, "http://www.w3.org/1999/xlink", "xlink:type", a);
        break;
      case "xmlBase":
        Yl(t, "http://www.w3.org/XML/1998/namespace", "xml:base", a);
        break;
      case "xmlLang":
        Yl(t, "http://www.w3.org/XML/1998/namespace", "xml:lang", a);
        break;
      case "xmlSpace":
        Yl(t, "http://www.w3.org/XML/1998/namespace", "xml:space", a);
        break;
      case "is":
        Qu(t, "is", a);
        break;
      case "innerText":
      case "textContent":
        break;
      default:
        (!(2 < e.length) ||
          (e[0] !== "o" && e[0] !== "O") ||
          (e[1] !== "n" && e[1] !== "N")) &&
          ((e = Wh.get(e) || e), Qu(t, e, a));
    }
  }
  function cc(t, l, e, a, u, n) {
    switch (e) {
      case "style":
        yo(t, a, n);
        break;
      case "dangerouslySetInnerHTML":
        if (a != null) {
          if (typeof a != "object" || !("__html" in a)) throw Error(o(61));
          if (((e = a.__html), e != null)) {
            if (u.children != null) throw Error(o(60));
            t.innerHTML = e;
          }
        }
        break;
      case "children":
        typeof a == "string"
          ? ea(t, a)
          : (typeof a == "number" || typeof a == "bigint") && ea(t, "" + a);
        break;
      case "onScroll":
        a != null && at("scroll", t);
        break;
      case "onScrollEnd":
        a != null && at("scrollend", t);
        break;
      case "onClick":
        a != null && (t.onclick = Ll);
        break;
      case "suppressContentEditableWarning":
      case "suppressHydrationWarning":
      case "innerHTML":
      case "ref":
        break;
      case "innerText":
      case "textContent":
        break;
      default:
        if (!no.hasOwnProperty(e))
          t: {
            if (
              e[0] === "o" &&
              e[1] === "n" &&
              ((u = e.endsWith("Capture")),
              (l = e.slice(2, u ? e.length - 7 : void 0)),
              (n = t[Ft] || null),
              (n = n != null ? n[e] : null),
              typeof n == "function" && t.removeEventListener(l, n, u),
              typeof a == "function")
            ) {
              (typeof n != "function" &&
                n !== null &&
                (e in t
                  ? (t[e] = null)
                  : t.hasAttribute(e) && t.removeAttribute(e)),
                t.addEventListener(l, a, u));
              break t;
            }
            e in t
              ? (t[e] = a)
              : a === !0
                ? t.setAttribute(e, "")
                : Qu(t, e, a);
          }
    }
  }
  function Jt(t, l, e) {
    switch (l) {
      case "div":
      case "span":
      case "svg":
      case "path":
      case "a":
      case "g":
      case "p":
      case "li":
        break;
      case "img":
        (at("error", t), at("load", t));
        var a = !1,
          u = !1,
          n;
        for (n in e)
          if (e.hasOwnProperty(n)) {
            var i = e[n];
            if (i != null)
              switch (n) {
                case "src":
                  a = !0;
                  break;
                case "srcSet":
                  u = !0;
                  break;
                case "children":
                case "dangerouslySetInnerHTML":
                  throw Error(o(137, l));
                default:
                  gt(t, l, n, i, e, null);
              }
          }
        (u && gt(t, l, "srcSet", e.srcSet, e, null),
          a && gt(t, l, "src", e.src, e, null));
        return;
      case "input":
        at("invalid", t);
        var c = (n = i = u = null),
          d = null,
          T = null;
        for (a in e)
          if (e.hasOwnProperty(a)) {
            var R = e[a];
            if (R != null)
              switch (a) {
                case "name":
                  u = R;
                  break;
                case "type":
                  i = R;
                  break;
                case "checked":
                  d = R;
                  break;
                case "defaultChecked":
                  T = R;
                  break;
                case "value":
                  n = R;
                  break;
                case "defaultValue":
                  c = R;
                  break;
                case "children":
                case "dangerouslySetInnerHTML":
                  if (R != null) throw Error(o(137, l));
                  break;
                default:
                  gt(t, l, a, R, e, null);
              }
          }
        ro(t, n, c, d, T, i, u, !1);
        return;
      case "select":
        (at("invalid", t), (a = i = n = null));
        for (u in e)
          if (e.hasOwnProperty(u) && ((c = e[u]), c != null))
            switch (u) {
              case "value":
                n = c;
                break;
              case "defaultValue":
                i = c;
                break;
              case "multiple":
                a = c;
              default:
                gt(t, l, u, c, e, null);
            }
        ((l = n),
          (e = i),
          (t.multiple = !!a),
          l != null ? la(t, !!a, l, !1) : e != null && la(t, !!a, e, !0));
        return;
      case "textarea":
        (at("invalid", t), (n = u = a = null));
        for (i in e)
          if (e.hasOwnProperty(i) && ((c = e[i]), c != null))
            switch (i) {
              case "value":
                a = c;
                break;
              case "defaultValue":
                u = c;
                break;
              case "children":
                n = c;
                break;
              case "dangerouslySetInnerHTML":
                if (c != null) throw Error(o(91));
                break;
              default:
                gt(t, l, i, c, e, null);
            }
        ho(t, a, u, n);
        return;
      case "option":
        for (d in e)
          if (e.hasOwnProperty(d) && ((a = e[d]), a != null))
            switch (d) {
              case "selected":
                t.selected =
                  a && typeof a != "function" && typeof a != "symbol";
                break;
              default:
                gt(t, l, d, a, e, null);
            }
        return;
      case "dialog":
        (at("beforetoggle", t),
          at("toggle", t),
          at("cancel", t),
          at("close", t));
        break;
      case "iframe":
      case "object":
        at("load", t);
        break;
      case "video":
      case "audio":
        for (a = 0; a < Eu.length; a++) at(Eu[a], t);
        break;
      case "image":
        (at("error", t), at("load", t));
        break;
      case "details":
        at("toggle", t);
        break;
      case "embed":
      case "source":
      case "link":
        (at("error", t), at("load", t));
      case "area":
      case "base":
      case "br":
      case "col":
      case "hr":
      case "keygen":
      case "meta":
      case "param":
      case "track":
      case "wbr":
      case "menuitem":
        for (T in e)
          if (e.hasOwnProperty(T) && ((a = e[T]), a != null))
            switch (T) {
              case "children":
              case "dangerouslySetInnerHTML":
                throw Error(o(137, l));
              default:
                gt(t, l, T, a, e, null);
            }
        return;
      default:
        if (Ei(l)) {
          for (R in e)
            e.hasOwnProperty(R) &&
              ((a = e[R]), a !== void 0 && cc(t, l, R, a, e, void 0));
          return;
        }
    }
    for (c in e)
      e.hasOwnProperty(c) && ((a = e[c]), a != null && gt(t, l, c, a, e, null));
  }
  function Ty(t, l, e, a) {
    switch (l) {
      case "div":
      case "span":
      case "svg":
      case "path":
      case "a":
      case "g":
      case "p":
      case "li":
        break;
      case "input":
        var u = null,
          n = null,
          i = null,
          c = null,
          d = null,
          T = null,
          R = null;
        for (_ in e) {
          var N = e[_];
          if (e.hasOwnProperty(_) && N != null)
            switch (_) {
              case "checked":
                break;
              case "value":
                break;
              case "defaultValue":
                d = N;
              default:
                a.hasOwnProperty(_) || gt(t, l, _, null, a, N);
            }
        }
        for (var z in a) {
          var _ = a[z];
          if (((N = e[z]), a.hasOwnProperty(z) && (_ != null || N != null)))
            switch (z) {
              case "type":
                n = _;
                break;
              case "name":
                u = _;
                break;
              case "checked":
                T = _;
                break;
              case "defaultChecked":
                R = _;
                break;
              case "value":
                i = _;
                break;
              case "defaultValue":
                c = _;
                break;
              case "children":
              case "dangerouslySetInnerHTML":
                if (_ != null) throw Error(o(137, l));
                break;
              default:
                _ !== N && gt(t, l, z, _, a, N);
            }
        }
        Si(t, i, c, d, T, R, n, u);
        return;
      case "select":
        _ = i = c = z = null;
        for (n in e)
          if (((d = e[n]), e.hasOwnProperty(n) && d != null))
            switch (n) {
              case "value":
                break;
              case "multiple":
                _ = d;
              default:
                a.hasOwnProperty(n) || gt(t, l, n, null, a, d);
            }
        for (u in a)
          if (
            ((n = a[u]),
            (d = e[u]),
            a.hasOwnProperty(u) && (n != null || d != null))
          )
            switch (u) {
              case "value":
                z = n;
                break;
              case "defaultValue":
                c = n;
                break;
              case "multiple":
                i = n;
              default:
                n !== d && gt(t, l, u, n, a, d);
            }
        ((l = c),
          (e = i),
          (a = _),
          z != null
            ? la(t, !!e, z, !1)
            : !!a != !!e &&
              (l != null ? la(t, !!e, l, !0) : la(t, !!e, e ? [] : "", !1)));
        return;
      case "textarea":
        _ = z = null;
        for (c in e)
          if (
            ((u = e[c]),
            e.hasOwnProperty(c) && u != null && !a.hasOwnProperty(c))
          )
            switch (c) {
              case "value":
                break;
              case "children":
                break;
              default:
                gt(t, l, c, null, a, u);
            }
        for (i in a)
          if (
            ((u = a[i]),
            (n = e[i]),
            a.hasOwnProperty(i) && (u != null || n != null))
          )
            switch (i) {
              case "value":
                z = u;
                break;
              case "defaultValue":
                _ = u;
                break;
              case "children":
                break;
              case "dangerouslySetInnerHTML":
                if (u != null) throw Error(o(91));
                break;
              default:
                u !== n && gt(t, l, i, u, a, n);
            }
        so(t, z, _);
        return;
      case "option":
        for (var L in e)
          if (
            ((z = e[L]),
            e.hasOwnProperty(L) && z != null && !a.hasOwnProperty(L))
          )
            switch (L) {
              case "selected":
                t.selected = !1;
                break;
              default:
                gt(t, l, L, null, a, z);
            }
        for (d in a)
          if (
            ((z = a[d]),
            (_ = e[d]),
            a.hasOwnProperty(d) && z !== _ && (z != null || _ != null))
          )
            switch (d) {
              case "selected":
                t.selected =
                  z && typeof z != "function" && typeof z != "symbol";
                break;
              default:
                gt(t, l, d, z, a, _);
            }
        return;
      case "img":
      case "link":
      case "area":
      case "base":
      case "br":
      case "col":
      case "embed":
      case "hr":
      case "keygen":
      case "meta":
      case "param":
      case "source":
      case "track":
      case "wbr":
      case "menuitem":
        for (var J in e)
          ((z = e[J]),
            e.hasOwnProperty(J) &&
              z != null &&
              !a.hasOwnProperty(J) &&
              gt(t, l, J, null, a, z));
        for (T in a)
          if (
            ((z = a[T]),
            (_ = e[T]),
            a.hasOwnProperty(T) && z !== _ && (z != null || _ != null))
          )
            switch (T) {
              case "children":
              case "dangerouslySetInnerHTML":
                if (z != null) throw Error(o(137, l));
                break;
              default:
                gt(t, l, T, z, a, _);
            }
        return;
      default:
        if (Ei(l)) {
          for (var pt in e)
            ((z = e[pt]),
              e.hasOwnProperty(pt) &&
                z !== void 0 &&
                !a.hasOwnProperty(pt) &&
                cc(t, l, pt, void 0, a, z));
          for (R in a)
            ((z = a[R]),
              (_ = e[R]),
              !a.hasOwnProperty(R) ||
                z === _ ||
                (z === void 0 && _ === void 0) ||
                cc(t, l, R, z, a, _));
          return;
        }
    }
    for (var p in e)
      ((z = e[p]),
        e.hasOwnProperty(p) &&
          z != null &&
          !a.hasOwnProperty(p) &&
          gt(t, l, p, null, a, z));
    for (N in a)
      ((z = a[N]),
        (_ = e[N]),
        !a.hasOwnProperty(N) ||
          z === _ ||
          (z == null && _ == null) ||
          gt(t, l, N, z, a, _));
  }
  function vd(t) {
    switch (t) {
      case "css":
      case "script":
      case "font":
      case "img":
      case "image":
      case "input":
      case "link":
        return !0;
      default:
        return !1;
    }
  }
  function zy() {
    if (typeof performance.getEntriesByType == "function") {
      for (
        var t = 0, l = 0, e = performance.getEntriesByType("resource"), a = 0;
        a < e.length;
        a++
      ) {
        var u = e[a],
          n = u.transferSize,
          i = u.initiatorType,
          c = u.duration;
        if (n && c && vd(i)) {
          for (i = 0, c = u.responseEnd, a += 1; a < e.length; a++) {
            var d = e[a],
              T = d.startTime;
            if (T > c) break;
            var R = d.transferSize,
              N = d.initiatorType;
            R &&
              vd(N) &&
              ((d = d.responseEnd), (i += R * (d < c ? 1 : (c - T) / (d - T))));
          }
          if ((--a, (l += (8 * (n + i)) / (u.duration / 1e3)), t++, 10 < t))
            break;
        }
      }
      if (0 < t) return l / t / 1e6;
    }
    return navigator.connection &&
      ((t = navigator.connection.downlink), typeof t == "number")
      ? t
      : 5;
  }
  var oc = null,
    rc = null;
  function Xn(t) {
    return t.nodeType === 9 ? t : t.ownerDocument;
  }
  function gd(t) {
    switch (t) {
      case "http://www.w3.org/2000/svg":
        return 1;
      case "http://www.w3.org/1998/Math/MathML":
        return 2;
      default:
        return 0;
    }
  }
  function pd(t, l) {
    if (t === 0)
      switch (l) {
        case "svg":
          return 1;
        case "math":
          return 2;
        default:
          return 0;
      }
    return t === 1 && l === "foreignObject" ? 0 : t;
  }
  function sc(t, l) {
    return (
      t === "textarea" ||
      t === "noscript" ||
      typeof l.children == "string" ||
      typeof l.children == "number" ||
      typeof l.children == "bigint" ||
      (typeof l.dangerouslySetInnerHTML == "object" &&
        l.dangerouslySetInnerHTML !== null &&
        l.dangerouslySetInnerHTML.__html != null)
    );
  }
  var dc = null;
  function _y() {
    var t = window.event;
    return t && t.type === "popstate"
      ? t === dc
        ? !1
        : ((dc = t), !0)
      : ((dc = null), !1);
  }
  var Sd = typeof setTimeout == "function" ? setTimeout : void 0,
    Ay = typeof clearTimeout == "function" ? clearTimeout : void 0,
    bd = typeof Promise == "function" ? Promise : void 0,
    Ry =
      typeof queueMicrotask == "function"
        ? queueMicrotask
        : typeof bd < "u"
          ? function (t) {
              return bd.resolve(null).then(t).catch(Oy);
            }
          : Sd;
  function Oy(t) {
    setTimeout(function () {
      throw t;
    });
  }
  function ze(t) {
    return t === "head";
  }
  function Ed(t, l) {
    var e = l,
      a = 0;
    do {
      var u = e.nextSibling;
      if ((t.removeChild(e), u && u.nodeType === 8))
        if (((e = u.data), e === "/$" || e === "/&")) {
          if (a === 0) {
            (t.removeChild(u), xa(l));
            return;
          }
          a--;
        } else if (
          e === "$" ||
          e === "$?" ||
          e === "$~" ||
          e === "$!" ||
          e === "&"
        )
          a++;
        else if (e === "html") zu(t.ownerDocument.documentElement);
        else if (e === "head") {
          ((e = t.ownerDocument.head), zu(e));
          for (var n = e.firstChild; n; ) {
            var i = n.nextSibling,
              c = n.nodeName;
            (n[Xa] ||
              c === "SCRIPT" ||
              c === "STYLE" ||
              (c === "LINK" && n.rel.toLowerCase() === "stylesheet") ||
              e.removeChild(n),
              (n = i));
          }
        } else e === "body" && zu(t.ownerDocument.body);
      e = u;
    } while (e);
    xa(l);
  }
  function Td(t, l) {
    var e = t;
    t = 0;
    do {
      var a = e.nextSibling;
      if (
        (e.nodeType === 1
          ? l
            ? ((e._stashedDisplay = e.style.display),
              (e.style.display = "none"))
            : ((e.style.display = e._stashedDisplay || ""),
              e.getAttribute("style") === "" && e.removeAttribute("style"))
          : e.nodeType === 3 &&
            (l
              ? ((e._stashedText = e.nodeValue), (e.nodeValue = ""))
              : (e.nodeValue = e._stashedText || "")),
        a && a.nodeType === 8)
      )
        if (((e = a.data), e === "/$")) {
          if (t === 0) break;
          t--;
        } else (e !== "$" && e !== "$?" && e !== "$~" && e !== "$!") || t++;
      e = a;
    } while (e);
  }
  function hc(t) {
    var l = t.firstChild;
    for (l && l.nodeType === 10 && (l = l.nextSibling); l; ) {
      var e = l;
      switch (((l = l.nextSibling), e.nodeName)) {
        case "HTML":
        case "HEAD":
        case "BODY":
          (hc(e), gi(e));
          continue;
        case "SCRIPT":
        case "STYLE":
          continue;
        case "LINK":
          if (e.rel.toLowerCase() === "stylesheet") continue;
      }
      t.removeChild(e);
    }
  }
  function My(t, l, e, a) {
    for (; t.nodeType === 1; ) {
      var u = e;
      if (t.nodeName.toLowerCase() !== l.toLowerCase()) {
        if (!a && (t.nodeName !== "INPUT" || t.type !== "hidden")) break;
      } else if (a) {
        if (!t[Xa])
          switch (l) {
            case "meta":
              if (!t.hasAttribute("itemprop")) break;
              return t;
            case "link":
              if (
                ((n = t.getAttribute("rel")),
                n === "stylesheet" && t.hasAttribute("data-precedence"))
              )
                break;
              if (
                n !== u.rel ||
                t.getAttribute("href") !==
                  (u.href == null || u.href === "" ? null : u.href) ||
                t.getAttribute("crossorigin") !==
                  (u.crossOrigin == null ? null : u.crossOrigin) ||
                t.getAttribute("title") !== (u.title == null ? null : u.title)
              )
                break;
              return t;
            case "style":
              if (t.hasAttribute("data-precedence")) break;
              return t;
            case "script":
              if (
                ((n = t.getAttribute("src")),
                (n !== (u.src == null ? null : u.src) ||
                  t.getAttribute("type") !== (u.type == null ? null : u.type) ||
                  t.getAttribute("crossorigin") !==
                    (u.crossOrigin == null ? null : u.crossOrigin)) &&
                  n &&
                  t.hasAttribute("async") &&
                  !t.hasAttribute("itemprop"))
              )
                break;
              return t;
            default:
              return t;
          }
      } else if (l === "input" && t.type === "hidden") {
        var n = u.name == null ? null : "" + u.name;
        if (u.type === "hidden" && t.getAttribute("name") === n) return t;
      } else return t;
      if (((t = _l(t.nextSibling)), t === null)) break;
    }
    return null;
  }
  function Dy(t, l, e) {
    if (l === "") return null;
    for (; t.nodeType !== 3; )
      if (
        ((t.nodeType !== 1 || t.nodeName !== "INPUT" || t.type !== "hidden") &&
          !e) ||
        ((t = _l(t.nextSibling)), t === null)
      )
        return null;
    return t;
  }
  function zd(t, l) {
    for (; t.nodeType !== 8; )
      if (
        ((t.nodeType !== 1 || t.nodeName !== "INPUT" || t.type !== "hidden") &&
          !l) ||
        ((t = _l(t.nextSibling)), t === null)
      )
        return null;
    return t;
  }
  function mc(t) {
    return t.data === "$?" || t.data === "$~";
  }
  function yc(t) {
    return (
      t.data === "$!" ||
      (t.data === "$?" && t.ownerDocument.readyState !== "loading")
    );
  }
  function Cy(t, l) {
    var e = t.ownerDocument;
    if (t.data === "$~") t._reactRetry = l;
    else if (t.data !== "$?" || e.readyState !== "loading") l();
    else {
      var a = function () {
        (l(), e.removeEventListener("DOMContentLoaded", a));
      };
      (e.addEventListener("DOMContentLoaded", a), (t._reactRetry = a));
    }
  }
  function _l(t) {
    for (; t != null; t = t.nextSibling) {
      var l = t.nodeType;
      if (l === 1 || l === 3) break;
      if (l === 8) {
        if (
          ((l = t.data),
          l === "$" ||
            l === "$!" ||
            l === "$?" ||
            l === "$~" ||
            l === "&" ||
            l === "F!" ||
            l === "F")
        )
          break;
        if (l === "/$" || l === "/&") return null;
      }
    }
    return t;
  }
  var vc = null;
  function _d(t) {
    t = t.nextSibling;
    for (var l = 0; t; ) {
      if (t.nodeType === 8) {
        var e = t.data;
        if (e === "/$" || e === "/&") {
          if (l === 0) return _l(t.nextSibling);
          l--;
        } else
          (e !== "$" && e !== "$!" && e !== "$?" && e !== "$~" && e !== "&") ||
            l++;
      }
      t = t.nextSibling;
    }
    return null;
  }
  function Ad(t) {
    t = t.previousSibling;
    for (var l = 0; t; ) {
      if (t.nodeType === 8) {
        var e = t.data;
        if (e === "$" || e === "$!" || e === "$?" || e === "$~" || e === "&") {
          if (l === 0) return t;
          l--;
        } else (e !== "/$" && e !== "/&") || l++;
      }
      t = t.previousSibling;
    }
    return null;
  }
  function Rd(t, l, e) {
    switch (((l = Xn(e)), t)) {
      case "html":
        if (((t = l.documentElement), !t)) throw Error(o(452));
        return t;
      case "head":
        if (((t = l.head), !t)) throw Error(o(453));
        return t;
      case "body":
        if (((t = l.body), !t)) throw Error(o(454));
        return t;
      default:
        throw Error(o(451));
    }
  }
  function zu(t) {
    for (var l = t.attributes; l.length; ) t.removeAttributeNode(l[0]);
    gi(t);
  }
  var Al = new Map(),
    Od = new Set();
  function Qn(t) {
    return typeof t.getRootNode == "function"
      ? t.getRootNode()
      : t.nodeType === 9
        ? t
        : t.ownerDocument;
  }
  var le = B.d;
  B.d = { f: Uy, r: Ny, D: xy, C: Hy, L: By, m: qy, X: Yy, S: jy, M: Ly };
  function Uy() {
    var t = le.f(),
      l = xn();
    return t || l;
  }
  function Ny(t) {
    var l = Ie(t);
    l !== null && l.tag === 5 && l.type === "form" ? Vr(l) : le.r(t);
  }
  var Ca = typeof document > "u" ? null : document;
  function Md(t, l, e) {
    var a = Ca;
    if (a && typeof l == "string" && l) {
      var u = gl(l);
      ((u = 'link[rel="' + t + '"][href="' + u + '"]'),
        typeof e == "string" && (u += '[crossorigin="' + e + '"]'),
        Od.has(u) ||
          (Od.add(u),
          (t = { rel: t, crossOrigin: e, href: l }),
          a.querySelector(u) === null &&
            ((l = a.createElement("link")),
            Jt(l, "link", t),
            Lt(l),
            a.head.appendChild(l))));
    }
  }
  function xy(t) {
    (le.D(t), Md("dns-prefetch", t, null));
  }
  function Hy(t, l) {
    (le.C(t, l), Md("preconnect", t, l));
  }
  function By(t, l, e) {
    le.L(t, l, e);
    var a = Ca;
    if (a && t && l) {
      var u = 'link[rel="preload"][as="' + gl(l) + '"]';
      l === "image" && e && e.imageSrcSet
        ? ((u += '[imagesrcset="' + gl(e.imageSrcSet) + '"]'),
          typeof e.imageSizes == "string" &&
            (u += '[imagesizes="' + gl(e.imageSizes) + '"]'))
        : (u += '[href="' + gl(t) + '"]');
      var n = u;
      switch (l) {
        case "style":
          n = Ua(t);
          break;
        case "script":
          n = Na(t);
      }
      Al.has(n) ||
        ((t = A(
          {
            rel: "preload",
            href: l === "image" && e && e.imageSrcSet ? void 0 : t,
            as: l,
          },
          e,
        )),
        Al.set(n, t),
        a.querySelector(u) !== null ||
          (l === "style" && a.querySelector(_u(n))) ||
          (l === "script" && a.querySelector(Au(n))) ||
          ((l = a.createElement("link")),
          Jt(l, "link", t),
          Lt(l),
          a.head.appendChild(l)));
    }
  }
  function qy(t, l) {
    le.m(t, l);
    var e = Ca;
    if (e && t) {
      var a = l && typeof l.as == "string" ? l.as : "script",
        u =
          'link[rel="modulepreload"][as="' + gl(a) + '"][href="' + gl(t) + '"]',
        n = u;
      switch (a) {
        case "audioworklet":
        case "paintworklet":
        case "serviceworker":
        case "sharedworker":
        case "worker":
        case "script":
          n = Na(t);
      }
      if (
        !Al.has(n) &&
        ((t = A({ rel: "modulepreload", href: t }, l)),
        Al.set(n, t),
        e.querySelector(u) === null)
      ) {
        switch (a) {
          case "audioworklet":
          case "paintworklet":
          case "serviceworker":
          case "sharedworker":
          case "worker":
          case "script":
            if (e.querySelector(Au(n))) return;
        }
        ((a = e.createElement("link")),
          Jt(a, "link", t),
          Lt(a),
          e.head.appendChild(a));
      }
    }
  }
  function jy(t, l, e) {
    le.S(t, l, e);
    var a = Ca;
    if (a && t) {
      var u = Pe(a).hoistableStyles,
        n = Ua(t);
      l = l || "default";
      var i = u.get(n);
      if (!i) {
        var c = { loading: 0, preload: null };
        if ((i = a.querySelector(_u(n)))) c.loading = 5;
        else {
          ((t = A({ rel: "stylesheet", href: t, "data-precedence": l }, e)),
            (e = Al.get(n)) && gc(t, e));
          var d = (i = a.createElement("link"));
          (Lt(d),
            Jt(d, "link", t),
            (d._p = new Promise(function (T, R) {
              ((d.onload = T), (d.onerror = R));
            })),
            d.addEventListener("load", function () {
              c.loading |= 1;
            }),
            d.addEventListener("error", function () {
              c.loading |= 2;
            }),
            (c.loading |= 4),
            Zn(i, l, a));
        }
        ((i = { type: "stylesheet", instance: i, count: 1, state: c }),
          u.set(n, i));
      }
    }
  }
  function Yy(t, l) {
    le.X(t, l);
    var e = Ca;
    if (e && t) {
      var a = Pe(e).hoistableScripts,
        u = Na(t),
        n = a.get(u);
      n ||
        ((n = e.querySelector(Au(u))),
        n ||
          ((t = A({ src: t, async: !0 }, l)),
          (l = Al.get(u)) && pc(t, l),
          (n = e.createElement("script")),
          Lt(n),
          Jt(n, "link", t),
          e.head.appendChild(n)),
        (n = { type: "script", instance: n, count: 1, state: null }),
        a.set(u, n));
    }
  }
  function Ly(t, l) {
    le.M(t, l);
    var e = Ca;
    if (e && t) {
      var a = Pe(e).hoistableScripts,
        u = Na(t),
        n = a.get(u);
      n ||
        ((n = e.querySelector(Au(u))),
        n ||
          ((t = A({ src: t, async: !0, type: "module" }, l)),
          (l = Al.get(u)) && pc(t, l),
          (n = e.createElement("script")),
          Lt(n),
          Jt(n, "link", t),
          e.head.appendChild(n)),
        (n = { type: "script", instance: n, count: 1, state: null }),
        a.set(u, n));
    }
  }
  function Dd(t, l, e, a) {
    var u = (u = lt.current) ? Qn(u) : null;
    if (!u) throw Error(o(446));
    switch (t) {
      case "meta":
      case "title":
        return null;
      case "style":
        return typeof e.precedence == "string" && typeof e.href == "string"
          ? ((l = Ua(e.href)),
            (e = Pe(u).hoistableStyles),
            (a = e.get(l)),
            a ||
              ((a = { type: "style", instance: null, count: 0, state: null }),
              e.set(l, a)),
            a)
          : { type: "void", instance: null, count: 0, state: null };
      case "link":
        if (
          e.rel === "stylesheet" &&
          typeof e.href == "string" &&
          typeof e.precedence == "string"
        ) {
          t = Ua(e.href);
          var n = Pe(u).hoistableStyles,
            i = n.get(t);
          if (
            (i ||
              ((u = u.ownerDocument || u),
              (i = {
                type: "stylesheet",
                instance: null,
                count: 0,
                state: { loading: 0, preload: null },
              }),
              n.set(t, i),
              (n = u.querySelector(_u(t))) &&
                !n._p &&
                ((i.instance = n), (i.state.loading = 5)),
              Al.has(t) ||
                ((e = {
                  rel: "preload",
                  as: "style",
                  href: e.href,
                  crossOrigin: e.crossOrigin,
                  integrity: e.integrity,
                  media: e.media,
                  hrefLang: e.hrefLang,
                  referrerPolicy: e.referrerPolicy,
                }),
                Al.set(t, e),
                n || Gy(u, t, e, i.state))),
            l && a === null)
          )
            throw Error(o(528, ""));
          return i;
        }
        if (l && a !== null) throw Error(o(529, ""));
        return null;
      case "script":
        return (
          (l = e.async),
          (e = e.src),
          typeof e == "string" &&
          l &&
          typeof l != "function" &&
          typeof l != "symbol"
            ? ((l = Na(e)),
              (e = Pe(u).hoistableScripts),
              (a = e.get(l)),
              a ||
                ((a = {
                  type: "script",
                  instance: null,
                  count: 0,
                  state: null,
                }),
                e.set(l, a)),
              a)
            : { type: "void", instance: null, count: 0, state: null }
        );
      default:
        throw Error(o(444, t));
    }
  }
  function Ua(t) {
    return 'href="' + gl(t) + '"';
  }
  function _u(t) {
    return 'link[rel="stylesheet"][' + t + "]";
  }
  function Cd(t) {
    return A({}, t, { "data-precedence": t.precedence, precedence: null });
  }
  function Gy(t, l, e, a) {
    t.querySelector('link[rel="preload"][as="style"][' + l + "]")
      ? (a.loading = 1)
      : ((l = t.createElement("link")),
        (a.preload = l),
        l.addEventListener("load", function () {
          return (a.loading |= 1);
        }),
        l.addEventListener("error", function () {
          return (a.loading |= 2);
        }),
        Jt(l, "link", e),
        Lt(l),
        t.head.appendChild(l));
  }
  function Na(t) {
    return '[src="' + gl(t) + '"]';
  }
  function Au(t) {
    return "script[async]" + t;
  }
  function Ud(t, l, e) {
    if ((l.count++, l.instance === null))
      switch (l.type) {
        case "style":
          var a = t.querySelector('style[data-href~="' + gl(e.href) + '"]');
          if (a) return ((l.instance = a), Lt(a), a);
          var u = A({}, e, {
            "data-href": e.href,
            "data-precedence": e.precedence,
            href: null,
            precedence: null,
          });
          return (
            (a = (t.ownerDocument || t).createElement("style")),
            Lt(a),
            Jt(a, "style", u),
            Zn(a, e.precedence, t),
            (l.instance = a)
          );
        case "stylesheet":
          u = Ua(e.href);
          var n = t.querySelector(_u(u));
          if (n) return ((l.state.loading |= 4), (l.instance = n), Lt(n), n);
          ((a = Cd(e)),
            (u = Al.get(u)) && gc(a, u),
            (n = (t.ownerDocument || t).createElement("link")),
            Lt(n));
          var i = n;
          return (
            (i._p = new Promise(function (c, d) {
              ((i.onload = c), (i.onerror = d));
            })),
            Jt(n, "link", a),
            (l.state.loading |= 4),
            Zn(n, e.precedence, t),
            (l.instance = n)
          );
        case "script":
          return (
            (n = Na(e.src)),
            (u = t.querySelector(Au(n)))
              ? ((l.instance = u), Lt(u), u)
              : ((a = e),
                (u = Al.get(n)) && ((a = A({}, e)), pc(a, u)),
                (t = t.ownerDocument || t),
                (u = t.createElement("script")),
                Lt(u),
                Jt(u, "link", a),
                t.head.appendChild(u),
                (l.instance = u))
          );
        case "void":
          return null;
        default:
          throw Error(o(443, l.type));
      }
    else
      l.type === "stylesheet" &&
        (l.state.loading & 4) === 0 &&
        ((a = l.instance), (l.state.loading |= 4), Zn(a, e.precedence, t));
    return l.instance;
  }
  function Zn(t, l, e) {
    for (
      var a = e.querySelectorAll(
          'link[rel="stylesheet"][data-precedence],style[data-precedence]',
        ),
        u = a.length ? a[a.length - 1] : null,
        n = u,
        i = 0;
      i < a.length;
      i++
    ) {
      var c = a[i];
      if (c.dataset.precedence === l) n = c;
      else if (n !== u) break;
    }
    n
      ? n.parentNode.insertBefore(t, n.nextSibling)
      : ((l = e.nodeType === 9 ? e.head : e), l.insertBefore(t, l.firstChild));
  }
  function gc(t, l) {
    (t.crossOrigin == null && (t.crossOrigin = l.crossOrigin),
      t.referrerPolicy == null && (t.referrerPolicy = l.referrerPolicy),
      t.title == null && (t.title = l.title));
  }
  function pc(t, l) {
    (t.crossOrigin == null && (t.crossOrigin = l.crossOrigin),
      t.referrerPolicy == null && (t.referrerPolicy = l.referrerPolicy),
      t.integrity == null && (t.integrity = l.integrity));
  }
  var Vn = null;
  function Nd(t, l, e) {
    if (Vn === null) {
      var a = new Map(),
        u = (Vn = new Map());
      u.set(e, a);
    } else ((u = Vn), (a = u.get(e)), a || ((a = new Map()), u.set(e, a)));
    if (a.has(t)) return a;
    for (
      a.set(t, null), e = e.getElementsByTagName(t), u = 0;
      u < e.length;
      u++
    ) {
      var n = e[u];
      if (
        !(
          n[Xa] ||
          n[Qt] ||
          (t === "link" && n.getAttribute("rel") === "stylesheet")
        ) &&
        n.namespaceURI !== "http://www.w3.org/2000/svg"
      ) {
        var i = n.getAttribute(l) || "";
        i = t + i;
        var c = a.get(i);
        c ? c.push(n) : a.set(i, [n]);
      }
    }
    return a;
  }
  function xd(t, l, e) {
    ((t = t.ownerDocument || t),
      t.head.insertBefore(
        e,
        l === "title" ? t.querySelector("head > title") : null,
      ));
  }
  function Xy(t, l, e) {
    if (e === 1 || l.itemProp != null) return !1;
    switch (t) {
      case "meta":
      case "title":
        return !0;
      case "style":
        if (
          typeof l.precedence != "string" ||
          typeof l.href != "string" ||
          l.href === ""
        )
          break;
        return !0;
      case "link":
        if (
          typeof l.rel != "string" ||
          typeof l.href != "string" ||
          l.href === "" ||
          l.onLoad ||
          l.onError
        )
          break;
        switch (l.rel) {
          case "stylesheet":
            return (
              (t = l.disabled),
              typeof l.precedence == "string" && t == null
            );
          default:
            return !0;
        }
      case "script":
        if (
          l.async &&
          typeof l.async != "function" &&
          typeof l.async != "symbol" &&
          !l.onLoad &&
          !l.onError &&
          l.src &&
          typeof l.src == "string"
        )
          return !0;
    }
    return !1;
  }
  function Hd(t) {
    return !(t.type === "stylesheet" && (t.state.loading & 3) === 0);
  }
  function Qy(t, l, e, a) {
    if (
      e.type === "stylesheet" &&
      (typeof a.media != "string" || matchMedia(a.media).matches !== !1) &&
      (e.state.loading & 4) === 0
    ) {
      if (e.instance === null) {
        var u = Ua(a.href),
          n = l.querySelector(_u(u));
        if (n) {
          ((l = n._p),
            l !== null &&
              typeof l == "object" &&
              typeof l.then == "function" &&
              (t.count++, (t = Kn.bind(t)), l.then(t, t)),
            (e.state.loading |= 4),
            (e.instance = n),
            Lt(n));
          return;
        }
        ((n = l.ownerDocument || l),
          (a = Cd(a)),
          (u = Al.get(u)) && gc(a, u),
          (n = n.createElement("link")),
          Lt(n));
        var i = n;
        ((i._p = new Promise(function (c, d) {
          ((i.onload = c), (i.onerror = d));
        })),
          Jt(n, "link", a),
          (e.instance = n));
      }
      (t.stylesheets === null && (t.stylesheets = new Map()),
        t.stylesheets.set(e, l),
        (l = e.state.preload) &&
          (e.state.loading & 3) === 0 &&
          (t.count++,
          (e = Kn.bind(t)),
          l.addEventListener("load", e),
          l.addEventListener("error", e)));
    }
  }
  var Sc = 0;
  function Zy(t, l) {
    return (
      t.stylesheets && t.count === 0 && wn(t, t.stylesheets),
      0 < t.count || 0 < t.imgCount
        ? function (e) {
            var a = setTimeout(function () {
              if ((t.stylesheets && wn(t, t.stylesheets), t.unsuspend)) {
                var n = t.unsuspend;
                ((t.unsuspend = null), n());
              }
            }, 6e4 + l);
            0 < t.imgBytes && Sc === 0 && (Sc = 62500 * zy());
            var u = setTimeout(
              function () {
                if (
                  ((t.waitingForImages = !1),
                  t.count === 0 &&
                    (t.stylesheets && wn(t, t.stylesheets), t.unsuspend))
                ) {
                  var n = t.unsuspend;
                  ((t.unsuspend = null), n());
                }
              },
              (t.imgBytes > Sc ? 50 : 800) + l,
            );
            return (
              (t.unsuspend = e),
              function () {
                ((t.unsuspend = null), clearTimeout(a), clearTimeout(u));
              }
            );
          }
        : null
    );
  }
  function Kn() {
    if (
      (this.count--,
      this.count === 0 && (this.imgCount === 0 || !this.waitingForImages))
    ) {
      if (this.stylesheets) wn(this, this.stylesheets);
      else if (this.unsuspend) {
        var t = this.unsuspend;
        ((this.unsuspend = null), t());
      }
    }
  }
  var Jn = null;
  function wn(t, l) {
    ((t.stylesheets = null),
      t.unsuspend !== null &&
        (t.count++,
        (Jn = new Map()),
        l.forEach(Vy, t),
        (Jn = null),
        Kn.call(t)));
  }
  function Vy(t, l) {
    if (!(l.state.loading & 4)) {
      var e = Jn.get(t);
      if (e) var a = e.get(null);
      else {
        ((e = new Map()), Jn.set(t, e));
        for (
          var u = t.querySelectorAll(
              "link[data-precedence],style[data-precedence]",
            ),
            n = 0;
          n < u.length;
          n++
        ) {
          var i = u[n];
          (i.nodeName === "LINK" || i.getAttribute("media") !== "not all") &&
            (e.set(i.dataset.precedence, i), (a = i));
        }
        a && e.set(null, a);
      }
      ((u = l.instance),
        (i = u.getAttribute("data-precedence")),
        (n = e.get(i) || a),
        n === a && e.set(null, u),
        e.set(i, u),
        this.count++,
        (a = Kn.bind(this)),
        u.addEventListener("load", a),
        u.addEventListener("error", a),
        n
          ? n.parentNode.insertBefore(u, n.nextSibling)
          : ((t = t.nodeType === 9 ? t.head : t),
            t.insertBefore(u, t.firstChild)),
        (l.state.loading |= 4));
    }
  }
  var Ru = {
    $$typeof: Y,
    Provider: null,
    Consumer: null,
    _currentValue: W,
    _currentValue2: W,
    _threadCount: 0,
  };
  function Ky(t, l, e, a, u, n, i, c, d) {
    ((this.tag = 1),
      (this.containerInfo = t),
      (this.pingCache = this.current = this.pendingChildren = null),
      (this.timeoutHandle = -1),
      (this.callbackNode =
        this.next =
        this.pendingContext =
        this.context =
        this.cancelPendingCommit =
          null),
      (this.callbackPriority = 0),
      (this.expirationTimes = hi(-1)),
      (this.entangledLanes =
        this.shellSuspendCounter =
        this.errorRecoveryDisabledLanes =
        this.expiredLanes =
        this.warmLanes =
        this.pingedLanes =
        this.suspendedLanes =
        this.pendingLanes =
          0),
      (this.entanglements = hi(0)),
      (this.hiddenUpdates = hi(null)),
      (this.identifierPrefix = a),
      (this.onUncaughtError = u),
      (this.onCaughtError = n),
      (this.onRecoverableError = i),
      (this.pooledCache = null),
      (this.pooledCacheLanes = 0),
      (this.formState = d),
      (this.incompleteTransitions = new Map()));
  }
  function Bd(t, l, e, a, u, n, i, c, d, T, R, N) {
    return (
      (t = new Ky(t, l, e, i, d, T, R, N, c)),
      (l = 1),
      n === !0 && (l |= 24),
      (n = cl(3, null, null, l)),
      (t.current = n),
      (n.stateNode = t),
      (l = Fi()),
      l.refCount++,
      (t.pooledCache = l),
      l.refCount++,
      (n.memoizedState = { element: a, isDehydrated: e, cache: l }),
      lf(n),
      t
    );
  }
  function qd(t) {
    return t ? ((t = oa), t) : oa;
  }
  function jd(t, l, e, a, u, n) {
    ((u = qd(u)),
      a.context === null ? (a.context = u) : (a.pendingContext = u),
      (a = de(l)),
      (a.payload = { element: e }),
      (n = n === void 0 ? null : n),
      n !== null && (a.callback = n),
      (e = he(t, a, l)),
      e !== null && (al(e, t, l), uu(e, t, l)));
  }
  function Yd(t, l) {
    if (((t = t.memoizedState), t !== null && t.dehydrated !== null)) {
      var e = t.retryLane;
      t.retryLane = e !== 0 && e < l ? e : l;
    }
  }
  function bc(t, l) {
    (Yd(t, l), (t = t.alternate) && Yd(t, l));
  }
  function Ld(t) {
    if (t.tag === 13 || t.tag === 31) {
      var l = je(t, 67108864);
      (l !== null && al(l, t, 67108864), bc(t, 67108864));
    }
  }
  function Gd(t) {
    if (t.tag === 13 || t.tag === 31) {
      var l = hl();
      l = mi(l);
      var e = je(t, l);
      (e !== null && al(e, t, l), bc(t, l));
    }
  }
  var $n = !0;
  function Jy(t, l, e, a) {
    var u = D.T;
    D.T = null;
    var n = B.p;
    try {
      ((B.p = 2), Ec(t, l, e, a));
    } finally {
      ((B.p = n), (D.T = u));
    }
  }
  function wy(t, l, e, a) {
    var u = D.T;
    D.T = null;
    var n = B.p;
    try {
      ((B.p = 8), Ec(t, l, e, a));
    } finally {
      ((B.p = n), (D.T = u));
    }
  }
  function Ec(t, l, e, a) {
    if ($n) {
      var u = Tc(a);
      if (u === null) (fc(t, l, a, Wn, e), Qd(t, a));
      else if (Wy(u, t, l, e, a)) a.stopPropagation();
      else if ((Qd(t, a), l & 4 && -1 < $y.indexOf(t))) {
        for (; u !== null; ) {
          var n = Ie(u);
          if (n !== null)
            switch (n.tag) {
              case 3:
                if (((n = n.stateNode), n.current.memoizedState.isDehydrated)) {
                  var i = Ne(n.pendingLanes);
                  if (i !== 0) {
                    var c = n;
                    for (c.pendingLanes |= 2, c.entangledLanes |= 2; i; ) {
                      var d = 1 << (31 - il(i));
                      ((c.entanglements[1] |= d), (i &= ~d));
                    }
                    (Bl(n), (rt & 6) === 0 && ((Un = ul() + 500), bu(0)));
                  }
                }
                break;
              case 31:
              case 13:
                ((c = je(n, 2)), c !== null && al(c, n, 2), xn(), bc(n, 2));
            }
          if (((n = Tc(a)), n === null && fc(t, l, a, Wn, e), n === u)) break;
          u = n;
        }
        u !== null && a.stopPropagation();
      } else fc(t, l, a, null, e);
    }
  }
  function Tc(t) {
    return ((t = zi(t)), zc(t));
  }
  var Wn = null;
  function zc(t) {
    if (((Wn = null), (t = Fe(t)), t !== null)) {
      var l = m(t);
      if (l === null) t = null;
      else {
        var e = l.tag;
        if (e === 13) {
          if (((t = S(l)), t !== null)) return t;
          t = null;
        } else if (e === 31) {
          if (((t = M(l)), t !== null)) return t;
          t = null;
        } else if (e === 3) {
          if (l.stateNode.current.memoizedState.isDehydrated)
            return l.tag === 3 ? l.stateNode.containerInfo : null;
          t = null;
        } else l !== t && (t = null);
      }
    }
    return ((Wn = t), null);
  }
  function Xd(t) {
    switch (t) {
      case "beforetoggle":
      case "cancel":
      case "click":
      case "close":
      case "contextmenu":
      case "copy":
      case "cut":
      case "auxclick":
      case "dblclick":
      case "dragend":
      case "dragstart":
      case "drop":
      case "focusin":
      case "focusout":
      case "input":
      case "invalid":
      case "keydown":
      case "keypress":
      case "keyup":
      case "mousedown":
      case "mouseup":
      case "paste":
      case "pause":
      case "play":
      case "pointercancel":
      case "pointerdown":
      case "pointerup":
      case "ratechange":
      case "reset":
      case "resize":
      case "seeked":
      case "submit":
      case "toggle":
      case "touchcancel":
      case "touchend":
      case "touchstart":
      case "volumechange":
      case "change":
      case "selectionchange":
      case "textInput":
      case "compositionstart":
      case "compositionend":
      case "compositionupdate":
      case "beforeblur":
      case "afterblur":
      case "beforeinput":
      case "blur":
      case "fullscreenchange":
      case "focus":
      case "hashchange":
      case "popstate":
      case "select":
      case "selectstart":
        return 2;
      case "drag":
      case "dragenter":
      case "dragexit":
      case "dragleave":
      case "dragover":
      case "mousemove":
      case "mouseout":
      case "mouseover":
      case "pointermove":
      case "pointerout":
      case "pointerover":
      case "scroll":
      case "touchmove":
      case "wheel":
      case "mouseenter":
      case "mouseleave":
      case "pointerenter":
      case "pointerleave":
        return 8;
      case "message":
        switch (xh()) {
          case $c:
            return 2;
          case Wc:
            return 8;
          case ju:
          case Hh:
            return 32;
          case kc:
            return 268435456;
          default:
            return 32;
        }
      default:
        return 32;
    }
  }
  var _c = !1,
    _e = null,
    Ae = null,
    Re = null,
    Ou = new Map(),
    Mu = new Map(),
    Oe = [],
    $y =
      "mousedown mouseup touchcancel touchend touchstart auxclick dblclick pointercancel pointerdown pointerup dragend dragstart drop compositionend compositionstart keydown keypress keyup input textInput copy cut paste click change contextmenu reset".split(
        " ",
      );
  function Qd(t, l) {
    switch (t) {
      case "focusin":
      case "focusout":
        _e = null;
        break;
      case "dragenter":
      case "dragleave":
        Ae = null;
        break;
      case "mouseover":
      case "mouseout":
        Re = null;
        break;
      case "pointerover":
      case "pointerout":
        Ou.delete(l.pointerId);
        break;
      case "gotpointercapture":
      case "lostpointercapture":
        Mu.delete(l.pointerId);
    }
  }
  function Du(t, l, e, a, u, n) {
    return t === null || t.nativeEvent !== n
      ? ((t = {
          blockedOn: l,
          domEventName: e,
          eventSystemFlags: a,
          nativeEvent: n,
          targetContainers: [u],
        }),
        l !== null && ((l = Ie(l)), l !== null && Ld(l)),
        t)
      : ((t.eventSystemFlags |= a),
        (l = t.targetContainers),
        u !== null && l.indexOf(u) === -1 && l.push(u),
        t);
  }
  function Wy(t, l, e, a, u) {
    switch (l) {
      case "focusin":
        return ((_e = Du(_e, t, l, e, a, u)), !0);
      case "dragenter":
        return ((Ae = Du(Ae, t, l, e, a, u)), !0);
      case "mouseover":
        return ((Re = Du(Re, t, l, e, a, u)), !0);
      case "pointerover":
        var n = u.pointerId;
        return (Ou.set(n, Du(Ou.get(n) || null, t, l, e, a, u)), !0);
      case "gotpointercapture":
        return (
          (n = u.pointerId),
          Mu.set(n, Du(Mu.get(n) || null, t, l, e, a, u)),
          !0
        );
    }
    return !1;
  }
  function Zd(t) {
    var l = Fe(t.target);
    if (l !== null) {
      var e = m(l);
      if (e !== null) {
        if (((l = e.tag), l === 13)) {
          if (((l = S(e)), l !== null)) {
            ((t.blockedOn = l),
              eo(t.priority, function () {
                Gd(e);
              }));
            return;
          }
        } else if (l === 31) {
          if (((l = M(e)), l !== null)) {
            ((t.blockedOn = l),
              eo(t.priority, function () {
                Gd(e);
              }));
            return;
          }
        } else if (l === 3 && e.stateNode.current.memoizedState.isDehydrated) {
          t.blockedOn = e.tag === 3 ? e.stateNode.containerInfo : null;
          return;
        }
      }
    }
    t.blockedOn = null;
  }
  function kn(t) {
    if (t.blockedOn !== null) return !1;
    for (var l = t.targetContainers; 0 < l.length; ) {
      var e = Tc(t.nativeEvent);
      if (e === null) {
        e = t.nativeEvent;
        var a = new e.constructor(e.type, e);
        ((Ti = a), e.target.dispatchEvent(a), (Ti = null));
      } else return ((l = Ie(e)), l !== null && Ld(l), (t.blockedOn = e), !1);
      l.shift();
    }
    return !0;
  }
  function Vd(t, l, e) {
    kn(t) && e.delete(l);
  }
  function ky() {
    ((_c = !1),
      _e !== null && kn(_e) && (_e = null),
      Ae !== null && kn(Ae) && (Ae = null),
      Re !== null && kn(Re) && (Re = null),
      Ou.forEach(Vd),
      Mu.forEach(Vd));
  }
  function Fn(t, l) {
    t.blockedOn === l &&
      ((t.blockedOn = null),
      _c ||
        ((_c = !0),
        f.unstable_scheduleCallback(f.unstable_NormalPriority, ky)));
  }
  var In = null;
  function Kd(t) {
    In !== t &&
      ((In = t),
      f.unstable_scheduleCallback(f.unstable_NormalPriority, function () {
        In === t && (In = null);
        for (var l = 0; l < t.length; l += 3) {
          var e = t[l],
            a = t[l + 1],
            u = t[l + 2];
          if (typeof a != "function") {
            if (zc(a || e) === null) continue;
            break;
          }
          var n = Ie(e);
          n !== null &&
            (t.splice(l, 3),
            (l -= 3),
            Tf(n, { pending: !0, data: u, method: e.method, action: a }, a, u));
        }
      }));
  }
  function xa(t) {
    function l(d) {
      return Fn(d, t);
    }
    (_e !== null && Fn(_e, t),
      Ae !== null && Fn(Ae, t),
      Re !== null && Fn(Re, t),
      Ou.forEach(l),
      Mu.forEach(l));
    for (var e = 0; e < Oe.length; e++) {
      var a = Oe[e];
      a.blockedOn === t && (a.blockedOn = null);
    }
    for (; 0 < Oe.length && ((e = Oe[0]), e.blockedOn === null); )
      (Zd(e), e.blockedOn === null && Oe.shift());
    if (((e = (t.ownerDocument || t).$$reactFormReplay), e != null))
      for (a = 0; a < e.length; a += 3) {
        var u = e[a],
          n = e[a + 1],
          i = u[Ft] || null;
        if (typeof n == "function") i || Kd(e);
        else if (i) {
          var c = null;
          if (n && n.hasAttribute("formAction")) {
            if (((u = n), (i = n[Ft] || null))) c = i.formAction;
            else if (zc(u) !== null) continue;
          } else c = i.action;
          (typeof c == "function" ? (e[a + 1] = c) : (e.splice(a, 3), (a -= 3)),
            Kd(e));
        }
      }
  }
  function Jd() {
    function t(n) {
      n.canIntercept &&
        n.info === "react-transition" &&
        n.intercept({
          handler: function () {
            return new Promise(function (i) {
              return (u = i);
            });
          },
          focusReset: "manual",
          scroll: "manual",
        });
    }
    function l() {
      (u !== null && (u(), (u = null)), a || setTimeout(e, 20));
    }
    function e() {
      if (!a && !navigation.transition) {
        var n = navigation.currentEntry;
        n &&
          n.url != null &&
          navigation.navigate(n.url, {
            state: n.getState(),
            info: "react-transition",
            history: "replace",
          });
      }
    }
    if (typeof navigation == "object") {
      var a = !1,
        u = null;
      return (
        navigation.addEventListener("navigate", t),
        navigation.addEventListener("navigatesuccess", l),
        navigation.addEventListener("navigateerror", l),
        setTimeout(e, 100),
        function () {
          ((a = !0),
            navigation.removeEventListener("navigate", t),
            navigation.removeEventListener("navigatesuccess", l),
            navigation.removeEventListener("navigateerror", l),
            u !== null && (u(), (u = null)));
        }
      );
    }
  }
  function Ac(t) {
    this._internalRoot = t;
  }
  ((Pn.prototype.render = Ac.prototype.render =
    function (t) {
      var l = this._internalRoot;
      if (l === null) throw Error(o(409));
      var e = l.current,
        a = hl();
      jd(e, a, t, l, null, null);
    }),
    (Pn.prototype.unmount = Ac.prototype.unmount =
      function () {
        var t = this._internalRoot;
        if (t !== null) {
          this._internalRoot = null;
          var l = t.containerInfo;
          (jd(t.current, 2, null, t, null, null), xn(), (l[ke] = null));
        }
      }));
  function Pn(t) {
    this._internalRoot = t;
  }
  Pn.prototype.unstable_scheduleHydration = function (t) {
    if (t) {
      var l = lo();
      t = { blockedOn: null, target: t, priority: l };
      for (var e = 0; e < Oe.length && l !== 0 && l < Oe[e].priority; e++);
      (Oe.splice(e, 0, t), e === 0 && Zd(t));
    }
  };
  var wd = r.version;
  if (wd !== "19.2.4") throw Error(o(527, wd, "19.2.4"));
  B.findDOMNode = function (t) {
    var l = t._reactInternals;
    if (l === void 0)
      throw typeof t.render == "function"
        ? Error(o(188))
        : ((t = Object.keys(t).join(",")), Error(o(268, t)));
    return (
      (t = v(l)),
      (t = t !== null ? U(t) : null),
      (t = t === null ? null : t.stateNode),
      t
    );
  };
  var Fy = {
    bundleType: 0,
    version: "19.2.4",
    rendererPackageName: "react-dom",
    currentDispatcherRef: D,
    reconcilerVersion: "19.2.4",
  };
  if (typeof __REACT_DEVTOOLS_GLOBAL_HOOK__ < "u") {
    var ti = __REACT_DEVTOOLS_GLOBAL_HOOK__;
    if (!ti.isDisabled && ti.supportsFiber)
      try {
        ((Ya = ti.inject(Fy)), (nl = ti));
      } catch {}
  }
  return (
    (Uu.createRoot = function (t, l) {
      if (!h(t)) throw Error(o(299));
      var e = !1,
        a = "",
        u = ts,
        n = ls,
        i = es;
      return (
        l != null &&
          (l.unstable_strictMode === !0 && (e = !0),
          l.identifierPrefix !== void 0 && (a = l.identifierPrefix),
          l.onUncaughtError !== void 0 && (u = l.onUncaughtError),
          l.onCaughtError !== void 0 && (n = l.onCaughtError),
          l.onRecoverableError !== void 0 && (i = l.onRecoverableError)),
        (l = Bd(t, 1, !1, null, null, e, a, null, u, n, i, Jd)),
        (t[ke] = l.current),
        ic(t),
        new Ac(l)
      );
    }),
    (Uu.hydrateRoot = function (t, l, e) {
      if (!h(t)) throw Error(o(299));
      var a = !1,
        u = "",
        n = ts,
        i = ls,
        c = es,
        d = null;
      return (
        e != null &&
          (e.unstable_strictMode === !0 && (a = !0),
          e.identifierPrefix !== void 0 && (u = e.identifierPrefix),
          e.onUncaughtError !== void 0 && (n = e.onUncaughtError),
          e.onCaughtError !== void 0 && (i = e.onCaughtError),
          e.onRecoverableError !== void 0 && (c = e.onRecoverableError),
          e.formState !== void 0 && (d = e.formState)),
        (l = Bd(t, 1, !0, l, e ?? null, a, u, d, n, i, c, Jd)),
        (l.context = qd(null)),
        (e = l.current),
        (a = hl()),
        (a = mi(a)),
        (u = de(a)),
        (u.callback = null),
        he(e, u, a),
        (e = a),
        (l.current.lanes = e),
        Ga(l, e),
        Bl(l),
        (t[ke] = l.current),
        ic(t),
        new Pn(l)
      );
    }),
    (Uu.version = "19.2.4"),
    Uu
  );
}
var ah;
function fv() {
  if (ah) return Mc.exports;
  ah = 1;
  function f() {
    if (
      !(
        typeof __REACT_DEVTOOLS_GLOBAL_HOOK__ > "u" ||
        typeof __REACT_DEVTOOLS_GLOBAL_HOOK__.checkDCE != "function"
      )
    )
      try {
        __REACT_DEVTOOLS_GLOBAL_HOOK__.checkDCE(f);
      } catch (r) {
        console.error(r);
      }
  }
  return (f(), (Mc.exports = iv()), Mc.exports);
}
var cv = fv();
/**
 * react-router v7.13.0
 *
 * Copyright (c) Remix Software Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE.md file in the root directory of this source tree.
 *
 * @license MIT
 */ var uh = "popstate";
function ov(f = {}) {
  function r(o, h) {
    let { pathname: m, search: S, hash: M } = o.location;
    return Bc(
      "",
      { pathname: m, search: S, hash: M },
      (h.state && h.state.usr) || null,
      (h.state && h.state.key) || "default",
    );
  }
  function s(o, h) {
    return typeof h == "string" ? h : xu(h);
  }
  return sv(r, s, null, f);
}
function Rt(f, r) {
  if (f === !1 || f === null || typeof f > "u") throw new Error(r);
}
function Cl(f, r) {
  if (!f) {
    typeof console < "u" && console.warn(r);
    try {
      throw new Error(r);
    } catch {}
  }
}
function rv() {
  return Math.random().toString(36).substring(2, 10);
}
function nh(f, r) {
  return { usr: f.state, key: f.key, idx: r };
}
function Bc(f, r, s = null, o) {
  return {
    pathname: typeof f == "string" ? f : f.pathname,
    search: "",
    hash: "",
    ...(typeof r == "string" ? Ha(r) : r),
    state: s,
    key: (r && r.key) || o || rv(),
  };
}
function xu({ pathname: f = "/", search: r = "", hash: s = "" }) {
  return (
    r && r !== "?" && (f += r.charAt(0) === "?" ? r : "?" + r),
    s && s !== "#" && (f += s.charAt(0) === "#" ? s : "#" + s),
    f
  );
}
function Ha(f) {
  let r = {};
  if (f) {
    let s = f.indexOf("#");
    s >= 0 && ((r.hash = f.substring(s)), (f = f.substring(0, s)));
    let o = f.indexOf("?");
    (o >= 0 && ((r.search = f.substring(o)), (f = f.substring(0, o))),
      f && (r.pathname = f));
  }
  return r;
}
function sv(f, r, s, o = {}) {
  let { window: h = document.defaultView, v5Compat: m = !1 } = o,
    S = h.history,
    M = "POP",
    E = null,
    v = U();
  v == null && ((v = 0), S.replaceState({ ...S.state, idx: v }, ""));
  function U() {
    return (S.state || { idx: null }).idx;
  }
  function A() {
    M = "POP";
    let q = U(),
      V = q == null ? null : q - v;
    ((v = q), E && E({ action: M, location: Z.location, delta: V }));
  }
  function H(q, V) {
    M = "PUSH";
    let $ = Bc(Z.location, q, V);
    v = U() + 1;
    let Y = nh($, v),
      St = Z.createHref($);
    try {
      S.pushState(Y, "", St);
    } catch (mt) {
      if (mt instanceof DOMException && mt.name === "DataCloneError") throw mt;
      h.location.assign(St);
    }
    m && E && E({ action: M, location: Z.location, delta: 1 });
  }
  function G(q, V) {
    M = "REPLACE";
    let $ = Bc(Z.location, q, V);
    v = U();
    let Y = nh($, v),
      St = Z.createHref($);
    (S.replaceState(Y, "", St),
      m && E && E({ action: M, location: Z.location, delta: 0 }));
  }
  function w(q) {
    return dv(q);
  }
  let Z = {
    get action() {
      return M;
    },
    get location() {
      return f(h, S);
    },
    listen(q) {
      if (E) throw new Error("A history only accepts one active listener");
      return (
        h.addEventListener(uh, A),
        (E = q),
        () => {
          (h.removeEventListener(uh, A), (E = null));
        }
      );
    },
    createHref(q) {
      return r(h, q);
    },
    createURL: w,
    encodeLocation(q) {
      let V = w(q);
      return { pathname: V.pathname, search: V.search, hash: V.hash };
    },
    push: H,
    replace: G,
    go(q) {
      return S.go(q);
    },
  };
  return Z;
}
function dv(f, r = !1) {
  let s = "http://localhost";
  (typeof window < "u" &&
    (s =
      window.location.origin !== "null"
        ? window.location.origin
        : window.location.href),
    Rt(s, "No window.location.(origin|href) available to create URL"));
  let o = typeof f == "string" ? f : xu(f);
  return (
    (o = o.replace(/ $/, "%20")),
    !r && o.startsWith("//") && (o = s + o),
    new URL(o, s)
  );
}
function rh(f, r, s = "/") {
  return hv(f, r, s, !1);
}
function hv(f, r, s, o) {
  let h = typeof r == "string" ? Ha(r) : r,
    m = ae(h.pathname || "/", s);
  if (m == null) return null;
  let S = sh(f);
  mv(S);
  let M = null;
  for (let E = 0; M == null && E < S.length; ++E) {
    let v = Av(m);
    M = zv(S[E], v, o);
  }
  return M;
}
function sh(f, r = [], s = [], o = "", h = !1) {
  let m = (S, M, E = h, v) => {
    let U = {
      relativePath: v === void 0 ? S.path || "" : v,
      caseSensitive: S.caseSensitive === !0,
      childrenIndex: M,
      route: S,
    };
    if (U.relativePath.startsWith("/")) {
      if (!U.relativePath.startsWith(o) && E) return;
      (Rt(
        U.relativePath.startsWith(o),
        `Absolute route path "${U.relativePath}" nested under path "${o}" is not valid. An absolute child route path must start with the combined path of all its parent routes.`,
      ),
        (U.relativePath = U.relativePath.slice(o.length)));
    }
    let A = ee([o, U.relativePath]),
      H = s.concat(U);
    (S.children &&
      S.children.length > 0 &&
      (Rt(
        S.index !== !0,
        `Index routes must not have child routes. Please remove all child routes from route path "${A}".`,
      ),
      sh(S.children, r, H, A, E)),
      !(S.path == null && !S.index) &&
        r.push({ path: A, score: Ev(A, S.index), routesMeta: H }));
  };
  return (
    f.forEach((S, M) => {
      var E;
      if (S.path === "" || !((E = S.path) != null && E.includes("?"))) m(S, M);
      else for (let v of dh(S.path)) m(S, M, !0, v);
    }),
    r
  );
}
function dh(f) {
  let r = f.split("/");
  if (r.length === 0) return [];
  let [s, ...o] = r,
    h = s.endsWith("?"),
    m = s.replace(/\?$/, "");
  if (o.length === 0) return h ? [m, ""] : [m];
  let S = dh(o.join("/")),
    M = [];
  return (
    M.push(...S.map((E) => (E === "" ? m : [m, E].join("/")))),
    h && M.push(...S),
    M.map((E) => (f.startsWith("/") && E === "" ? "/" : E))
  );
}
function mv(f) {
  f.sort((r, s) =>
    r.score !== s.score
      ? s.score - r.score
      : Tv(
          r.routesMeta.map((o) => o.childrenIndex),
          s.routesMeta.map((o) => o.childrenIndex),
        ),
  );
}
var yv = /^:[\w-]+$/,
  vv = 3,
  gv = 2,
  pv = 1,
  Sv = 10,
  bv = -2,
  ih = (f) => f === "*";
function Ev(f, r) {
  let s = f.split("/"),
    o = s.length;
  return (
    s.some(ih) && (o += bv),
    r && (o += gv),
    s
      .filter((h) => !ih(h))
      .reduce((h, m) => h + (yv.test(m) ? vv : m === "" ? pv : Sv), o)
  );
}
function Tv(f, r) {
  return f.length === r.length && f.slice(0, -1).every((o, h) => o === r[h])
    ? f[f.length - 1] - r[r.length - 1]
    : 0;
}
function zv(f, r, s = !1) {
  let { routesMeta: o } = f,
    h = {},
    m = "/",
    S = [];
  for (let M = 0; M < o.length; ++M) {
    let E = o[M],
      v = M === o.length - 1,
      U = m === "/" ? r : r.slice(m.length) || "/",
      A = ui(
        { path: E.relativePath, caseSensitive: E.caseSensitive, end: v },
        U,
      ),
      H = E.route;
    if (
      (!A &&
        v &&
        s &&
        !o[o.length - 1].route.index &&
        (A = ui(
          { path: E.relativePath, caseSensitive: E.caseSensitive, end: !1 },
          U,
        )),
      !A)
    )
      return null;
    (Object.assign(h, A.params),
      S.push({
        params: h,
        pathname: ee([m, A.pathname]),
        pathnameBase: Dv(ee([m, A.pathnameBase])),
        route: H,
      }),
      A.pathnameBase !== "/" && (m = ee([m, A.pathnameBase])));
  }
  return S;
}
function ui(f, r) {
  typeof f == "string" && (f = { path: f, caseSensitive: !1, end: !0 });
  let [s, o] = _v(f.path, f.caseSensitive, f.end),
    h = r.match(s);
  if (!h) return null;
  let m = h[0],
    S = m.replace(/(.)\/+$/, "$1"),
    M = h.slice(1);
  return {
    params: o.reduce((v, { paramName: U, isOptional: A }, H) => {
      if (U === "*") {
        let w = M[H] || "";
        S = m.slice(0, m.length - w.length).replace(/(.)\/+$/, "$1");
      }
      const G = M[H];
      return (
        A && !G ? (v[U] = void 0) : (v[U] = (G || "").replace(/%2F/g, "/")),
        v
      );
    }, {}),
    pathname: m,
    pathnameBase: S,
    pattern: f,
  };
}
function _v(f, r = !1, s = !0) {
  Cl(
    f === "*" || !f.endsWith("*") || f.endsWith("/*"),
    `Route path "${f}" will be treated as if it were "${f.replace(/\*$/, "/*")}" because the \`*\` character must always follow a \`/\` in the pattern. To get rid of this warning, please change the route path to "${f.replace(/\*$/, "/*")}".`,
  );
  let o = [],
    h =
      "^" +
      f
        .replace(/\/*\*?$/, "")
        .replace(/^\/*/, "/")
        .replace(/[\\.*+^${}|()[\]]/g, "\\$&")
        .replace(
          /\/:([\w-]+)(\?)?/g,
          (S, M, E) => (
            o.push({ paramName: M, isOptional: E != null }),
            E ? "/?([^\\/]+)?" : "/([^\\/]+)"
          ),
        )
        .replace(/\/([\w-]+)\?(\/|$)/g, "(/$1)?$2");
  return (
    f.endsWith("*")
      ? (o.push({ paramName: "*" }),
        (h += f === "*" || f === "/*" ? "(.*)$" : "(?:\\/(.+)|\\/*)$"))
      : s
        ? (h += "\\/*$")
        : f !== "" && f !== "/" && (h += "(?:(?=\\/|$))"),
    [new RegExp(h, r ? void 0 : "i"), o]
  );
}
function Av(f) {
  try {
    return f
      .split("/")
      .map((r) => decodeURIComponent(r).replace(/\//g, "%2F"))
      .join("/");
  } catch (r) {
    return (
      Cl(
        !1,
        `The URL path "${f}" could not be decoded because it is a malformed URL segment. This is probably due to a bad percent encoding (${r}).`,
      ),
      f
    );
  }
}
function ae(f, r) {
  if (r === "/") return f;
  if (!f.toLowerCase().startsWith(r.toLowerCase())) return null;
  let s = r.endsWith("/") ? r.length - 1 : r.length,
    o = f.charAt(s);
  return o && o !== "/" ? null : f.slice(s) || "/";
}
var Rv = /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i;
function Ov(f, r = "/") {
  let {
      pathname: s,
      search: o = "",
      hash: h = "",
    } = typeof f == "string" ? Ha(f) : f,
    m;
  return (
    s
      ? ((s = s.replace(/\/\/+/g, "/")),
        s.startsWith("/") ? (m = fh(s.substring(1), "/")) : (m = fh(s, r)))
      : (m = r),
    { pathname: m, search: Cv(o), hash: Uv(h) }
  );
}
function fh(f, r) {
  let s = r.replace(/\/+$/, "").split("/");
  return (
    f.split("/").forEach((h) => {
      h === ".." ? s.length > 1 && s.pop() : h !== "." && s.push(h);
    }),
    s.length > 1 ? s.join("/") : "/"
  );
}
function Nc(f, r, s, o) {
  return `Cannot include a '${f}' character in a manually specified \`to.${r}\` field [${JSON.stringify(o)}].  Please separate it out to the \`to.${s}\` field. Alternatively you may provide the full path as a string in <Link to="..."> and the router will parse it for you.`;
}
function Mv(f) {
  return f.filter(
    (r, s) => s === 0 || (r.route.path && r.route.path.length > 0),
  );
}
function Lc(f) {
  let r = Mv(f);
  return r.map((s, o) => (o === r.length - 1 ? s.pathname : s.pathnameBase));
}
function Gc(f, r, s, o = !1) {
  let h;
  typeof f == "string"
    ? (h = Ha(f))
    : ((h = { ...f }),
      Rt(
        !h.pathname || !h.pathname.includes("?"),
        Nc("?", "pathname", "search", h),
      ),
      Rt(
        !h.pathname || !h.pathname.includes("#"),
        Nc("#", "pathname", "hash", h),
      ),
      Rt(!h.search || !h.search.includes("#"), Nc("#", "search", "hash", h)));
  let m = f === "" || h.pathname === "",
    S = m ? "/" : h.pathname,
    M;
  if (S == null) M = s;
  else {
    let A = r.length - 1;
    if (!o && S.startsWith("..")) {
      let H = S.split("/");
      for (; H[0] === ".."; ) (H.shift(), (A -= 1));
      h.pathname = H.join("/");
    }
    M = A >= 0 ? r[A] : "/";
  }
  let E = Ov(h, M),
    v = S && S !== "/" && S.endsWith("/"),
    U = (m || S === ".") && s.endsWith("/");
  return (!E.pathname.endsWith("/") && (v || U) && (E.pathname += "/"), E);
}
var ee = (f) => f.join("/").replace(/\/\/+/g, "/"),
  Dv = (f) => f.replace(/\/+$/, "").replace(/^\/*/, "/"),
  Cv = (f) => (!f || f === "?" ? "" : f.startsWith("?") ? f : "?" + f),
  Uv = (f) => (!f || f === "#" ? "" : f.startsWith("#") ? f : "#" + f),
  Nv = class {
    constructor(f, r, s, o = !1) {
      ((this.status = f),
        (this.statusText = r || ""),
        (this.internal = o),
        s instanceof Error
          ? ((this.data = s.toString()), (this.error = s))
          : (this.data = s));
    }
  };
function xv(f) {
  return (
    f != null &&
    typeof f.status == "number" &&
    typeof f.statusText == "string" &&
    typeof f.internal == "boolean" &&
    "data" in f
  );
}
function Hv(f) {
  return (
    f
      .map((r) => r.route.path)
      .filter(Boolean)
      .join("/")
      .replace(/\/\/*/g, "/") || "/"
  );
}
var hh =
  typeof window < "u" &&
  typeof window.document < "u" &&
  typeof window.document.createElement < "u";
function mh(f, r) {
  let s = f;
  if (typeof s != "string" || !Rv.test(s))
    return { absoluteURL: void 0, isExternal: !1, to: s };
  let o = s,
    h = !1;
  if (hh)
    try {
      let m = new URL(window.location.href),
        S = s.startsWith("//") ? new URL(m.protocol + s) : new URL(s),
        M = ae(S.pathname, r);
      S.origin === m.origin && M != null
        ? (s = M + S.search + S.hash)
        : (h = !0);
    } catch {
      Cl(
        !1,
        `<Link to="${s}"> contains an invalid URL which will probably break when clicked - please update to a valid URL path.`,
      );
    }
  return { absoluteURL: o, isExternal: h, to: s };
}
Object.getOwnPropertyNames(Object.prototype).sort().join("\0");
var yh = ["POST", "PUT", "PATCH", "DELETE"];
new Set(yh);
var Bv = ["GET", ...yh];
new Set(Bv);
var Ba = O.createContext(null);
Ba.displayName = "DataRouter";
var ni = O.createContext(null);
ni.displayName = "DataRouterState";
var qv = O.createContext(!1),
  vh = O.createContext({ isTransitioning: !1 });
vh.displayName = "ViewTransition";
var jv = O.createContext(new Map());
jv.displayName = "Fetchers";
var Yv = O.createContext(null);
Yv.displayName = "Await";
var ml = O.createContext(null);
ml.displayName = "Navigation";
var Hu = O.createContext(null);
Hu.displayName = "Location";
var ql = O.createContext({ outlet: null, matches: [], isDataRoute: !1 });
ql.displayName = "Route";
var Xc = O.createContext(null);
Xc.displayName = "RouteError";
var gh = "REACT_ROUTER_ERROR",
  Lv = "REDIRECT",
  Gv = "ROUTE_ERROR_RESPONSE";
function Xv(f) {
  if (f.startsWith(`${gh}:${Lv}:{`))
    try {
      let r = JSON.parse(f.slice(28));
      if (
        typeof r == "object" &&
        r &&
        typeof r.status == "number" &&
        typeof r.statusText == "string" &&
        typeof r.location == "string" &&
        typeof r.reloadDocument == "boolean" &&
        typeof r.replace == "boolean"
      )
        return r;
    } catch {}
}
function Qv(f) {
  if (f.startsWith(`${gh}:${Gv}:{`))
    try {
      let r = JSON.parse(f.slice(40));
      if (
        typeof r == "object" &&
        r &&
        typeof r.status == "number" &&
        typeof r.statusText == "string"
      )
        return new Nv(r.status, r.statusText, r.data);
    } catch {}
}
function Zv(f, { relative: r } = {}) {
  Rt(
    qa(),
    "useHref() may be used only in the context of a <Router> component.",
  );
  let { basename: s, navigator: o } = O.useContext(ml),
    { hash: h, pathname: m, search: S } = Bu(f, { relative: r }),
    M = m;
  return (
    s !== "/" && (M = m === "/" ? s : ee([s, m])),
    o.createHref({ pathname: M, search: S, hash: h })
  );
}
function qa() {
  return O.useContext(Hu) != null;
}
function De() {
  return (
    Rt(
      qa(),
      "useLocation() may be used only in the context of a <Router> component.",
    ),
    O.useContext(Hu).location
  );
}
var ph =
  "You should call navigate() in a React.useEffect(), not when your component is first rendered.";
function Sh(f) {
  O.useContext(ml).static || O.useLayoutEffect(f);
}
function bh() {
  let { isDataRoute: f } = O.useContext(ql);
  return f ? e0() : Vv();
}
function Vv() {
  Rt(
    qa(),
    "useNavigate() may be used only in the context of a <Router> component.",
  );
  let f = O.useContext(Ba),
    { basename: r, navigator: s } = O.useContext(ml),
    { matches: o } = O.useContext(ql),
    { pathname: h } = De(),
    m = JSON.stringify(Lc(o)),
    S = O.useRef(!1);
  return (
    Sh(() => {
      S.current = !0;
    }),
    O.useCallback(
      (E, v = {}) => {
        if ((Cl(S.current, ph), !S.current)) return;
        if (typeof E == "number") {
          s.go(E);
          return;
        }
        let U = Gc(E, JSON.parse(m), h, v.relative === "path");
        (f == null &&
          r !== "/" &&
          (U.pathname = U.pathname === "/" ? r : ee([r, U.pathname])),
          (v.replace ? s.replace : s.push)(U, v.state, v));
      },
      [r, s, m, h, f],
    )
  );
}
O.createContext(null);
function Bu(f, { relative: r } = {}) {
  let { matches: s } = O.useContext(ql),
    { pathname: o } = De(),
    h = JSON.stringify(Lc(s));
  return O.useMemo(() => Gc(f, JSON.parse(h), o, r === "path"), [f, h, o, r]);
}
function Kv(f, r) {
  return Eh(f, r);
}
function Eh(f, r, s, o, h) {
  var $;
  Rt(
    qa(),
    "useRoutes() may be used only in the context of a <Router> component.",
  );
  let { navigator: m } = O.useContext(ml),
    { matches: S } = O.useContext(ql),
    M = S[S.length - 1],
    E = M ? M.params : {},
    v = M ? M.pathname : "/",
    U = M ? M.pathnameBase : "/",
    A = M && M.route;
  {
    let Y = (A && A.path) || "";
    zh(
      v,
      !A || Y.endsWith("*") || Y.endsWith("*?"),
      `You rendered descendant <Routes> (or called \`useRoutes()\`) at "${v}" (under <Route path="${Y}">) but the parent route path has no trailing "*". This means if you navigate deeper, the parent won't match anymore and therefore the child routes will never render.

Please change the parent <Route path="${Y}"> to <Route path="${Y === "/" ? "*" : `${Y}/*`}">.`,
    );
  }
  let H = De(),
    G;
  if (r) {
    let Y = typeof r == "string" ? Ha(r) : r;
    (Rt(
      U === "/" || (($ = Y.pathname) == null ? void 0 : $.startsWith(U)),
      `When overriding the location using \`<Routes location>\` or \`useRoutes(routes, location)\`, the location pathname must begin with the portion of the URL pathname that was matched by all parent routes. The current pathname base is "${U}" but pathname "${Y.pathname}" was given in the \`location\` prop.`,
    ),
      (G = Y));
  } else G = H;
  let w = G.pathname || "/",
    Z = w;
  if (U !== "/") {
    let Y = U.replace(/^\//, "").split("/");
    Z = "/" + w.replace(/^\//, "").split("/").slice(Y.length).join("/");
  }
  let q = rh(f, { pathname: Z });
  (Cl(
    A || q != null,
    `No routes matched location "${G.pathname}${G.search}${G.hash}" `,
  ),
    Cl(
      q == null ||
        q[q.length - 1].route.element !== void 0 ||
        q[q.length - 1].route.Component !== void 0 ||
        q[q.length - 1].route.lazy !== void 0,
      `Matched leaf route at location "${G.pathname}${G.search}${G.hash}" does not have an element or Component. This means it will render an <Outlet /> with a null value by default resulting in an "empty" page.`,
    ));
  let V = kv(
    q &&
      q.map((Y) =>
        Object.assign({}, Y, {
          params: Object.assign({}, E, Y.params),
          pathname: ee([
            U,
            m.encodeLocation
              ? m.encodeLocation(
                  Y.pathname.replace(/\?/g, "%3F").replace(/#/g, "%23"),
                ).pathname
              : Y.pathname,
          ]),
          pathnameBase:
            Y.pathnameBase === "/"
              ? U
              : ee([
                  U,
                  m.encodeLocation
                    ? m.encodeLocation(
                        Y.pathnameBase
                          .replace(/\?/g, "%3F")
                          .replace(/#/g, "%23"),
                      ).pathname
                    : Y.pathnameBase,
                ]),
        }),
      ),
    S,
    s,
    o,
    h,
  );
  return r && V
    ? O.createElement(
        Hu.Provider,
        {
          value: {
            location: {
              pathname: "/",
              search: "",
              hash: "",
              state: null,
              key: "default",
              ...G,
            },
            navigationType: "POP",
          },
        },
        V,
      )
    : V;
}
function Jv() {
  let f = l0(),
    r = xv(f)
      ? `${f.status} ${f.statusText}`
      : f instanceof Error
        ? f.message
        : JSON.stringify(f),
    s = f instanceof Error ? f.stack : null,
    o = "rgba(200,200,200, 0.5)",
    h = { padding: "0.5rem", backgroundColor: o },
    m = { padding: "2px 4px", backgroundColor: o },
    S = null;
  return (
    console.error("Error handled by React Router default ErrorBoundary:", f),
    (S = O.createElement(
      O.Fragment,
      null,
      O.createElement("p", null, "💿 Hey developer 👋"),
      O.createElement(
        "p",
        null,
        "You can provide a way better UX than this when your app throws errors by providing your own ",
        O.createElement("code", { style: m }, "ErrorBoundary"),
        " or",
        " ",
        O.createElement("code", { style: m }, "errorElement"),
        " prop on your route.",
      ),
    )),
    O.createElement(
      O.Fragment,
      null,
      O.createElement("h2", null, "Unexpected Application Error!"),
      O.createElement("h3", { style: { fontStyle: "italic" } }, r),
      s ? O.createElement("pre", { style: h }, s) : null,
      S,
    )
  );
}
var wv = O.createElement(Jv, null),
  Th = class extends O.Component {
    constructor(f) {
      (super(f),
        (this.state = {
          location: f.location,
          revalidation: f.revalidation,
          error: f.error,
        }));
    }
    static getDerivedStateFromError(f) {
      return { error: f };
    }
    static getDerivedStateFromProps(f, r) {
      return r.location !== f.location ||
        (r.revalidation !== "idle" && f.revalidation === "idle")
        ? { error: f.error, location: f.location, revalidation: f.revalidation }
        : {
            error: f.error !== void 0 ? f.error : r.error,
            location: r.location,
            revalidation: f.revalidation || r.revalidation,
          };
    }
    componentDidCatch(f, r) {
      this.props.onError
        ? this.props.onError(f, r)
        : console.error(
            "React Router caught the following error during render",
            f,
          );
    }
    render() {
      let f = this.state.error;
      if (
        this.context &&
        typeof f == "object" &&
        f &&
        "digest" in f &&
        typeof f.digest == "string"
      ) {
        const s = Qv(f.digest);
        s && (f = s);
      }
      let r =
        f !== void 0
          ? O.createElement(
              ql.Provider,
              { value: this.props.routeContext },
              O.createElement(Xc.Provider, {
                value: f,
                children: this.props.component,
              }),
            )
          : this.props.children;
      return this.context ? O.createElement($v, { error: f }, r) : r;
    }
  };
Th.contextType = qv;
var xc = new WeakMap();
function $v({ children: f, error: r }) {
  let { basename: s } = O.useContext(ml);
  if (
    typeof r == "object" &&
    r &&
    "digest" in r &&
    typeof r.digest == "string"
  ) {
    let o = Xv(r.digest);
    if (o) {
      let h = xc.get(r);
      if (h) throw h;
      let m = mh(o.location, s);
      if (hh && !xc.get(r))
        if (m.isExternal || o.reloadDocument)
          window.location.href = m.absoluteURL || m.to;
        else {
          const S = Promise.resolve().then(() =>
            window.__reactRouterDataRouter.navigate(m.to, {
              replace: o.replace,
            }),
          );
          throw (xc.set(r, S), S);
        }
      return O.createElement("meta", {
        httpEquiv: "refresh",
        content: `0;url=${m.absoluteURL || m.to}`,
      });
    }
  }
  return f;
}
function Wv({ routeContext: f, match: r, children: s }) {
  let o = O.useContext(Ba);
  return (
    o &&
      o.static &&
      o.staticContext &&
      (r.route.errorElement || r.route.ErrorBoundary) &&
      (o.staticContext._deepestRenderedBoundaryId = r.route.id),
    O.createElement(ql.Provider, { value: f }, s)
  );
}
function kv(f, r = [], s = null, o = null, h = null) {
  if (f == null) {
    if (!s) return null;
    if (s.errors) f = s.matches;
    else if (r.length === 0 && !s.initialized && s.matches.length > 0)
      f = s.matches;
    else return null;
  }
  let m = f,
    S = s == null ? void 0 : s.errors;
  if (S != null) {
    let U = m.findIndex(
      (A) => A.route.id && (S == null ? void 0 : S[A.route.id]) !== void 0,
    );
    (Rt(
      U >= 0,
      `Could not find a matching route for errors on route IDs: ${Object.keys(S).join(",")}`,
    ),
      (m = m.slice(0, Math.min(m.length, U + 1))));
  }
  let M = !1,
    E = -1;
  if (s)
    for (let U = 0; U < m.length; U++) {
      let A = m[U];
      if (
        ((A.route.HydrateFallback || A.route.hydrateFallbackElement) && (E = U),
        A.route.id)
      ) {
        let { loaderData: H, errors: G } = s,
          w =
            A.route.loader &&
            !H.hasOwnProperty(A.route.id) &&
            (!G || G[A.route.id] === void 0);
        if (A.route.lazy || w) {
          ((M = !0), E >= 0 ? (m = m.slice(0, E + 1)) : (m = [m[0]]));
          break;
        }
      }
    }
  let v =
    s && o
      ? (U, A) => {
          var H, G;
          o(U, {
            location: s.location,
            params:
              ((G = (H = s.matches) == null ? void 0 : H[0]) == null
                ? void 0
                : G.params) ?? {},
            unstable_pattern: Hv(s.matches),
            errorInfo: A,
          });
        }
      : void 0;
  return m.reduceRight((U, A, H) => {
    let G,
      w = !1,
      Z = null,
      q = null;
    s &&
      ((G = S && A.route.id ? S[A.route.id] : void 0),
      (Z = A.route.errorElement || wv),
      M &&
        (E < 0 && H === 0
          ? (zh(
              "route-fallback",
              !1,
              "No `HydrateFallback` element provided to render during initial hydration",
            ),
            (w = !0),
            (q = null))
          : E === H &&
            ((w = !0), (q = A.route.hydrateFallbackElement || null))));
    let V = r.concat(m.slice(0, H + 1)),
      $ = () => {
        let Y;
        return (
          G
            ? (Y = Z)
            : w
              ? (Y = q)
              : A.route.Component
                ? (Y = O.createElement(A.route.Component, null))
                : A.route.element
                  ? (Y = A.route.element)
                  : (Y = U),
          O.createElement(Wv, {
            match: A,
            routeContext: { outlet: U, matches: V, isDataRoute: s != null },
            children: Y,
          })
        );
      };
    return s && (A.route.ErrorBoundary || A.route.errorElement || H === 0)
      ? O.createElement(Th, {
          location: s.location,
          revalidation: s.revalidation,
          component: Z,
          error: G,
          children: $(),
          routeContext: { outlet: null, matches: V, isDataRoute: !0 },
          onError: v,
        })
      : $();
  }, null);
}
function Qc(f) {
  return `${f} must be used within a data router.  See https://reactrouter.com/en/main/routers/picking-a-router.`;
}
function Fv(f) {
  let r = O.useContext(Ba);
  return (Rt(r, Qc(f)), r);
}
function Iv(f) {
  let r = O.useContext(ni);
  return (Rt(r, Qc(f)), r);
}
function Pv(f) {
  let r = O.useContext(ql);
  return (Rt(r, Qc(f)), r);
}
function Zc(f) {
  let r = Pv(f),
    s = r.matches[r.matches.length - 1];
  return (
    Rt(
      s.route.id,
      `${f} can only be used on routes that contain a unique "id"`,
    ),
    s.route.id
  );
}
function t0() {
  return Zc("useRouteId");
}
function l0() {
  var o;
  let f = O.useContext(Xc),
    r = Iv("useRouteError"),
    s = Zc("useRouteError");
  return f !== void 0 ? f : (o = r.errors) == null ? void 0 : o[s];
}
function e0() {
  let { router: f } = Fv("useNavigate"),
    r = Zc("useNavigate"),
    s = O.useRef(!1);
  return (
    Sh(() => {
      s.current = !0;
    }),
    O.useCallback(
      async (h, m = {}) => {
        (Cl(s.current, ph),
          s.current &&
            (typeof h == "number"
              ? await f.navigate(h)
              : await f.navigate(h, { fromRouteId: r, ...m })));
      },
      [f, r],
    )
  );
}
var ch = {};
function zh(f, r, s) {
  !r && !ch[f] && ((ch[f] = !0), Cl(!1, s));
}
O.memo(a0);
function a0({ routes: f, future: r, state: s, onError: o }) {
  return Eh(f, void 0, s, o, r);
}
function u0({ to: f, replace: r, state: s, relative: o }) {
  Rt(
    qa(),
    "<Navigate> may be used only in the context of a <Router> component.",
  );
  let { static: h } = O.useContext(ml);
  Cl(
    !h,
    "<Navigate> must not be used on the initial render in a <StaticRouter>. This is a no-op, but you should modify your code so the <Navigate> is only ever rendered in response to some user interaction or state change.",
  );
  let { matches: m } = O.useContext(ql),
    { pathname: S } = De(),
    M = bh(),
    E = Gc(f, Lc(m), S, o === "path"),
    v = JSON.stringify(E);
  return (
    O.useEffect(() => {
      M(JSON.parse(v), { replace: r, state: s, relative: o });
    }, [M, v, o, r, s]),
    null
  );
}
function qc(f) {
  Rt(
    !1,
    "A <Route> is only ever to be used as the child of <Routes> element, never rendered directly. Please wrap your <Route> in a <Routes>.",
  );
}
function n0({
  basename: f = "/",
  children: r = null,
  location: s,
  navigationType: o = "POP",
  navigator: h,
  static: m = !1,
  unstable_useTransitions: S,
}) {
  Rt(
    !qa(),
    "You cannot render a <Router> inside another <Router>. You should never have more than one in your app.",
  );
  let M = f.replace(/^\/*/, "/"),
    E = O.useMemo(
      () => ({
        basename: M,
        navigator: h,
        static: m,
        unstable_useTransitions: S,
        future: {},
      }),
      [M, h, m, S],
    );
  typeof s == "string" && (s = Ha(s));
  let {
      pathname: v = "/",
      search: U = "",
      hash: A = "",
      state: H = null,
      key: G = "default",
    } = s,
    w = O.useMemo(() => {
      let Z = ae(v, M);
      return Z == null
        ? null
        : {
            location: { pathname: Z, search: U, hash: A, state: H, key: G },
            navigationType: o,
          };
    }, [M, v, U, A, H, G, o]);
  return (
    Cl(
      w != null,
      `<Router basename="${M}"> is not able to match the URL "${v}${U}${A}" because it does not start with the basename, so the <Router> won't render anything.`,
    ),
    w == null
      ? null
      : O.createElement(
          ml.Provider,
          { value: E },
          O.createElement(Hu.Provider, { children: r, value: w }),
        )
  );
}
function i0({ children: f, location: r }) {
  return Kv(jc(f), r);
}
function jc(f, r = []) {
  let s = [];
  return (
    O.Children.forEach(f, (o, h) => {
      if (!O.isValidElement(o)) return;
      let m = [...r, h];
      if (o.type === O.Fragment) {
        s.push.apply(s, jc(o.props.children, m));
        return;
      }
      (Rt(
        o.type === qc,
        `[${typeof o.type == "string" ? o.type : o.type.name}] is not a <Route> component. All component children of <Routes> must be a <Route> or <React.Fragment>`,
      ),
        Rt(
          !o.props.index || !o.props.children,
          "An index route cannot have child routes.",
        ));
      let S = {
        id: o.props.id || m.join("-"),
        caseSensitive: o.props.caseSensitive,
        element: o.props.element,
        Component: o.props.Component,
        index: o.props.index,
        path: o.props.path,
        middleware: o.props.middleware,
        loader: o.props.loader,
        action: o.props.action,
        hydrateFallbackElement: o.props.hydrateFallbackElement,
        HydrateFallback: o.props.HydrateFallback,
        errorElement: o.props.errorElement,
        ErrorBoundary: o.props.ErrorBoundary,
        hasErrorBoundary:
          o.props.hasErrorBoundary === !0 ||
          o.props.ErrorBoundary != null ||
          o.props.errorElement != null,
        shouldRevalidate: o.props.shouldRevalidate,
        handle: o.props.handle,
        lazy: o.props.lazy,
      };
      (o.props.children && (S.children = jc(o.props.children, m)), s.push(S));
    }),
    s
  );
}
var ei = "get",
  ai = "application/x-www-form-urlencoded";
function ii(f) {
  return typeof HTMLElement < "u" && f instanceof HTMLElement;
}
function f0(f) {
  return ii(f) && f.tagName.toLowerCase() === "button";
}
function c0(f) {
  return ii(f) && f.tagName.toLowerCase() === "form";
}
function o0(f) {
  return ii(f) && f.tagName.toLowerCase() === "input";
}
function r0(f) {
  return !!(f.metaKey || f.altKey || f.ctrlKey || f.shiftKey);
}
function s0(f, r) {
  return f.button === 0 && (!r || r === "_self") && !r0(f);
}
var li = null;
function d0() {
  if (li === null)
    try {
      (new FormData(document.createElement("form"), 0), (li = !1));
    } catch {
      li = !0;
    }
  return li;
}
var h0 = new Set([
  "application/x-www-form-urlencoded",
  "multipart/form-data",
  "text/plain",
]);
function Hc(f) {
  return f != null && !h0.has(f)
    ? (Cl(
        !1,
        `"${f}" is not a valid \`encType\` for \`<Form>\`/\`<fetcher.Form>\` and will default to "${ai}"`,
      ),
      null)
    : f;
}
function m0(f, r) {
  let s, o, h, m, S;
  if (c0(f)) {
    let M = f.getAttribute("action");
    ((o = M ? ae(M, r) : null),
      (s = f.getAttribute("method") || ei),
      (h = Hc(f.getAttribute("enctype")) || ai),
      (m = new FormData(f)));
  } else if (f0(f) || (o0(f) && (f.type === "submit" || f.type === "image"))) {
    let M = f.form;
    if (M == null)
      throw new Error(
        'Cannot submit a <button> or <input type="submit"> without a <form>',
      );
    let E = f.getAttribute("formaction") || M.getAttribute("action");
    if (
      ((o = E ? ae(E, r) : null),
      (s = f.getAttribute("formmethod") || M.getAttribute("method") || ei),
      (h =
        Hc(f.getAttribute("formenctype")) ||
        Hc(M.getAttribute("enctype")) ||
        ai),
      (m = new FormData(M, f)),
      !d0())
    ) {
      let { name: v, type: U, value: A } = f;
      if (U === "image") {
        let H = v ? `${v}.` : "";
        (m.append(`${H}x`, "0"), m.append(`${H}y`, "0"));
      } else v && m.append(v, A);
    }
  } else {
    if (ii(f))
      throw new Error(
        'Cannot submit element that is not <form>, <button>, or <input type="submit|image">',
      );
    ((s = ei), (o = null), (h = ai), (S = f));
  }
  return (
    m && h === "text/plain" && ((S = m), (m = void 0)),
    { action: o, method: s.toLowerCase(), encType: h, formData: m, body: S }
  );
}
Object.getOwnPropertyNames(Object.prototype).sort().join("\0");
function Vc(f, r) {
  if (f === !1 || f === null || typeof f > "u") throw new Error(r);
}
function y0(f, r, s, o) {
  let h =
    typeof f == "string"
      ? new URL(
          f,
          typeof window > "u"
            ? "server://singlefetch/"
            : window.location.origin,
        )
      : f;
  return (
    s
      ? h.pathname.endsWith("/")
        ? (h.pathname = `${h.pathname}_.${o}`)
        : (h.pathname = `${h.pathname}.${o}`)
      : h.pathname === "/"
        ? (h.pathname = `_root.${o}`)
        : r && ae(h.pathname, r) === "/"
          ? (h.pathname = `${r.replace(/\/$/, "")}/_root.${o}`)
          : (h.pathname = `${h.pathname.replace(/\/$/, "")}.${o}`),
    h
  );
}
async function v0(f, r) {
  if (f.id in r) return r[f.id];
  try {
    let s = await import(f.module);
    return ((r[f.id] = s), s);
  } catch (s) {
    return (
      console.error(
        `Error loading route module \`${f.module}\`, reloading page...`,
      ),
      console.error(s),
      window.__reactRouterContext && window.__reactRouterContext.isSpaMode,
      window.location.reload(),
      new Promise(() => {})
    );
  }
}
function g0(f) {
  return f == null
    ? !1
    : f.href == null
      ? f.rel === "preload" &&
        typeof f.imageSrcSet == "string" &&
        typeof f.imageSizes == "string"
      : typeof f.rel == "string" && typeof f.href == "string";
}
async function p0(f, r, s) {
  let o = await Promise.all(
    f.map(async (h) => {
      let m = r.routes[h.route.id];
      if (m) {
        let S = await v0(m, s);
        return S.links ? S.links() : [];
      }
      return [];
    }),
  );
  return T0(
    o
      .flat(1)
      .filter(g0)
      .filter((h) => h.rel === "stylesheet" || h.rel === "preload")
      .map((h) =>
        h.rel === "stylesheet"
          ? { ...h, rel: "prefetch", as: "style" }
          : { ...h, rel: "prefetch" },
      ),
  );
}
function oh(f, r, s, o, h, m) {
  let S = (E, v) => (s[v] ? E.route.id !== s[v].route.id : !0),
    M = (E, v) => {
      var U;
      return (
        s[v].pathname !== E.pathname ||
        (((U = s[v].route.path) == null ? void 0 : U.endsWith("*")) &&
          s[v].params["*"] !== E.params["*"])
      );
    };
  return m === "assets"
    ? r.filter((E, v) => S(E, v) || M(E, v))
    : m === "data"
      ? r.filter((E, v) => {
          var A;
          let U = o.routes[E.route.id];
          if (!U || !U.hasLoader) return !1;
          if (S(E, v) || M(E, v)) return !0;
          if (E.route.shouldRevalidate) {
            let H = E.route.shouldRevalidate({
              currentUrl: new URL(
                h.pathname + h.search + h.hash,
                window.origin,
              ),
              currentParams: ((A = s[0]) == null ? void 0 : A.params) || {},
              nextUrl: new URL(f, window.origin),
              nextParams: E.params,
              defaultShouldRevalidate: !0,
            });
            if (typeof H == "boolean") return H;
          }
          return !0;
        })
      : [];
}
function S0(f, r, { includeHydrateFallback: s } = {}) {
  return b0(
    f
      .map((o) => {
        let h = r.routes[o.route.id];
        if (!h) return [];
        let m = [h.module];
        return (
          h.clientActionModule && (m = m.concat(h.clientActionModule)),
          h.clientLoaderModule && (m = m.concat(h.clientLoaderModule)),
          s &&
            h.hydrateFallbackModule &&
            (m = m.concat(h.hydrateFallbackModule)),
          h.imports && (m = m.concat(h.imports)),
          m
        );
      })
      .flat(1),
  );
}
function b0(f) {
  return [...new Set(f)];
}
function E0(f) {
  let r = {},
    s = Object.keys(f).sort();
  for (let o of s) r[o] = f[o];
  return r;
}
function T0(f, r) {
  let s = new Set();
  return (
    new Set(r),
    f.reduce((o, h) => {
      let m = JSON.stringify(E0(h));
      return (s.has(m) || (s.add(m), o.push({ key: m, link: h })), o);
    }, [])
  );
}
function _h() {
  let f = O.useContext(Ba);
  return (
    Vc(
      f,
      "You must render this element inside a <DataRouterContext.Provider> element",
    ),
    f
  );
}
function z0() {
  let f = O.useContext(ni);
  return (
    Vc(
      f,
      "You must render this element inside a <DataRouterStateContext.Provider> element",
    ),
    f
  );
}
var Kc = O.createContext(void 0);
Kc.displayName = "FrameworkContext";
function Ah() {
  let f = O.useContext(Kc);
  return (
    Vc(f, "You must render this element inside a <HydratedRouter> element"),
    f
  );
}
function _0(f, r) {
  let s = O.useContext(Kc),
    [o, h] = O.useState(!1),
    [m, S] = O.useState(!1),
    {
      onFocus: M,
      onBlur: E,
      onMouseEnter: v,
      onMouseLeave: U,
      onTouchStart: A,
    } = r,
    H = O.useRef(null);
  (O.useEffect(() => {
    if ((f === "render" && S(!0), f === "viewport")) {
      let Z = (V) => {
          V.forEach(($) => {
            S($.isIntersecting);
          });
        },
        q = new IntersectionObserver(Z, { threshold: 0.5 });
      return (
        H.current && q.observe(H.current),
        () => {
          q.disconnect();
        }
      );
    }
  }, [f]),
    O.useEffect(() => {
      if (o) {
        let Z = setTimeout(() => {
          S(!0);
        }, 100);
        return () => {
          clearTimeout(Z);
        };
      }
    }, [o]));
  let G = () => {
      h(!0);
    },
    w = () => {
      (h(!1), S(!1));
    };
  return s
    ? f !== "intent"
      ? [m, H, {}]
      : [
          m,
          H,
          {
            onFocus: Nu(M, G),
            onBlur: Nu(E, w),
            onMouseEnter: Nu(v, G),
            onMouseLeave: Nu(U, w),
            onTouchStart: Nu(A, G),
          },
        ]
    : [!1, H, {}];
}
function Nu(f, r) {
  return (s) => {
    (f && f(s), s.defaultPrevented || r(s));
  };
}
function A0({ page: f, ...r }) {
  let { router: s } = _h(),
    o = O.useMemo(() => rh(s.routes, f, s.basename), [s.routes, f, s.basename]);
  return o ? O.createElement(O0, { page: f, matches: o, ...r }) : null;
}
function R0(f) {
  let { manifest: r, routeModules: s } = Ah(),
    [o, h] = O.useState([]);
  return (
    O.useEffect(() => {
      let m = !1;
      return (
        p0(f, r, s).then((S) => {
          m || h(S);
        }),
        () => {
          m = !0;
        }
      );
    }, [f, r, s]),
    o
  );
}
function O0({ page: f, matches: r, ...s }) {
  let o = De(),
    { future: h, manifest: m, routeModules: S } = Ah(),
    { basename: M } = _h(),
    { loaderData: E, matches: v } = z0(),
    U = O.useMemo(() => oh(f, r, v, m, o, "data"), [f, r, v, m, o]),
    A = O.useMemo(() => oh(f, r, v, m, o, "assets"), [f, r, v, m, o]),
    H = O.useMemo(() => {
      if (f === o.pathname + o.search + o.hash) return [];
      let Z = new Set(),
        q = !1;
      if (
        (r.forEach(($) => {
          var St;
          let Y = m.routes[$.route.id];
          !Y ||
            !Y.hasLoader ||
            ((!U.some((mt) => mt.route.id === $.route.id) &&
              $.route.id in E &&
              (St = S[$.route.id]) != null &&
              St.shouldRevalidate) ||
            Y.hasClientLoader
              ? (q = !0)
              : Z.add($.route.id));
        }),
        Z.size === 0)
      )
        return [];
      let V = y0(f, M, h.unstable_trailingSlashAwareDataRequests, "data");
      return (
        q &&
          Z.size > 0 &&
          V.searchParams.set(
            "_routes",
            r
              .filter(($) => Z.has($.route.id))
              .map(($) => $.route.id)
              .join(","),
          ),
        [V.pathname + V.search]
      );
    }, [M, h.unstable_trailingSlashAwareDataRequests, E, o, m, U, r, f, S]),
    G = O.useMemo(() => S0(A, m), [A, m]),
    w = R0(A);
  return O.createElement(
    O.Fragment,
    null,
    H.map((Z) =>
      O.createElement("link", {
        key: Z,
        rel: "prefetch",
        as: "fetch",
        href: Z,
        ...s,
      }),
    ),
    G.map((Z) =>
      O.createElement("link", { key: Z, rel: "modulepreload", href: Z, ...s }),
    ),
    w.map(({ key: Z, link: q }) =>
      O.createElement("link", {
        key: Z,
        nonce: s.nonce,
        ...q,
        crossOrigin: q.crossOrigin ?? s.crossOrigin,
      }),
    ),
  );
}
function M0(...f) {
  return (r) => {
    f.forEach((s) => {
      typeof s == "function" ? s(r) : s != null && (s.current = r);
    });
  };
}
var D0 =
  typeof window < "u" &&
  typeof window.document < "u" &&
  typeof window.document.createElement < "u";
try {
  D0 && (window.__reactRouterVersion = "7.13.0");
} catch {}
function C0({
  basename: f,
  children: r,
  unstable_useTransitions: s,
  window: o,
}) {
  let h = O.useRef();
  h.current == null && (h.current = ov({ window: o, v5Compat: !0 }));
  let m = h.current,
    [S, M] = O.useState({ action: m.action, location: m.location }),
    E = O.useCallback(
      (v) => {
        s === !1 ? M(v) : O.startTransition(() => M(v));
      },
      [s],
    );
  return (
    O.useLayoutEffect(() => m.listen(E), [m, E]),
    O.createElement(n0, {
      basename: f,
      children: r,
      location: S.location,
      navigationType: S.action,
      navigator: m,
      unstable_useTransitions: s,
    })
  );
}
var Rh = /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i,
  Oh = O.forwardRef(function (
    {
      onClick: r,
      discover: s = "render",
      prefetch: o = "none",
      relative: h,
      reloadDocument: m,
      replace: S,
      state: M,
      target: E,
      to: v,
      preventScrollReset: U,
      viewTransition: A,
      unstable_defaultShouldRevalidate: H,
      ...G
    },
    w,
  ) {
    let { basename: Z, unstable_useTransitions: q } = O.useContext(ml),
      V = typeof v == "string" && Rh.test(v),
      $ = mh(v, Z);
    v = $.to;
    let Y = Zv(v, { relative: h }),
      [St, mt, _t] = _0(o, G),
      F = x0(v, {
        replace: S,
        state: M,
        target: E,
        preventScrollReset: U,
        relative: h,
        viewTransition: A,
        unstable_defaultShouldRevalidate: H,
        unstable_useTransitions: q,
      });
    function Dt(yl) {
      (r && r(yl), yl.defaultPrevented || F(yl));
    }
    let Xt = O.createElement("a", {
      ...G,
      ..._t,
      href: $.absoluteURL || Y,
      onClick: $.isExternal || m ? r : Dt,
      ref: M0(w, mt),
      target: E,
      "data-discover": !V && s === "render" ? "true" : void 0,
    });
    return St && !V
      ? O.createElement(O.Fragment, null, Xt, O.createElement(A0, { page: Y }))
      : Xt;
  });
Oh.displayName = "Link";
var Mh = O.forwardRef(function (
  {
    "aria-current": r = "page",
    caseSensitive: s = !1,
    className: o = "",
    end: h = !1,
    style: m,
    to: S,
    viewTransition: M,
    children: E,
    ...v
  },
  U,
) {
  let A = Bu(S, { relative: v.relative }),
    H = De(),
    G = O.useContext(ni),
    { navigator: w, basename: Z } = O.useContext(ml),
    q = G != null && Y0(A) && M === !0,
    V = w.encodeLocation ? w.encodeLocation(A).pathname : A.pathname,
    $ = H.pathname,
    Y =
      G && G.navigation && G.navigation.location
        ? G.navigation.location.pathname
        : null;
  (s ||
    (($ = $.toLowerCase()),
    (Y = Y ? Y.toLowerCase() : null),
    (V = V.toLowerCase())),
    Y && Z && (Y = ae(Y, Z) || Y));
  const St = V !== "/" && V.endsWith("/") ? V.length - 1 : V.length;
  let mt = $ === V || (!h && $.startsWith(V) && $.charAt(St) === "/"),
    _t =
      Y != null &&
      (Y === V || (!h && Y.startsWith(V) && Y.charAt(V.length) === "/")),
    F = { isActive: mt, isPending: _t, isTransitioning: q },
    Dt = mt ? r : void 0,
    Xt;
  typeof o == "function"
    ? (Xt = o(F))
    : (Xt = [
        o,
        mt ? "active" : null,
        _t ? "pending" : null,
        q ? "transitioning" : null,
      ]
        .filter(Boolean)
        .join(" "));
  let yl = typeof m == "function" ? m(F) : m;
  return O.createElement(
    Oh,
    {
      ...v,
      "aria-current": Dt,
      className: Xt,
      ref: U,
      style: yl,
      to: S,
      viewTransition: M,
    },
    typeof E == "function" ? E(F) : E,
  );
});
Mh.displayName = "NavLink";
var U0 = O.forwardRef(
  (
    {
      discover: f = "render",
      fetcherKey: r,
      navigate: s,
      reloadDocument: o,
      replace: h,
      state: m,
      method: S = ei,
      action: M,
      onSubmit: E,
      relative: v,
      preventScrollReset: U,
      viewTransition: A,
      unstable_defaultShouldRevalidate: H,
      ...G
    },
    w,
  ) => {
    let { unstable_useTransitions: Z } = O.useContext(ml),
      q = q0(),
      V = j0(M, { relative: v }),
      $ = S.toLowerCase() === "get" ? "get" : "post",
      Y = typeof M == "string" && Rh.test(M),
      St = (mt) => {
        if ((E && E(mt), mt.defaultPrevented)) return;
        mt.preventDefault();
        let _t = mt.nativeEvent.submitter,
          F = (_t == null ? void 0 : _t.getAttribute("formmethod")) || S,
          Dt = () =>
            q(_t || mt.currentTarget, {
              fetcherKey: r,
              method: F,
              navigate: s,
              replace: h,
              state: m,
              relative: v,
              preventScrollReset: U,
              viewTransition: A,
              unstable_defaultShouldRevalidate: H,
            });
        Z && s !== !1 ? O.startTransition(() => Dt()) : Dt();
      };
    return O.createElement("form", {
      ref: w,
      method: $,
      action: V,
      onSubmit: o ? E : St,
      ...G,
      "data-discover": !Y && f === "render" ? "true" : void 0,
    });
  },
);
U0.displayName = "Form";
function N0(f) {
  return `${f} must be used within a data router.  See https://reactrouter.com/en/main/routers/picking-a-router.`;
}
function Dh(f) {
  let r = O.useContext(Ba);
  return (Rt(r, N0(f)), r);
}
function x0(
  f,
  {
    target: r,
    replace: s,
    state: o,
    preventScrollReset: h,
    relative: m,
    viewTransition: S,
    unstable_defaultShouldRevalidate: M,
    unstable_useTransitions: E,
  } = {},
) {
  let v = bh(),
    U = De(),
    A = Bu(f, { relative: m });
  return O.useCallback(
    (H) => {
      if (s0(H, r)) {
        H.preventDefault();
        let G = s !== void 0 ? s : xu(U) === xu(A),
          w = () =>
            v(f, {
              replace: G,
              state: o,
              preventScrollReset: h,
              relative: m,
              viewTransition: S,
              unstable_defaultShouldRevalidate: M,
            });
        E ? O.startTransition(() => w()) : w();
      }
    },
    [U, v, A, s, o, r, f, h, m, S, M, E],
  );
}
var H0 = 0,
  B0 = () => `__${String(++H0)}__`;
function q0() {
  let { router: f } = Dh("useSubmit"),
    { basename: r } = O.useContext(ml),
    s = t0(),
    o = f.fetch,
    h = f.navigate;
  return O.useCallback(
    async (m, S = {}) => {
      let { action: M, method: E, encType: v, formData: U, body: A } = m0(m, r);
      if (S.navigate === !1) {
        let H = S.fetcherKey || B0();
        await o(H, s, S.action || M, {
          unstable_defaultShouldRevalidate: S.unstable_defaultShouldRevalidate,
          preventScrollReset: S.preventScrollReset,
          formData: U,
          body: A,
          formMethod: S.method || E,
          formEncType: S.encType || v,
          flushSync: S.flushSync,
        });
      } else
        await h(S.action || M, {
          unstable_defaultShouldRevalidate: S.unstable_defaultShouldRevalidate,
          preventScrollReset: S.preventScrollReset,
          formData: U,
          body: A,
          formMethod: S.method || E,
          formEncType: S.encType || v,
          replace: S.replace,
          state: S.state,
          fromRouteId: s,
          flushSync: S.flushSync,
          viewTransition: S.viewTransition,
        });
    },
    [o, h, r, s],
  );
}
function j0(f, { relative: r } = {}) {
  let { basename: s } = O.useContext(ml),
    o = O.useContext(ql);
  Rt(o, "useFormAction must be used inside a RouteContext");
  let [h] = o.matches.slice(-1),
    m = { ...Bu(f || ".", { relative: r }) },
    S = De();
  if (f == null) {
    m.search = S.search;
    let M = new URLSearchParams(m.search),
      E = M.getAll("index");
    if (E.some((U) => U === "")) {
      (M.delete("index"),
        E.filter((A) => A).forEach((A) => M.append("index", A)));
      let U = M.toString();
      m.search = U ? `?${U}` : "";
    }
  }
  return (
    (!f || f === ".") &&
      h.route.index &&
      (m.search = m.search ? m.search.replace(/^\?/, "?index&") : "?index"),
    s !== "/" && (m.pathname = m.pathname === "/" ? s : ee([s, m.pathname])),
    xu(m)
  );
}
function Y0(f, { relative: r } = {}) {
  let s = O.useContext(vh);
  Rt(
    s != null,
    "`useViewTransitionState` must be used within `react-router-dom`'s `RouterProvider`.  Did you accidentally import `RouterProvider` from `react-router`?",
  );
  let { basename: o } = Dh("useViewTransitionState"),
    h = Bu(f, { relative: r });
  if (!s.isTransitioning) return !1;
  let m = ae(s.currentLocation.pathname, o) || s.currentLocation.pathname,
    S = ae(s.nextLocation.pathname, o) || s.nextLocation.pathname;
  return ui(h.pathname, S) != null || ui(h.pathname, m) != null;
}
async function L0() {
  const f = await fetch("/api/config");
  if (!f.ok) throw new Error("Failed to load config");
  return f.json();
}
async function G0(f) {
  const r = await fetch("/api/config", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(f),
  });
  if (!r.ok) throw new Error("Failed to save config");
  return r.json();
}
async function X0(f, r) {
  const s = await fetch("/api/test-plex", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ plex_url: f, plex_token: r }),
  });
  if (!s.ok) throw new Error("Failed to test connection");
  return s.json();
}
const Q0 = "_heading_14619_1",
  Z0 = "_toast_14619_6",
  V0 = "_success_14619_13",
  K0 = "_error_14619_18",
  J0 = "_form_14619_23",
  w0 = "_group_14619_29",
  $0 = "_groupTitle_14619_38",
  W0 = "_field_14619_45",
  k0 = "_label_14619_51",
  F0 = "_input_14619_56",
  I0 = "_button_14619_70",
  P0 = "_buttonSecondary_14619_92",
  xt = {
    heading: Q0,
    toast: Z0,
    success: V0,
    error: K0,
    form: J0,
    group: w0,
    groupTitle: $0,
    field: W0,
    label: k0,
    input: F0,
    button: I0,
    buttonSecondary: P0,
  };
function tg() {
  const [f, r] = O.useState({}),
    [s, o] = O.useState(null),
    [h, m] = O.useState(null),
    [S, M] = O.useState(!0),
    [E, v] = O.useState(!1),
    [U, A] = O.useState(!1);
  O.useEffect(() => {
    L0()
      .then(r)
      .catch(() => o({ type: "error", msg: "Failed to load settings" }))
      .finally(() => M(!1));
  }, []);
  const H = (q, V) => r({ ...f, [q]: V }),
    G = async (q, V) => {
      if ((m(null), !q || !V))
        return (
          m({ type: "error", msg: "Both URL and token are required" }),
          !1
        );
      v(!0);
      try {
        const $ = await X0(q, V);
        return $.ok
          ? (m({ type: "success", msg: `Connected to "${$.serverName}"` }), !0)
          : (m({ type: "error", msg: $.error }), !1);
      } catch {
        return (m({ type: "error", msg: "Connection test failed" }), !1);
      } finally {
        v(!1);
      }
    },
    w = () => {
      G(f.plex_url, f.plex_token);
    },
    Z = async (q) => {
      (q.preventDefault(), o(null), A(!0));
      try {
        if (!(await G(f.plex_url, f.plex_token))) {
          (o({
            type: "error",
            msg: "Plex connection failed — settings not saved",
          }),
            A(!1));
          return;
        }
        (await G0({
          plex_url: f.plex_url || "",
          plex_token: f.plex_token || "",
          anthropic_api_key: f.anthropic_api_key || "",
        }),
          o({ type: "success", msg: "Settings saved" }));
      } catch {
        o({ type: "error", msg: "Failed to save settings" });
      } finally {
        A(!1);
      }
    };
  return S
    ? ft.jsx("p", { children: "Loading..." })
    : ft.jsxs("div", {
        children: [
          ft.jsx("h2", { className: xt.heading, children: "Settings" }),
          s &&
            ft.jsx("div", {
              className: `${xt.toast} ${xt[s.type]}`,
              children: s.msg,
            }),
          ft.jsxs("form", {
            onSubmit: Z,
            className: xt.form,
            children: [
              ft.jsxs("fieldset", {
                className: xt.group,
                children: [
                  ft.jsx("legend", {
                    className: xt.groupTitle,
                    children: "Plex",
                  }),
                  ft.jsxs("label", {
                    className: xt.field,
                    children: [
                      ft.jsx("span", {
                        className: xt.label,
                        children: "Plex URL",
                      }),
                      ft.jsx("input", {
                        type: "text",
                        className: xt.input,
                        placeholder: "http://localhost:32400",
                        value: f.plex_url || "",
                        onChange: (q) => H("plex_url", q.target.value),
                      }),
                    ],
                  }),
                  ft.jsxs("label", {
                    className: xt.field,
                    children: [
                      ft.jsx("span", {
                        className: xt.label,
                        children: "Plex Token",
                      }),
                      ft.jsx("input", {
                        type: "password",
                        className: xt.input,
                        placeholder: "Enter token",
                        value: f.plex_token || "",
                        onChange: (q) => H("plex_token", q.target.value),
                      }),
                    ],
                  }),
                  h &&
                    ft.jsx("div", {
                      className: `${xt.toast} ${xt[h.type]}`,
                      children: h.msg,
                    }),
                  ft.jsx("button", {
                    type: "button",
                    className: xt.buttonSecondary,
                    onClick: w,
                    disabled: E,
                    children: E ? "Testing..." : "Test Connection",
                  }),
                ],
              }),
              ft.jsxs("fieldset", {
                className: xt.group,
                children: [
                  ft.jsx("legend", {
                    className: xt.groupTitle,
                    children: "AI",
                  }),
                  ft.jsxs("label", {
                    className: xt.field,
                    children: [
                      ft.jsx("span", {
                        className: xt.label,
                        children: "AI Token",
                      }),
                      ft.jsx("input", {
                        type: "password",
                        className: xt.input,
                        placeholder: "Enter API key",
                        value: f.anthropic_api_key || "",
                        onChange: (q) => H("anthropic_api_key", q.target.value),
                      }),
                    ],
                  }),
                ],
              }),
              ft.jsx("button", {
                type: "submit",
                className: xt.button,
                disabled: U,
                children: U ? "Saving..." : "Save",
              }),
            ],
          }),
        ],
      });
}
function lg() {
  return ft.jsxs("div", {
    className: "layout",
    children: [
      ft.jsxs("aside", {
        className: "sidebar",
        children: [
          ft.jsx("h1", { className: "sidebar-title", children: "Tinkerbell" }),
          ft.jsx("nav", {
            children: ft.jsx(Mh, {
              to: "/settings",
              className: "nav-link",
              children: "Settings",
            }),
          }),
        ],
      }),
      ft.jsx("main", {
        className: "content",
        children: ft.jsxs(i0, {
          children: [
            ft.jsx(qc, { path: "/settings", element: ft.jsx(tg, {}) }),
            ft.jsx(qc, {
              path: "*",
              element: ft.jsx(u0, { to: "/settings", replace: !0 }),
            }),
          ],
        }),
      }),
    ],
  });
}
cv.createRoot(document.getElementById("root")).render(
  ft.jsx(O.StrictMode, { children: ft.jsx(C0, { children: ft.jsx(lg, {}) }) }),
);
