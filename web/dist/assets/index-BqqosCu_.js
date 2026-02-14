(function () {
  const r = document.createElement("link").relList;
  if (r && r.supports && r.supports("modulepreload")) return;
  for (const h of document.querySelectorAll('link[rel="modulepreload"]')) o(h);
  new MutationObserver((h) => {
    for (const y of h)
      if (y.type === "childList")
        for (const S of y.addedNodes)
          S.tagName === "LINK" && S.rel === "modulepreload" && o(S);
  }).observe(document, { childList: !0, subtree: !0 });
  function s(h) {
    const y = {};
    return (
      h.integrity && (y.integrity = h.integrity),
      h.referrerPolicy && (y.referrerPolicy = h.referrerPolicy),
      h.crossOrigin === "use-credentials"
        ? (y.credentials = "include")
        : h.crossOrigin === "anonymous"
          ? (y.credentials = "omit")
          : (y.credentials = "same-origin"),
      y
    );
  }
  function o(h) {
    if (h.ep) return;
    h.ep = !0;
    const y = s(h);
    fetch(h.href, y);
  }
})();
var Rc = { exports: {} },
  Uu = {};
/**
 * @license React
 * react-jsx-runtime.production.js
 *
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */ var $d;
function tv() {
  if ($d) return Uu;
  $d = 1;
  var f = Symbol.for("react.transitional.element"),
    r = Symbol.for("react.fragment");
  function s(o, h, y) {
    var S = null;
    if (
      (y !== void 0 && (S = "" + y),
      h.key !== void 0 && (S = "" + h.key),
      "key" in h)
    ) {
      y = {};
      for (var R in h) R !== "key" && (y[R] = h[R]);
    } else y = h;
    return (
      (h = y.ref),
      { $$typeof: f, type: o, key: S, ref: h !== void 0 ? h : null, props: y }
    );
  }
  return ((Uu.Fragment = r), (Uu.jsx = s), (Uu.jsxs = s), Uu);
}
var Wd;
function lv() {
  return (Wd || ((Wd = 1), (Rc.exports = tv())), Rc.exports);
}
var Rt = lv(),
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
function ev() {
  if (kd) return k;
  kd = 1;
  var f = Symbol.for("react.transitional.element"),
    r = Symbol.for("react.portal"),
    s = Symbol.for("react.fragment"),
    o = Symbol.for("react.strict_mode"),
    h = Symbol.for("react.profiler"),
    y = Symbol.for("react.consumer"),
    S = Symbol.for("react.context"),
    R = Symbol.for("react.forward_ref"),
    b = Symbol.for("react.suspense"),
    v = Symbol.for("react.memo"),
    N = Symbol.for("react.lazy"),
    _ = Symbol.for("react.activity"),
    x = Symbol.iterator;
  function G(g) {
    return g === null || typeof g != "object"
      ? null
      : ((g = (x && g[x]) || g["@@iterator"]),
        typeof g == "function" ? g : null);
  }
  var $ = {
      isMounted: function () {
        return !1;
      },
      enqueueForceUpdate: function () {},
      enqueueReplaceState: function () {},
      enqueueSetState: function () {},
    },
    Z = Object.assign,
    Q = {};
  function K(g, H, q) {
    ((this.props = g),
      (this.context = H),
      (this.refs = Q),
      (this.updater = q || $));
  }
  ((K.prototype.isReactComponent = {}),
    (K.prototype.setState = function (g, H) {
      if (typeof g != "object" && typeof g != "function" && g != null)
        throw Error(
          "takes an object of state variables to update or a function which returns an object of state variables.",
        );
      this.updater.enqueueSetState(this, g, H, "setState");
    }),
    (K.prototype.forceUpdate = function (g) {
      this.updater.enqueueForceUpdate(this, g, "forceUpdate");
    }));
  function W() {}
  W.prototype = K.prototype;
  function Y(g, H, q) {
    ((this.props = g),
      (this.context = H),
      (this.refs = Q),
      (this.updater = q || $));
  }
  var pt = (Y.prototype = new W());
  ((pt.constructor = Y), Z(pt, K.prototype), (pt.isPureReactComponent = !0));
  var ht = Array.isArray;
  function zt() {}
  var F = { H: null, A: null, T: null, S: null },
    Dt = Object.prototype.hasOwnProperty;
  function Gt(g, H, q) {
    var L = q.ref;
    return {
      $$typeof: f,
      type: g,
      key: H,
      ref: L !== void 0 ? L : null,
      props: q,
    };
  }
  function ml(g, H) {
    return Gt(g.type, H, g.props);
  }
  function Ul(g) {
    return typeof g == "object" && g !== null && g.$$typeof === f;
  }
  function Wt(g) {
    var H = { "=": "=0", ":": "=2" };
    return (
      "$" +
      g.replace(/[=:]/g, function (q) {
        return H[q];
      })
    );
  }
  var Ue = /\/+/g;
  function ql(g, H) {
    return typeof g == "object" && g !== null && g.key != null
      ? Wt("" + g.key)
      : H.toString(36);
  }
  function _l(g) {
    switch (g.status) {
      case "fulfilled":
        return g.value;
      case "rejected":
        throw g.reason;
      default:
        switch (
          (typeof g.status == "string"
            ? g.then(zt, zt)
            : ((g.status = "pending"),
              g.then(
                function (H) {
                  g.status === "pending" &&
                    ((g.status = "fulfilled"), (g.value = H));
                },
                function (H) {
                  g.status === "pending" &&
                    ((g.status = "rejected"), (g.reason = H));
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
  function D(g, H, q, L, I) {
    var lt = typeof g;
    (lt === "undefined" || lt === "boolean") && (g = null);
    var rt = !1;
    if (g === null) rt = !0;
    else
      switch (lt) {
        case "bigint":
        case "string":
        case "number":
          rt = !0;
          break;
        case "object":
          switch (g.$$typeof) {
            case f:
            case r:
              rt = !0;
              break;
            case N:
              return ((rt = g._init), D(rt(g._payload), H, q, L, I));
          }
      }
    if (rt)
      return (
        (I = I(g)),
        (rt = L === "" ? "." + ql(g, 0) : L),
        ht(I)
          ? ((q = ""),
            rt != null && (q = rt.replace(Ue, "$&/") + "/"),
            D(I, H, q, "", function (Ya) {
              return Ya;
            }))
          : I != null &&
            (Ul(I) &&
              (I = ml(
                I,
                q +
                  (I.key == null || (g && g.key === I.key)
                    ? ""
                    : ("" + I.key).replace(Ue, "$&/") + "/") +
                  rt,
              )),
            H.push(I)),
        1
      );
    rt = 0;
    var wt = L === "" ? "." : L + ":";
    if (ht(g))
      for (var Ut = 0; Ut < g.length; Ut++)
        ((L = g[Ut]), (lt = wt + ql(L, Ut)), (rt += D(L, H, q, lt, I)));
    else if (((Ut = G(g)), typeof Ut == "function"))
      for (g = Ut.call(g), Ut = 0; !(L = g.next()).done; )
        ((L = L.value), (lt = wt + ql(L, Ut++)), (rt += D(L, H, q, lt, I)));
    else if (lt === "object") {
      if (typeof g.then == "function") return D(_l(g), H, q, L, I);
      throw (
        (H = String(g)),
        Error(
          "Objects are not valid as a React child (found: " +
            (H === "[object Object]"
              ? "object with keys {" + Object.keys(g).join(", ") + "}"
              : H) +
            "). If you meant to render a collection of children, use an array instead.",
        )
      );
    }
    return rt;
  }
  function B(g, H, q) {
    if (g == null) return g;
    var L = [],
      I = 0;
    return (
      D(g, L, "", "", function (lt) {
        return H.call(q, lt, I++);
      }),
      L
    );
  }
  function w(g) {
    if (g._status === -1) {
      var H = g._result;
      ((H = H()),
        H.then(
          function (q) {
            (g._status === 0 || g._status === -1) &&
              ((g._status = 1), (g._result = q));
          },
          function (q) {
            (g._status === 0 || g._status === -1) &&
              ((g._status = 2), (g._result = q));
          },
        ),
        g._status === -1 && ((g._status = 0), (g._result = H)));
    }
    if (g._status === 1) return g._result.default;
    throw g._result;
  }
  var mt =
      typeof reportError == "function"
        ? reportError
        : function (g) {
            if (
              typeof window == "object" &&
              typeof window.ErrorEvent == "function"
            ) {
              var H = new window.ErrorEvent("error", {
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
              if (!window.dispatchEvent(H)) return;
            } else if (
              typeof process == "object" &&
              typeof process.emit == "function"
            ) {
              process.emit("uncaughtException", g);
              return;
            }
            console.error(g);
          },
    St = {
      map: B,
      forEach: function (g, H, q) {
        B(
          g,
          function () {
            H.apply(this, arguments);
          },
          q,
        );
      },
      count: function (g) {
        var H = 0;
        return (
          B(g, function () {
            H++;
          }),
          H
        );
      },
      toArray: function (g) {
        return (
          B(g, function (H) {
            return H;
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
    (k.Activity = _),
    (k.Children = St),
    (k.Component = K),
    (k.Fragment = s),
    (k.Profiler = h),
    (k.PureComponent = Y),
    (k.StrictMode = o),
    (k.Suspense = b),
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
    (k.cloneElement = function (g, H, q) {
      if (g == null)
        throw Error(
          "The argument must be a React element, but you passed " + g + ".",
        );
      var L = Z({}, g.props),
        I = g.key;
      if (H != null)
        for (lt in (H.key !== void 0 && (I = "" + H.key), H))
          !Dt.call(H, lt) ||
            lt === "key" ||
            lt === "__self" ||
            lt === "__source" ||
            (lt === "ref" && H.ref === void 0) ||
            (L[lt] = H[lt]);
      var lt = arguments.length - 2;
      if (lt === 1) L.children = q;
      else if (1 < lt) {
        for (var rt = Array(lt), wt = 0; wt < lt; wt++)
          rt[wt] = arguments[wt + 2];
        L.children = rt;
      }
      return Gt(g.type, I, L);
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
        (g.Consumer = { $$typeof: y, _context: g }),
        g
      );
    }),
    (k.createElement = function (g, H, q) {
      var L,
        I = {},
        lt = null;
      if (H != null)
        for (L in (H.key !== void 0 && (lt = "" + H.key), H))
          Dt.call(H, L) &&
            L !== "key" &&
            L !== "__self" &&
            L !== "__source" &&
            (I[L] = H[L]);
      var rt = arguments.length - 2;
      if (rt === 1) I.children = q;
      else if (1 < rt) {
        for (var wt = Array(rt), Ut = 0; Ut < rt; Ut++)
          wt[Ut] = arguments[Ut + 2];
        I.children = wt;
      }
      if (g && g.defaultProps)
        for (L in ((rt = g.defaultProps), rt))
          I[L] === void 0 && (I[L] = rt[L]);
      return Gt(g, lt, I);
    }),
    (k.createRef = function () {
      return { current: null };
    }),
    (k.forwardRef = function (g) {
      return { $$typeof: R, render: g };
    }),
    (k.isValidElement = Ul),
    (k.lazy = function (g) {
      return { $$typeof: N, _payload: { _status: -1, _result: g }, _init: w };
    }),
    (k.memo = function (g, H) {
      return { $$typeof: v, type: g, compare: H === void 0 ? null : H };
    }),
    (k.startTransition = function (g) {
      var H = F.T,
        q = {};
      F.T = q;
      try {
        var L = g(),
          I = F.S;
        (I !== null && I(q, L),
          typeof L == "object" &&
            L !== null &&
            typeof L.then == "function" &&
            L.then(zt, mt));
      } catch (lt) {
        mt(lt);
      } finally {
        (H !== null && q.types !== null && (H.types = q.types), (F.T = H));
      }
    }),
    (k.unstable_useCacheRefresh = function () {
      return F.H.useCacheRefresh();
    }),
    (k.use = function (g) {
      return F.H.use(g);
    }),
    (k.useActionState = function (g, H, q) {
      return F.H.useActionState(g, H, q);
    }),
    (k.useCallback = function (g, H) {
      return F.H.useCallback(g, H);
    }),
    (k.useContext = function (g) {
      return F.H.useContext(g);
    }),
    (k.useDebugValue = function () {}),
    (k.useDeferredValue = function (g, H) {
      return F.H.useDeferredValue(g, H);
    }),
    (k.useEffect = function (g, H) {
      return F.H.useEffect(g, H);
    }),
    (k.useEffectEvent = function (g) {
      return F.H.useEffectEvent(g);
    }),
    (k.useId = function () {
      return F.H.useId();
    }),
    (k.useImperativeHandle = function (g, H, q) {
      return F.H.useImperativeHandle(g, H, q);
    }),
    (k.useInsertionEffect = function (g, H) {
      return F.H.useInsertionEffect(g, H);
    }),
    (k.useLayoutEffect = function (g, H) {
      return F.H.useLayoutEffect(g, H);
    }),
    (k.useMemo = function (g, H) {
      return F.H.useMemo(g, H);
    }),
    (k.useOptimistic = function (g, H) {
      return F.H.useOptimistic(g, H);
    }),
    (k.useReducer = function (g, H, q) {
      return F.H.useReducer(g, H, q);
    }),
    (k.useRef = function (g) {
      return F.H.useRef(g);
    }),
    (k.useState = function (g) {
      return F.H.useState(g);
    }),
    (k.useSyncExternalStore = function (g, H, q) {
      return F.H.useSyncExternalStore(g, H, q);
    }),
    (k.useTransition = function () {
      return F.H.useTransition();
    }),
    (k.version = "19.2.4"),
    k
  );
}
var Fd;
function jc() {
  return (Fd || ((Fd = 1), (Oc.exports = ev())), Oc.exports);
}
var M = jc(),
  Mc = { exports: {} },
  Cu = {},
  Dc = { exports: {} },
  Uc = {};
/**
 * @license React
 * scheduler.production.js
 *
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */ var Id;
function av() {
  return (
    Id ||
      ((Id = 1),
      (function (f) {
        function r(D, B) {
          var w = D.length;
          D.push(B);
          t: for (; 0 < w; ) {
            var mt = (w - 1) >>> 1,
              St = D[mt];
            if (0 < h(St, B)) ((D[mt] = B), (D[w] = St), (w = mt));
            else break t;
          }
        }
        function s(D) {
          return D.length === 0 ? null : D[0];
        }
        function o(D) {
          if (D.length === 0) return null;
          var B = D[0],
            w = D.pop();
          if (w !== B) {
            D[0] = w;
            t: for (var mt = 0, St = D.length, g = St >>> 1; mt < g; ) {
              var H = 2 * (mt + 1) - 1,
                q = D[H],
                L = H + 1,
                I = D[L];
              if (0 > h(q, w))
                L < St && 0 > h(I, q)
                  ? ((D[mt] = I), (D[L] = w), (mt = L))
                  : ((D[mt] = q), (D[H] = w), (mt = H));
              else if (L < St && 0 > h(I, w))
                ((D[mt] = I), (D[L] = w), (mt = L));
              else break t;
            }
          }
          return B;
        }
        function h(D, B) {
          var w = D.sortIndex - B.sortIndex;
          return w !== 0 ? w : D.id - B.id;
        }
        if (
          ((f.unstable_now = void 0),
          typeof performance == "object" &&
            typeof performance.now == "function")
        ) {
          var y = performance;
          f.unstable_now = function () {
            return y.now();
          };
        } else {
          var S = Date,
            R = S.now();
          f.unstable_now = function () {
            return S.now() - R;
          };
        }
        var b = [],
          v = [],
          N = 1,
          _ = null,
          x = 3,
          G = !1,
          $ = !1,
          Z = !1,
          Q = !1,
          K = typeof setTimeout == "function" ? setTimeout : null,
          W = typeof clearTimeout == "function" ? clearTimeout : null,
          Y = typeof setImmediate < "u" ? setImmediate : null;
        function pt(D) {
          for (var B = s(v); B !== null; ) {
            if (B.callback === null) o(v);
            else if (B.startTime <= D)
              (o(v), (B.sortIndex = B.expirationTime), r(b, B));
            else break;
            B = s(v);
          }
        }
        function ht(D) {
          if (((Z = !1), pt(D), !$))
            if (s(b) !== null) (($ = !0), zt || ((zt = !0), Wt()));
            else {
              var B = s(v);
              B !== null && _l(ht, B.startTime - D);
            }
        }
        var zt = !1,
          F = -1,
          Dt = 5,
          Gt = -1;
        function ml() {
          return Q ? !0 : !(f.unstable_now() - Gt < Dt);
        }
        function Ul() {
          if (((Q = !1), zt)) {
            var D = f.unstable_now();
            Gt = D;
            var B = !0;
            try {
              t: {
                (($ = !1), Z && ((Z = !1), W(F), (F = -1)), (G = !0));
                var w = x;
                try {
                  l: {
                    for (
                      pt(D), _ = s(b);
                      _ !== null && !(_.expirationTime > D && ml());
                    ) {
                      var mt = _.callback;
                      if (typeof mt == "function") {
                        ((_.callback = null), (x = _.priorityLevel));
                        var St = mt(_.expirationTime <= D);
                        if (((D = f.unstable_now()), typeof St == "function")) {
                          ((_.callback = St), pt(D), (B = !0));
                          break l;
                        }
                        (_ === s(b) && o(b), pt(D));
                      } else o(b);
                      _ = s(b);
                    }
                    if (_ !== null) B = !0;
                    else {
                      var g = s(v);
                      (g !== null && _l(ht, g.startTime - D), (B = !1));
                    }
                  }
                  break t;
                } finally {
                  ((_ = null), (x = w), (G = !1));
                }
                B = void 0;
              }
            } finally {
              B ? Wt() : (zt = !1);
            }
          }
        }
        var Wt;
        if (typeof Y == "function")
          Wt = function () {
            Y(Ul);
          };
        else if (typeof MessageChannel < "u") {
          var Ue = new MessageChannel(),
            ql = Ue.port2;
          ((Ue.port1.onmessage = Ul),
            (Wt = function () {
              ql.postMessage(null);
            }));
        } else
          Wt = function () {
            K(Ul, 0);
          };
        function _l(D, B) {
          F = K(function () {
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
            return x;
          }),
          (f.unstable_next = function (D) {
            switch (x) {
              case 1:
              case 2:
              case 3:
                var B = 3;
                break;
              default:
                B = x;
            }
            var w = x;
            x = B;
            try {
              return D();
            } finally {
              x = w;
            }
          }),
          (f.unstable_requestPaint = function () {
            Q = !0;
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
            var w = x;
            x = D;
            try {
              return B();
            } finally {
              x = w;
            }
          }),
          (f.unstable_scheduleCallback = function (D, B, w) {
            var mt = f.unstable_now();
            switch (
              (typeof w == "object" && w !== null
                ? ((w = w.delay),
                  (w = typeof w == "number" && 0 < w ? mt + w : mt))
                : (w = mt),
              D)
            ) {
              case 1:
                var St = -1;
                break;
              case 2:
                St = 250;
                break;
              case 5:
                St = 1073741823;
                break;
              case 4:
                St = 1e4;
                break;
              default:
                St = 5e3;
            }
            return (
              (St = w + St),
              (D = {
                id: N++,
                callback: B,
                priorityLevel: D,
                startTime: w,
                expirationTime: St,
                sortIndex: -1,
              }),
              w > mt
                ? ((D.sortIndex = w),
                  r(v, D),
                  s(b) === null &&
                    D === s(v) &&
                    (Z ? (W(F), (F = -1)) : (Z = !0), _l(ht, w - mt)))
                : ((D.sortIndex = St),
                  r(b, D),
                  $ || G || (($ = !0), zt || ((zt = !0), Wt()))),
              D
            );
          }),
          (f.unstable_shouldYield = ml),
          (f.unstable_wrapCallback = function (D) {
            var B = x;
            return function () {
              var w = x;
              x = B;
              try {
                return D.apply(this, arguments);
              } finally {
                x = w;
              }
            };
          }));
      })(Uc)),
    Uc
  );
}
var Pd;
function uv() {
  return (Pd || ((Pd = 1), (Dc.exports = av())), Dc.exports);
}
var Cc = { exports: {} },
  Jt = {};
/**
 * @license React
 * react-dom.production.js
 *
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */ var th;
function nv() {
  if (th) return Jt;
  th = 1;
  var f = jc();
  function r(b) {
    var v = "https://react.dev/errors/" + b;
    if (1 < arguments.length) {
      v += "?args[]=" + encodeURIComponent(arguments[1]);
      for (var N = 2; N < arguments.length; N++)
        v += "&args[]=" + encodeURIComponent(arguments[N]);
    }
    return (
      "Minified React error #" +
      b +
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
  function y(b, v, N) {
    var _ =
      3 < arguments.length && arguments[3] !== void 0 ? arguments[3] : null;
    return {
      $$typeof: h,
      key: _ == null ? null : "" + _,
      children: b,
      containerInfo: v,
      implementation: N,
    };
  }
  var S = f.__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE;
  function R(b, v) {
    if (b === "font") return "";
    if (typeof v == "string") return v === "use-credentials" ? v : "";
  }
  return (
    (Jt.__DOM_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE = o),
    (Jt.createPortal = function (b, v) {
      var N =
        2 < arguments.length && arguments[2] !== void 0 ? arguments[2] : null;
      if (!v || (v.nodeType !== 1 && v.nodeType !== 9 && v.nodeType !== 11))
        throw Error(r(299));
      return y(b, v, null, N);
    }),
    (Jt.flushSync = function (b) {
      var v = S.T,
        N = o.p;
      try {
        if (((S.T = null), (o.p = 2), b)) return b();
      } finally {
        ((S.T = v), (o.p = N), o.d.f());
      }
    }),
    (Jt.preconnect = function (b, v) {
      typeof b == "string" &&
        (v
          ? ((v = v.crossOrigin),
            (v =
              typeof v == "string"
                ? v === "use-credentials"
                  ? v
                  : ""
                : void 0))
          : (v = null),
        o.d.C(b, v));
    }),
    (Jt.prefetchDNS = function (b) {
      typeof b == "string" && o.d.D(b);
    }),
    (Jt.preinit = function (b, v) {
      if (typeof b == "string" && v && typeof v.as == "string") {
        var N = v.as,
          _ = R(N, v.crossOrigin),
          x = typeof v.integrity == "string" ? v.integrity : void 0,
          G = typeof v.fetchPriority == "string" ? v.fetchPriority : void 0;
        N === "style"
          ? o.d.S(b, typeof v.precedence == "string" ? v.precedence : void 0, {
              crossOrigin: _,
              integrity: x,
              fetchPriority: G,
            })
          : N === "script" &&
            o.d.X(b, {
              crossOrigin: _,
              integrity: x,
              fetchPriority: G,
              nonce: typeof v.nonce == "string" ? v.nonce : void 0,
            });
      }
    }),
    (Jt.preinitModule = function (b, v) {
      if (typeof b == "string")
        if (typeof v == "object" && v !== null) {
          if (v.as == null || v.as === "script") {
            var N = R(v.as, v.crossOrigin);
            o.d.M(b, {
              crossOrigin: N,
              integrity: typeof v.integrity == "string" ? v.integrity : void 0,
              nonce: typeof v.nonce == "string" ? v.nonce : void 0,
            });
          }
        } else v == null && o.d.M(b);
    }),
    (Jt.preload = function (b, v) {
      if (
        typeof b == "string" &&
        typeof v == "object" &&
        v !== null &&
        typeof v.as == "string"
      ) {
        var N = v.as,
          _ = R(N, v.crossOrigin);
        o.d.L(b, N, {
          crossOrigin: _,
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
    (Jt.preloadModule = function (b, v) {
      if (typeof b == "string")
        if (v) {
          var N = R(v.as, v.crossOrigin);
          o.d.m(b, {
            as: typeof v.as == "string" && v.as !== "script" ? v.as : void 0,
            crossOrigin: N,
            integrity: typeof v.integrity == "string" ? v.integrity : void 0,
          });
        } else o.d.m(b);
    }),
    (Jt.requestFormReset = function (b) {
      o.d.r(b);
    }),
    (Jt.unstable_batchedUpdates = function (b, v) {
      return b(v);
    }),
    (Jt.useFormState = function (b, v, N) {
      return S.H.useFormState(b, v, N);
    }),
    (Jt.useFormStatus = function () {
      return S.H.useHostTransitionStatus();
    }),
    (Jt.version = "19.2.4"),
    Jt
  );
}
var lh;
function iv() {
  if (lh) return Cc.exports;
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
  return (f(), (Cc.exports = nv()), Cc.exports);
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
function fv() {
  if (eh) return Cu;
  eh = 1;
  var f = uv(),
    r = jc(),
    s = iv();
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
  function y(t) {
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
  function R(t) {
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
  function b(t) {
    if (y(t) !== t) throw Error(o(188));
  }
  function v(t) {
    var l = t.alternate;
    if (!l) {
      if (((l = y(t)), l === null)) throw Error(o(188));
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
          if (n === e) return (b(u), t);
          if (n === a) return (b(u), l);
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
  function N(t) {
    var l = t.tag;
    if (l === 5 || l === 26 || l === 27 || l === 6) return t;
    for (t = t.child; t !== null; ) {
      if (((l = N(t)), l !== null)) return l;
      t = t.sibling;
    }
    return null;
  }
  var _ = Object.assign,
    x = Symbol.for("react.element"),
    G = Symbol.for("react.transitional.element"),
    $ = Symbol.for("react.portal"),
    Z = Symbol.for("react.fragment"),
    Q = Symbol.for("react.strict_mode"),
    K = Symbol.for("react.profiler"),
    W = Symbol.for("react.consumer"),
    Y = Symbol.for("react.context"),
    pt = Symbol.for("react.forward_ref"),
    ht = Symbol.for("react.suspense"),
    zt = Symbol.for("react.suspense_list"),
    F = Symbol.for("react.memo"),
    Dt = Symbol.for("react.lazy"),
    Gt = Symbol.for("react.activity"),
    ml = Symbol.for("react.memo_cache_sentinel"),
    Ul = Symbol.iterator;
  function Wt(t) {
    return t === null || typeof t != "object"
      ? null
      : ((t = (Ul && t[Ul]) || t["@@iterator"]),
        typeof t == "function" ? t : null);
  }
  var Ue = Symbol.for("react.client.reference");
  function ql(t) {
    if (t == null) return null;
    if (typeof t == "function")
      return t.$$typeof === Ue ? null : t.displayName || t.name || null;
    if (typeof t == "string") return t;
    switch (t) {
      case Z:
        return "Fragment";
      case K:
        return "Profiler";
      case Q:
        return "StrictMode";
      case ht:
        return "Suspense";
      case zt:
        return "SuspenseList";
      case Gt:
        return "Activity";
    }
    if (typeof t == "object")
      switch (t.$$typeof) {
        case $:
          return "Portal";
        case Y:
          return t.displayName || "Context";
        case W:
          return (t._context.displayName || "Context") + ".Consumer";
        case pt:
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
            l !== null ? l : ql(t.type) || "Memo"
          );
        case Dt:
          ((l = t._payload), (t = t._init));
          try {
            return ql(t(l));
          } catch {}
      }
    return null;
  }
  var _l = Array.isArray,
    D = r.__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE,
    B = s.__DOM_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE,
    w = { pending: !1, data: null, method: null, action: null },
    mt = [],
    St = -1;
  function g(t) {
    return { current: t };
  }
  function H(t) {
    0 > St || ((t.current = mt[St]), (mt[St] = null), St--);
  }
  function q(t, l) {
    (St++, (mt[St] = t.current), (t.current = l));
  }
  var L = g(null),
    I = g(null),
    lt = g(null),
    rt = g(null);
  function wt(t, l) {
    switch ((q(lt, l), q(I, t), q(L, null), l.nodeType)) {
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
    (H(L), q(L, t));
  }
  function Ut() {
    (H(L), H(I), H(lt));
  }
  function Ya(t) {
    t.memoizedState !== null && q(rt, t);
    var l = L.current,
      e = pd(l, t.type);
    l !== e && (q(I, t), q(L, e));
  }
  function qu(t) {
    (I.current === t && (H(L), H(I)),
      rt.current === t && (H(rt), (Ru._currentValue = w)));
  }
  var fi, Jc;
  function Ce(t) {
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
              var C = function () {
                throw Error();
              };
              if (
                (Object.defineProperty(C.prototype, "props", {
                  set: function () {
                    throw Error();
                  },
                }),
                typeof Reflect == "object" && Reflect.construct)
              ) {
                try {
                  Reflect.construct(C, []);
                } catch (A) {
                  var z = A;
                }
                Reflect.construct(t, [], C);
              } else {
                try {
                  C.call();
                } catch (A) {
                  z = A;
                }
                t.call(C.prototype);
              }
            } else {
              try {
                throw Error();
              } catch (A) {
                z = A;
              }
              (C = t()) &&
                typeof C.catch == "function" &&
                C.catch(function () {});
            }
          } catch (A) {
            if (A && z && typeof A.stack == "string") return [A.stack, z.stack];
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
                  var O =
                    `
` + d[a].replace(" at new ", " at ");
                  return (
                    t.displayName &&
                      O.includes("<anonymous>") &&
                      (O = O.replace("<anonymous>", t.displayName)),
                    O
                  );
                }
              while (1 <= a && 0 <= u);
            break;
          }
      }
    } finally {
      ((ci = !1), (Error.prepareStackTrace = e));
    }
    return (e = t ? t.displayName || t.name : "") ? Ce(e) : "";
  }
  function Ch(t, l) {
    switch (t.tag) {
      case 26:
      case 27:
      case 5:
        return Ce(t.type);
      case 16:
        return Ce("Lazy");
      case 13:
        return t.child !== l && l !== null
          ? Ce("Suspense Fallback")
          : Ce("Suspense");
      case 19:
        return Ce("SuspenseList");
      case 0:
      case 15:
        return oi(t.type, !1);
      case 11:
        return oi(t.type.render, !1);
      case 1:
        return oi(t.type, !0);
      case 31:
        return Ce("Activity");
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
    Nh = f.unstable_shouldYield,
    Hh = f.unstable_requestPaint,
    al = f.unstable_now,
    xh = f.unstable_getCurrentPriorityLevel,
    $c = f.unstable_ImmediatePriority,
    Wc = f.unstable_UserBlockingPriority,
    Yu = f.unstable_NormalPriority,
    Bh = f.unstable_LowPriority,
    kc = f.unstable_IdlePriority,
    qh = f.log,
    Yh = f.unstable_setDisableYieldValue,
    ja = null,
    ul = null;
  function ae(t) {
    if (
      (typeof qh == "function" && Yh(t),
      ul && typeof ul.setStrictMode == "function")
    )
      try {
        ul.setStrictMode(ja, t);
      } catch {}
  }
  var nl = Math.clz32 ? Math.clz32 : Gh,
    jh = Math.log,
    Lh = Math.LN2;
  function Gh(t) {
    return ((t >>>= 0), t === 0 ? 32 : (31 - ((jh(t) / Lh) | 0)) | 0);
  }
  var ju = 256,
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
  function Xh(t, l) {
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
  function Qh(t, l, e, a, u, n) {
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
      var O = 31 - nl(e),
        C = 1 << O;
      ((c[O] = 0), (d[O] = -1));
      var z = T[O];
      if (z !== null)
        for (T[O] = null, O = 0; O < z.length; O++) {
          var A = z[O];
          A !== null && (A.lane &= -536870913);
        }
      e &= ~C;
    }
    (a !== 0 && Ic(t, a, 0),
      n !== 0 && u === 0 && t.tag !== 0 && (t.suspendedLanes |= n & ~(i & ~l)));
  }
  function Ic(t, l, e) {
    ((t.pendingLanes |= l), (t.suspendedLanes &= ~l));
    var a = 31 - nl(l);
    ((t.entangledLanes |= l),
      (t.entanglements[a] = t.entanglements[a] | 1073741824 | (e & 261930)));
  }
  function Pc(t, l) {
    var e = (t.entangledLanes |= l);
    for (t = t.entanglements; e; ) {
      var a = 31 - nl(e),
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
  var ue = Math.random().toString(36).slice(2),
    Xt = "__reactFiber$" + ue,
    kt = "__reactProps$" + ue,
    ke = "__reactContainer$" + ue,
    vi = "__reactEvents$" + ue,
    Zh = "__reactListeners$" + ue,
    Vh = "__reactHandles$" + ue,
    ao = "__reactResources$" + ue,
    Xa = "__reactMarker$" + ue;
  function gi(t) {
    (delete t[Xt], delete t[kt], delete t[vi], delete t[Zh], delete t[Vh]);
  }
  function Fe(t) {
    var l = t[Xt];
    if (l) return l;
    for (var e = t.parentNode; e; ) {
      if ((l = e[ke] || e[Xt])) {
        if (
          ((e = l.alternate),
          l.child !== null || (e !== null && e.child !== null))
        )
          for (t = _d(t); t !== null; ) {
            if ((e = t[Xt])) return e;
            t = _d(t);
          }
        return l;
      }
      ((t = e), (e = t.parentNode));
    }
    return null;
  }
  function Ie(t) {
    if ((t = t[Xt] || t[ke])) {
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
  function jt(t) {
    t[Xa] = !0;
  }
  var uo = new Set(),
    no = {};
  function He(t, l) {
    (ta(t, l), ta(t + "Capture", l));
  }
  function ta(t, l) {
    for (no[t] = l, t = 0; t < l.length; t++) uo.add(l[t]);
  }
  var Kh = RegExp(
      "^[:A-Z_a-z\\u00C0-\\u00D6\\u00D8-\\u00F6\\u00F8-\\u02FF\\u0370-\\u037D\\u037F-\\u1FFF\\u200C-\\u200D\\u2070-\\u218F\\u2C00-\\u2FEF\\u3001-\\uD7FF\\uF900-\\uFDCF\\uFDF0-\\uFFFD][:A-Z_a-z\\u00C0-\\u00D6\\u00D8-\\u00F6\\u00F8-\\u02FF\\u0370-\\u037D\\u037F-\\u1FFF\\u200C-\\u200D\\u2070-\\u218F\\u2C00-\\u2FEF\\u3001-\\uD7FF\\uF900-\\uFDCF\\uFDF0-\\uFFFD\\-.0-9\\u00B7\\u0300-\\u036F\\u203F-\\u2040]*$",
    ),
    io = {},
    fo = {};
  function Jh(t) {
    return ri.call(fo, t)
      ? !0
      : ri.call(io, t)
        ? !1
        : Kh.test(t)
          ? (fo[t] = !0)
          : ((io[t] = !0), !1);
  }
  function Qu(t, l, e) {
    if (Jh(l))
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
  function yl(t) {
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
  function wh(t, l, e) {
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
      t._valueTracker = wh(t, l, "" + t[l]);
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
  var $h = /[\n"\\]/g;
  function vl(t) {
    return t.replace($h, function (l) {
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
            (t.value = "" + yl(l))
          : t.value !== "" + yl(l) && (t.value = "" + yl(l))
        : (i !== "submit" && i !== "reset") || t.removeAttribute("value"),
      l != null
        ? bi(t, i, yl(l))
        : e != null
          ? bi(t, i, yl(e))
          : a != null && t.removeAttribute("value"),
      u == null && n != null && (t.defaultChecked = !!n),
      u != null &&
        (t.checked = u && typeof u != "function" && typeof u != "symbol"),
      c != null &&
      typeof c != "function" &&
      typeof c != "symbol" &&
      typeof c != "boolean"
        ? (t.name = "" + yl(c))
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
      ((e = e != null ? "" + yl(e) : ""),
        (l = l != null ? "" + yl(l) : e),
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
      for (e = "" + yl(e), l = null, u = 0; u < t.length; u++) {
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
      ((l = "" + yl(l)), l !== t.value && (t.value = l), e == null)
    ) {
      t.defaultValue !== l && (t.defaultValue = l);
      return;
    }
    t.defaultValue = e != null ? "" + yl(e) : "";
  }
  function ho(t, l, e, a) {
    if (l == null) {
      if (a != null) {
        if (e != null) throw Error(o(92));
        if (_l(a)) {
          if (1 < a.length) throw Error(o(93));
          a = a[0];
        }
        e = a;
      }
      (e == null && (e = ""), (l = e));
    }
    ((e = yl(l)),
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
  var Wh = new Set(
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
        : typeof e != "number" || e === 0 || Wh.has(l)
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
  var kh = new Map([
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
    Fh =
      /^[\u0000-\u001F ]*j[\r\n\t]*a[\r\n\t]*v[\r\n\t]*a[\r\n\t]*s[\r\n\t]*c[\r\n\t]*r[\r\n\t]*i[\r\n\t]*p[\r\n\t]*t[\r\n\t]*:/i;
  function Ku(t) {
    return Fh.test("" + t)
      ? "javascript:throw new Error('React has blocked a javascript: URL as a security precaution.')"
      : t;
  }
  function jl() {}
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
      var e = t[kt] || null;
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
                'input[name="' + vl("" + l) + '"][type="radio"]',
              ),
                l = 0;
              l < e.length;
              l++
            ) {
              var a = e[l];
              if (a !== t && a.form === t.form) {
                var u = a[kt] || null;
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
  var Ai = !1;
  function go(t, l, e) {
    if (Ai) return t(l, e);
    Ai = !0;
    try {
      var a = t(l);
      return a;
    } finally {
      if (
        ((Ai = !1),
        (aa !== null || ua !== null) &&
          (Hn(), aa && ((l = aa), (t = ua), (ua = aa = null), vo(l), t)))
      )
        for (l = 0; l < t.length; l++) vo(t[l]);
    }
  }
  function Za(t, l) {
    var e = t.stateNode;
    if (e === null) return null;
    var a = e[kt] || null;
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
  var Ll = !(
      typeof window > "u" ||
      typeof window.document > "u" ||
      typeof window.document.createElement > "u"
    ),
    _i = !1;
  if (Ll)
    try {
      var Va = {};
      (Object.defineProperty(Va, "passive", {
        get: function () {
          _i = !0;
        },
      }),
        window.addEventListener("test", Va, Va),
        window.removeEventListener("test", Va, Va));
    } catch {
      _i = !1;
    }
  var ne = null,
    Ri = null,
    Ju = null;
  function po() {
    if (Ju) return Ju;
    var t,
      l = Ri,
      e = l.length,
      a,
      u = "value" in ne ? ne.value : ne.textContent,
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
  function Ft(t) {
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
      _(l.prototype, {
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
  var xe = {
      eventPhase: 0,
      bubbles: 0,
      cancelable: 0,
      timeStamp: function (t) {
        return t.timeStamp || Date.now();
      },
      defaultPrevented: 0,
      isTrusted: 0,
    },
    Wu = Ft(xe),
    Ka = _({}, xe, { view: 0, detail: 0 }),
    Ih = Ft(Ka),
    Oi,
    Mi,
    Ja,
    ku = _({}, Ka, {
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
      getModifierState: Ui,
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
    bo = Ft(ku),
    Ph = _({}, ku, { dataTransfer: 0 }),
    tm = Ft(Ph),
    lm = _({}, Ka, { relatedTarget: 0 }),
    Di = Ft(lm),
    em = _({}, xe, { animationName: 0, elapsedTime: 0, pseudoElement: 0 }),
    am = Ft(em),
    um = _({}, xe, {
      clipboardData: function (t) {
        return "clipboardData" in t ? t.clipboardData : window.clipboardData;
      },
    }),
    nm = Ft(um),
    im = _({}, xe, { data: 0 }),
    Eo = Ft(im),
    fm = {
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
    cm = {
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
    om = {
      Alt: "altKey",
      Control: "ctrlKey",
      Meta: "metaKey",
      Shift: "shiftKey",
    };
  function rm(t) {
    var l = this.nativeEvent;
    return l.getModifierState
      ? l.getModifierState(t)
      : (t = om[t])
        ? !!l[t]
        : !1;
  }
  function Ui() {
    return rm;
  }
  var sm = _({}, Ka, {
      key: function (t) {
        if (t.key) {
          var l = fm[t.key] || t.key;
          if (l !== "Unidentified") return l;
        }
        return t.type === "keypress"
          ? ((t = wu(t)), t === 13 ? "Enter" : String.fromCharCode(t))
          : t.type === "keydown" || t.type === "keyup"
            ? cm[t.keyCode] || "Unidentified"
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
      getModifierState: Ui,
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
    dm = Ft(sm),
    hm = _({}, ku, {
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
    To = Ft(hm),
    mm = _({}, Ka, {
      touches: 0,
      targetTouches: 0,
      changedTouches: 0,
      altKey: 0,
      metaKey: 0,
      ctrlKey: 0,
      shiftKey: 0,
      getModifierState: Ui,
    }),
    ym = Ft(mm),
    vm = _({}, xe, { propertyName: 0, elapsedTime: 0, pseudoElement: 0 }),
    gm = Ft(vm),
    pm = _({}, ku, {
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
    Sm = Ft(pm),
    bm = _({}, xe, { newState: 0, oldState: 0 }),
    Em = Ft(bm),
    Tm = [9, 13, 27, 32],
    Ci = Ll && "CompositionEvent" in window,
    wa = null;
  Ll && "documentMode" in document && (wa = document.documentMode);
  var zm = Ll && "TextEvent" in window && !wa,
    zo = Ll && (!Ci || (wa && 8 < wa && 11 >= wa)),
    Ao = " ",
    _o = !1;
  function Ro(t, l) {
    switch (t) {
      case "keyup":
        return Tm.indexOf(l.keyCode) !== -1;
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
  function Am(t, l) {
    switch (t) {
      case "compositionend":
        return Oo(l);
      case "keypress":
        return l.which !== 32 ? null : ((_o = !0), Ao);
      case "textInput":
        return ((t = l.data), t === Ao && _o ? null : t);
      default:
        return null;
    }
  }
  function _m(t, l) {
    if (na)
      return t === "compositionend" || (!Ci && Ro(t, l))
        ? ((t = po()), (Ju = Ri = ne = null), (na = !1), t)
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
  var Rm = {
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
    return l === "input" ? !!Rm[t.type] : l === "textarea";
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
  function Om(t) {
    sd(t, 0);
  }
  function Fu(t) {
    var l = Qa(t);
    if (oo(l)) return t;
  }
  function Uo(t, l) {
    if (t === "change") return l;
  }
  var Co = !1;
  if (Ll) {
    var Ni;
    if (Ll) {
      var Hi = "oninput" in document;
      if (!Hi) {
        var No = document.createElement("div");
        (No.setAttribute("oninput", "return;"),
          (Hi = typeof No.oninput == "function"));
      }
      Ni = Hi;
    } else Ni = !1;
    Co = Ni && (!document.documentMode || 9 < document.documentMode);
  }
  function Ho() {
    $a && ($a.detachEvent("onpropertychange", xo), (Wa = $a = null));
  }
  function xo(t) {
    if (t.propertyName === "value" && Fu(Wa)) {
      var l = [];
      (Do(l, Wa, t, zi(t)), go(Om, l));
    }
  }
  function Mm(t, l, e) {
    t === "focusin"
      ? (Ho(), ($a = l), (Wa = e), $a.attachEvent("onpropertychange", xo))
      : t === "focusout" && Ho();
  }
  function Dm(t) {
    if (t === "selectionchange" || t === "keyup" || t === "keydown")
      return Fu(Wa);
  }
  function Um(t, l) {
    if (t === "click") return Fu(l);
  }
  function Cm(t, l) {
    if (t === "input" || t === "change") return Fu(l);
  }
  function Nm(t, l) {
    return (t === l && (t !== 0 || 1 / t === 1 / l)) || (t !== t && l !== l);
  }
  var il = typeof Object.is == "function" ? Object.is : Nm;
  function ka(t, l) {
    if (il(t, l)) return !0;
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
      if (!ri.call(l, u) || !il(t[u], l[u])) return !1;
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
  function Yo(t, l) {
    return t && l
      ? t === l
        ? !0
        : t && t.nodeType === 3
          ? !1
          : l && l.nodeType === 3
            ? Yo(t, l.parentNode)
            : "contains" in t
              ? t.contains(l)
              : t.compareDocumentPosition
                ? !!(t.compareDocumentPosition(l) & 16)
                : !1
      : !1;
  }
  function jo(t) {
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
  function xi(t) {
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
  var Hm = Ll && "documentMode" in document && 11 >= document.documentMode,
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
      "selectionStart" in a && xi(a)
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
    Yi = {},
    Go = {};
  Ll &&
    ((Go = document.createElement("div").style),
    "AnimationEvent" in window ||
      (delete fa.animationend.animation,
      delete fa.animationiteration.animation,
      delete fa.animationstart.animation),
    "TransitionEvent" in window || delete fa.transitionend.transition);
  function qe(t) {
    if (Yi[t]) return Yi[t];
    if (!fa[t]) return t;
    var l = fa[t],
      e;
    for (e in l) if (l.hasOwnProperty(e) && e in Go) return (Yi[t] = l[e]);
    return t;
  }
  var Xo = qe("animationend"),
    Qo = qe("animationiteration"),
    Zo = qe("animationstart"),
    xm = qe("transitionrun"),
    Bm = qe("transitionstart"),
    qm = qe("transitioncancel"),
    Vo = qe("transitionend"),
    Ko = new Map(),
    ji =
      "abort auxClick beforeToggle cancel canPlay canPlayThrough click close contextMenu copy cut drag dragEnd dragEnter dragExit dragLeave dragOver dragStart drop durationChange emptied encrypted ended error gotPointerCapture input invalid keyDown keyPress keyUp load loadedData loadedMetadata loadStart lostPointerCapture mouseDown mouseMove mouseOut mouseOver mouseUp paste pause play playing pointerCancel pointerDown pointerMove pointerOut pointerOver pointerUp progress rateChange reset resize seeked seeking stalled submit suspend timeUpdate touchCancel touchEnd touchStart volumeChange scroll toggle touchMove waiting wheel".split(
        " ",
      );
  ji.push("scrollEnd");
  function Rl(t, l) {
    (Ko.set(t, l), He(l, [t]));
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
    gl = [],
    ca = 0,
    Li = 0;
  function Pu() {
    for (var t = ca, l = (Li = ca = 0); l < t; ) {
      var e = gl[l];
      gl[l++] = null;
      var a = gl[l];
      gl[l++] = null;
      var u = gl[l];
      gl[l++] = null;
      var n = gl[l];
      if (((gl[l++] = null), a !== null && u !== null)) {
        var i = a.pending;
        (i === null ? (u.next = u) : ((u.next = i.next), (i.next = u)),
          (a.pending = u));
      }
      n !== 0 && Jo(e, u, n);
    }
  }
  function tn(t, l, e, a) {
    ((gl[ca++] = t),
      (gl[ca++] = l),
      (gl[ca++] = e),
      (gl[ca++] = a),
      (Li |= a),
      (t.lanes |= a),
      (t = t.alternate),
      t !== null && (t.lanes |= a));
  }
  function Gi(t, l, e, a) {
    return (tn(t, l, e, a), ln(t));
  }
  function Ye(t, l) {
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
          ((u = 31 - nl(e)),
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
  function Ym(t, l, e, a) {
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
  function fl(t, l, e, a) {
    return new Ym(t, l, e, a);
  }
  function Xi(t) {
    return ((t = t.prototype), !(!t || !t.isReactComponent));
  }
  function Gl(t, l) {
    var e = t.alternate;
    return (
      e === null
        ? ((e = fl(t.tag, l, t.key, t.mode)),
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
      i = Qy(t, e, L.current)
        ? 26
        : t === "html" || t === "head" || t === "body"
          ? 27
          : 5;
    else
      t: switch (t) {
        case Gt:
          return (
            (t = fl(31, e, l, u)),
            (t.elementType = Gt),
            (t.lanes = n),
            t
          );
        case Z:
          return je(e.children, u, n, l);
        case Q:
          ((i = 8), (u |= 24));
          break;
        case K:
          return (
            (t = fl(12, e, l, u | 2)),
            (t.elementType = K),
            (t.lanes = n),
            t
          );
        case ht:
          return (
            (t = fl(13, e, l, u)),
            (t.elementType = ht),
            (t.lanes = n),
            t
          );
        case zt:
          return (
            (t = fl(19, e, l, u)),
            (t.elementType = zt),
            (t.lanes = n),
            t
          );
        default:
          if (typeof t == "object" && t !== null)
            switch (t.$$typeof) {
              case Y:
                i = 10;
                break t;
              case W:
                i = 9;
                break t;
              case pt:
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
      (l = fl(i, e, l, u)),
      (l.elementType = t),
      (l.type = a),
      (l.lanes = n),
      l
    );
  }
  function je(t, l, e, a) {
    return ((t = fl(7, t, a, l)), (t.lanes = e), t);
  }
  function Qi(t, l, e) {
    return ((t = fl(6, t, null, l)), (t.lanes = e), t);
  }
  function $o(t) {
    var l = fl(18, null, null, 0);
    return ((l.stateNode = t), l);
  }
  function Zi(t, l, e) {
    return (
      (l = fl(4, t.children !== null ? t.children : [], t.key, l)),
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
  function pl(t, l) {
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
    Sl = [],
    bl = 0,
    ie = null,
    Cl = 1,
    Nl = "";
  function Xl(t, l) {
    ((ra[sa++] = Ia), (ra[sa++] = an), (an = t), (Ia = l));
  }
  function ko(t, l, e) {
    ((Sl[bl++] = Cl), (Sl[bl++] = Nl), (Sl[bl++] = ie), (ie = t));
    var a = Cl;
    t = Nl;
    var u = 32 - nl(a) - 1;
    ((a &= ~(1 << u)), (e += 1));
    var n = 32 - nl(l) + u;
    if (30 < n) {
      var i = u - (u % 5);
      ((n = (a & ((1 << i) - 1)).toString(32)),
        (a >>= i),
        (u -= i),
        (Cl = (1 << (32 - nl(l) + u)) | (e << u) | a),
        (Nl = n + t));
    } else ((Cl = (1 << n) | (e << u) | a), (Nl = t));
  }
  function Vi(t) {
    t.return !== null && (Xl(t, 1), ko(t, 1, 0));
  }
  function Ki(t) {
    for (; t === an; )
      ((an = ra[--sa]), (ra[sa] = null), (Ia = ra[--sa]), (ra[sa] = null));
    for (; t === ie; )
      ((ie = Sl[--bl]),
        (Sl[bl] = null),
        (Nl = Sl[--bl]),
        (Sl[bl] = null),
        (Cl = Sl[--bl]),
        (Sl[bl] = null));
  }
  function Fo(t, l) {
    ((Sl[bl++] = Cl),
      (Sl[bl++] = Nl),
      (Sl[bl++] = ie),
      (Cl = l.id),
      (Nl = l.overflow),
      (ie = t));
  }
  var Qt = null,
    Et = null,
    it = !1,
    fe = null,
    El = !1,
    Ji = Error(o(519));
  function ce(t) {
    var l = Error(
      o(
        418,
        1 < arguments.length && arguments[1] !== void 0 && arguments[1]
          ? "text"
          : "HTML",
        "",
      ),
    );
    throw (Pa(pl(l, t)), Ji);
  }
  function Io(t) {
    var l = t.stateNode,
      e = t.type,
      a = t.memoizedProps;
    switch (((l[Xt] = t), (l[kt] = a), e)) {
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
          a.onClick != null && (l.onclick = jl),
          (l = !0))
        : (l = !1),
      l || ce(t, !0));
  }
  function Po(t) {
    for (Qt = t.return; Qt; )
      switch (Qt.tag) {
        case 5:
        case 31:
        case 13:
          El = !1;
          return;
        case 27:
        case 3:
          El = !0;
          return;
        default:
          Qt = Qt.return;
      }
  }
  function da(t) {
    if (t !== Qt) return !1;
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
      e && Et && ce(t),
      Po(t),
      l === 13)
    ) {
      if (((t = t.memoizedState), (t = t !== null ? t.dehydrated : null), !t))
        throw Error(o(317));
      Et = Ad(t);
    } else if (l === 31) {
      if (((t = t.memoizedState), (t = t !== null ? t.dehydrated : null), !t))
        throw Error(o(317));
      Et = Ad(t);
    } else
      l === 27
        ? ((l = Et), Te(t.type) ? ((t = vc), (vc = null), (Et = t)) : (Et = l))
        : (Et = Qt ? zl(t.stateNode.nextSibling) : null);
    return !0;
  }
  function Le() {
    ((Et = Qt = null), (it = !1));
  }
  function wi() {
    var t = fe;
    return (
      t !== null &&
        (ll === null ? (ll = t) : ll.push.apply(ll, t), (fe = null)),
      t
    );
  }
  function Pa(t) {
    fe === null ? (fe = [t]) : fe.push(t);
  }
  var $i = g(null),
    Ge = null,
    Ql = null;
  function oe(t, l, e) {
    (q($i, l._currentValue), (l._currentValue = e));
  }
  function Zl(t) {
    ((t._currentValue = $i.current), H($i));
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
          il(u.pendingProps.value, i.value) ||
            (t !== null ? t.push(c) : (t = [c]));
        }
      } else if (u === rt.current) {
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
      if (!il(t.context._currentValue, t.memoizedValue)) return !0;
      t = t.next;
    }
    return !1;
  }
  function Xe(t) {
    ((Ge = t),
      (Ql = null),
      (t = t.dependencies),
      t !== null && (t.firstContext = null));
  }
  function Zt(t) {
    return tr(Ge, t);
  }
  function nn(t, l) {
    return (Ge === null && Xe(t), tr(t, l));
  }
  function tr(t, l) {
    var e = l._currentValue;
    if (((l = { context: l, memoizedValue: e, next: null }), Ql === null)) {
      if (t === null) throw Error(o(308));
      ((Ql = l),
        (t.dependencies = { lanes: 0, firstContext: l }),
        (t.flags |= 524288));
    } else Ql = Ql.next = l;
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
    Lm = f.unstable_scheduleCallback,
    Gm = f.unstable_NormalPriority,
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
        Lm(Gm, function () {
          t.controller.abort();
        }));
  }
  var lu = null,
    Ii = 0,
    ma = 0,
    ya = null;
  function Xm(t, l) {
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
  function Qm(t, l) {
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
    ((Ls = al()),
      typeof l == "object" &&
        l !== null &&
        typeof l.then == "function" &&
        Xm(t, l),
      er !== null && er(t, l));
  };
  var Qe = g(null);
  function Pi() {
    var t = Qe.current;
    return t !== null ? t : bt.pooledCache;
  }
  function fn(t, l) {
    l === null ? q(Qe, Qe.current) : q(Qe, l.pool);
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
      e === void 0 ? t.push(l) : e !== l && (l.then(jl, jl), (l = e)),
      l.status)
    ) {
      case "fulfilled":
        return l.value;
      case "rejected":
        throw ((t = l.reason), fr(t), t);
      default:
        if (typeof l.status == "string") l.then(jl, jl);
        else {
          if (((t = bt), t !== null && 100 < t.shellSuspendCounter))
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
    throw l.$$typeof === x
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
    function l(p, m) {
      if (t) {
        var E = p.deletions;
        E === null ? ((p.deletions = [m]), (p.flags |= 16)) : E.push(m);
      }
    }
    function e(p, m) {
      if (!t) return null;
      for (; m !== null; ) (l(p, m), (m = m.sibling));
      return null;
    }
    function a(p) {
      for (var m = new Map(); p !== null; )
        (p.key !== null ? m.set(p.key, p) : m.set(p.index, p), (p = p.sibling));
      return m;
    }
    function u(p, m) {
      return ((p = Gl(p, m)), (p.index = 0), (p.sibling = null), p);
    }
    function n(p, m, E) {
      return (
        (p.index = E),
        t
          ? ((E = p.alternate),
            E !== null
              ? ((E = E.index), E < m ? ((p.flags |= 67108866), m) : E)
              : ((p.flags |= 67108866), m))
          : ((p.flags |= 1048576), m)
      );
    }
    function i(p) {
      return (t && p.alternate === null && (p.flags |= 67108866), p);
    }
    function c(p, m, E, U) {
      return m === null || m.tag !== 6
        ? ((m = Qi(E, p.mode, U)), (m.return = p), m)
        : ((m = u(m, E)), (m.return = p), m);
    }
    function d(p, m, E, U) {
      var V = E.type;
      return V === Z
        ? O(p, m, E.props.children, U, E.key)
        : m !== null &&
            (m.elementType === V ||
              (typeof V == "object" &&
                V !== null &&
                V.$$typeof === Dt &&
                Ze(V) === m.type))
          ? ((m = u(m, E.props)), au(m, E), (m.return = p), m)
          : ((m = en(E.type, E.key, E.props, null, p.mode, U)),
            au(m, E),
            (m.return = p),
            m);
    }
    function T(p, m, E, U) {
      return m === null ||
        m.tag !== 4 ||
        m.stateNode.containerInfo !== E.containerInfo ||
        m.stateNode.implementation !== E.implementation
        ? ((m = Zi(E, p.mode, U)), (m.return = p), m)
        : ((m = u(m, E.children || [])), (m.return = p), m);
    }
    function O(p, m, E, U, V) {
      return m === null || m.tag !== 7
        ? ((m = je(E, p.mode, U, V)), (m.return = p), m)
        : ((m = u(m, E)), (m.return = p), m);
    }
    function C(p, m, E) {
      if (
        (typeof m == "string" && m !== "") ||
        typeof m == "number" ||
        typeof m == "bigint"
      )
        return ((m = Qi("" + m, p.mode, E)), (m.return = p), m);
      if (typeof m == "object" && m !== null) {
        switch (m.$$typeof) {
          case G:
            return (
              (E = en(m.type, m.key, m.props, null, p.mode, E)),
              au(E, m),
              (E.return = p),
              E
            );
          case $:
            return ((m = Zi(m, p.mode, E)), (m.return = p), m);
          case Dt:
            return ((m = Ze(m)), C(p, m, E));
        }
        if (_l(m) || Wt(m))
          return ((m = je(m, p.mode, E, null)), (m.return = p), m);
        if (typeof m.then == "function") return C(p, rn(m), E);
        if (m.$$typeof === Y) return C(p, nn(p, m), E);
        sn(p, m);
      }
      return null;
    }
    function z(p, m, E, U) {
      var V = m !== null ? m.key : null;
      if (
        (typeof E == "string" && E !== "") ||
        typeof E == "number" ||
        typeof E == "bigint"
      )
        return V !== null ? null : c(p, m, "" + E, U);
      if (typeof E == "object" && E !== null) {
        switch (E.$$typeof) {
          case G:
            return E.key === V ? d(p, m, E, U) : null;
          case $:
            return E.key === V ? T(p, m, E, U) : null;
          case Dt:
            return ((E = Ze(E)), z(p, m, E, U));
        }
        if (_l(E) || Wt(E)) return V !== null ? null : O(p, m, E, U, null);
        if (typeof E.then == "function") return z(p, m, rn(E), U);
        if (E.$$typeof === Y) return z(p, m, nn(p, E), U);
        sn(p, E);
      }
      return null;
    }
    function A(p, m, E, U, V) {
      if (
        (typeof U == "string" && U !== "") ||
        typeof U == "number" ||
        typeof U == "bigint"
      )
        return ((p = p.get(E) || null), c(m, p, "" + U, V));
      if (typeof U == "object" && U !== null) {
        switch (U.$$typeof) {
          case G:
            return (
              (p = p.get(U.key === null ? E : U.key) || null),
              d(m, p, U, V)
            );
          case $:
            return (
              (p = p.get(U.key === null ? E : U.key) || null),
              T(m, p, U, V)
            );
          case Dt:
            return ((U = Ze(U)), A(p, m, E, U, V));
        }
        if (_l(U) || Wt(U))
          return ((p = p.get(E) || null), O(m, p, U, V, null));
        if (typeof U.then == "function") return A(p, m, E, rn(U), V);
        if (U.$$typeof === Y) return A(p, m, E, nn(m, U), V);
        sn(m, U);
      }
      return null;
    }
    function j(p, m, E, U) {
      for (
        var V = null, ft = null, X = m, tt = (m = 0), nt = null;
        X !== null && tt < E.length;
        tt++
      ) {
        X.index > tt ? ((nt = X), (X = null)) : (nt = X.sibling);
        var ct = z(p, X, E[tt], U);
        if (ct === null) {
          X === null && (X = nt);
          break;
        }
        (t && X && ct.alternate === null && l(p, X),
          (m = n(ct, m, tt)),
          ft === null ? (V = ct) : (ft.sibling = ct),
          (ft = ct),
          (X = nt));
      }
      if (tt === E.length) return (e(p, X), it && Xl(p, tt), V);
      if (X === null) {
        for (; tt < E.length; tt++)
          ((X = C(p, E[tt], U)),
            X !== null &&
              ((m = n(X, m, tt)),
              ft === null ? (V = X) : (ft.sibling = X),
              (ft = X)));
        return (it && Xl(p, tt), V);
      }
      for (X = a(X); tt < E.length; tt++)
        ((nt = A(X, p, tt, E[tt], U)),
          nt !== null &&
            (t &&
              nt.alternate !== null &&
              X.delete(nt.key === null ? tt : nt.key),
            (m = n(nt, m, tt)),
            ft === null ? (V = nt) : (ft.sibling = nt),
            (ft = nt)));
      return (
        t &&
          X.forEach(function (Oe) {
            return l(p, Oe);
          }),
        it && Xl(p, tt),
        V
      );
    }
    function J(p, m, E, U) {
      if (E == null) throw Error(o(151));
      for (
        var V = null, ft = null, X = m, tt = (m = 0), nt = null, ct = E.next();
        X !== null && !ct.done;
        tt++, ct = E.next()
      ) {
        X.index > tt ? ((nt = X), (X = null)) : (nt = X.sibling);
        var Oe = z(p, X, ct.value, U);
        if (Oe === null) {
          X === null && (X = nt);
          break;
        }
        (t && X && Oe.alternate === null && l(p, X),
          (m = n(Oe, m, tt)),
          ft === null ? (V = Oe) : (ft.sibling = Oe),
          (ft = Oe),
          (X = nt));
      }
      if (ct.done) return (e(p, X), it && Xl(p, tt), V);
      if (X === null) {
        for (; !ct.done; tt++, ct = E.next())
          ((ct = C(p, ct.value, U)),
            ct !== null &&
              ((m = n(ct, m, tt)),
              ft === null ? (V = ct) : (ft.sibling = ct),
              (ft = ct)));
        return (it && Xl(p, tt), V);
      }
      for (X = a(X); !ct.done; tt++, ct = E.next())
        ((ct = A(X, p, tt, ct.value, U)),
          ct !== null &&
            (t &&
              ct.alternate !== null &&
              X.delete(ct.key === null ? tt : ct.key),
            (m = n(ct, m, tt)),
            ft === null ? (V = ct) : (ft.sibling = ct),
            (ft = ct)));
      return (
        t &&
          X.forEach(function (Py) {
            return l(p, Py);
          }),
        it && Xl(p, tt),
        V
      );
    }
    function gt(p, m, E, U) {
      if (
        (typeof E == "object" &&
          E !== null &&
          E.type === Z &&
          E.key === null &&
          (E = E.props.children),
        typeof E == "object" && E !== null)
      ) {
        switch (E.$$typeof) {
          case G:
            t: {
              for (var V = E.key; m !== null; ) {
                if (m.key === V) {
                  if (((V = E.type), V === Z)) {
                    if (m.tag === 7) {
                      (e(p, m.sibling),
                        (U = u(m, E.props.children)),
                        (U.return = p),
                        (p = U));
                      break t;
                    }
                  } else if (
                    m.elementType === V ||
                    (typeof V == "object" &&
                      V !== null &&
                      V.$$typeof === Dt &&
                      Ze(V) === m.type)
                  ) {
                    (e(p, m.sibling),
                      (U = u(m, E.props)),
                      au(U, E),
                      (U.return = p),
                      (p = U));
                    break t;
                  }
                  e(p, m);
                  break;
                } else l(p, m);
                m = m.sibling;
              }
              E.type === Z
                ? ((U = je(E.props.children, p.mode, U, E.key)),
                  (U.return = p),
                  (p = U))
                : ((U = en(E.type, E.key, E.props, null, p.mode, U)),
                  au(U, E),
                  (U.return = p),
                  (p = U));
            }
            return i(p);
          case $:
            t: {
              for (V = E.key; m !== null; ) {
                if (m.key === V)
                  if (
                    m.tag === 4 &&
                    m.stateNode.containerInfo === E.containerInfo &&
                    m.stateNode.implementation === E.implementation
                  ) {
                    (e(p, m.sibling),
                      (U = u(m, E.children || [])),
                      (U.return = p),
                      (p = U));
                    break t;
                  } else {
                    e(p, m);
                    break;
                  }
                else l(p, m);
                m = m.sibling;
              }
              ((U = Zi(E, p.mode, U)), (U.return = p), (p = U));
            }
            return i(p);
          case Dt:
            return ((E = Ze(E)), gt(p, m, E, U));
        }
        if (_l(E)) return j(p, m, E, U);
        if (Wt(E)) {
          if (((V = Wt(E)), typeof V != "function")) throw Error(o(150));
          return ((E = V.call(E)), J(p, m, E, U));
        }
        if (typeof E.then == "function") return gt(p, m, rn(E), U);
        if (E.$$typeof === Y) return gt(p, m, nn(p, E), U);
        sn(p, E);
      }
      return (typeof E == "string" && E !== "") ||
        typeof E == "number" ||
        typeof E == "bigint"
        ? ((E = "" + E),
          m !== null && m.tag === 6
            ? (e(p, m.sibling), (U = u(m, E)), (U.return = p), (p = U))
            : (e(p, m), (U = Qi(E, p.mode, U)), (U.return = p), (p = U)),
          i(p))
        : e(p, m);
    }
    return function (p, m, E, U) {
      try {
        eu = 0;
        var V = gt(p, m, E, U);
        return ((ga = null), V);
      } catch (X) {
        if (X === va || X === cn) throw X;
        var ft = fl(29, X, null, p.mode);
        return ((ft.lanes = U), (ft.return = p), ft);
      } finally {
      }
    };
  }
  var Ke = cr(!0),
    or = cr(!1),
    re = !1;
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
  function se(t) {
    return { lane: t, tag: 0, payload: null, callback: null, next: null };
  }
  function de(t, l, e) {
    var a = t.updateQueue;
    if (a === null) return null;
    if (((a = a.shared), (ot & 2) !== 0)) {
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
    re = !1;
    var n = u.firstBaseUpdate,
      i = u.lastBaseUpdate,
      c = u.shared.pending;
    if (c !== null) {
      u.shared.pending = null;
      var d = c,
        T = d.next;
      ((d.next = null), i === null ? (n = T) : (i.next = T), (i = d));
      var O = t.alternate;
      O !== null &&
        ((O = O.updateQueue),
        (c = O.lastBaseUpdate),
        c !== i &&
          (c === null ? (O.firstBaseUpdate = T) : (c.next = T),
          (O.lastBaseUpdate = d)));
    }
    if (n !== null) {
      var C = u.baseState;
      ((i = 0), (O = T = d = null), (c = n));
      do {
        var z = c.lane & -536870913,
          A = z !== c.lane;
        if (A ? (ut & z) === z : (a & z) === z) {
          (z !== 0 && z === ma && (uf = !0),
            O !== null &&
              (O = O.next =
                {
                  lane: 0,
                  tag: c.tag,
                  payload: c.payload,
                  callback: null,
                  next: null,
                }));
          t: {
            var j = t,
              J = c;
            z = l;
            var gt = e;
            switch (J.tag) {
              case 1:
                if (((j = J.payload), typeof j == "function")) {
                  C = j.call(gt, C, z);
                  break t;
                }
                C = j;
                break t;
              case 3:
                j.flags = (j.flags & -65537) | 128;
              case 0:
                if (
                  ((j = J.payload),
                  (z = typeof j == "function" ? j.call(gt, C, z) : j),
                  z == null)
                )
                  break t;
                C = _({}, C, z);
                break t;
              case 2:
                re = !0;
            }
          }
          ((z = c.callback),
            z !== null &&
              ((t.flags |= 64),
              A && (t.flags |= 8192),
              (A = u.callbacks),
              A === null ? (u.callbacks = [z]) : A.push(z)));
        } else
          ((A = {
            lane: z,
            tag: c.tag,
            payload: c.payload,
            callback: c.callback,
            next: null,
          }),
            O === null ? ((T = O = A), (d = C)) : (O = O.next = A),
            (i |= z));
        if (((c = c.next), c === null)) {
          if (((c = u.shared.pending), c === null)) break;
          ((A = c),
            (c = A.next),
            (A.next = null),
            (u.lastBaseUpdate = A),
            (u.shared.pending = null));
        }
      } while (!0);
      (O === null && (d = C),
        (u.baseState = d),
        (u.firstBaseUpdate = T),
        (u.lastBaseUpdate = O),
        n === null && (u.shared.lanes = 0),
        (ge |= i),
        (t.lanes = i),
        (t.memoizedState = C));
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
    ((t = Il), q(dn, t), q(pa, l), (Il = t | l.baseLanes));
  }
  function nf() {
    (q(dn, Il), q(pa, pa.current));
  }
  function ff() {
    ((Il = dn.current), H(pa), H(dn));
  }
  var cl = g(null),
    Tl = null;
  function he(t) {
    var l = t.alternate;
    (q(Ct, Ct.current & 1),
      q(cl, t),
      Tl === null &&
        (l === null || pa.current !== null || l.memoizedState !== null) &&
        (Tl = t));
  }
  function cf(t) {
    (q(Ct, Ct.current), q(cl, t), Tl === null && (Tl = t));
  }
  function hr(t) {
    t.tag === 22
      ? (q(Ct, Ct.current), q(cl, t), Tl === null && (Tl = t))
      : me();
  }
  function me() {
    (q(Ct, Ct.current), q(cl, cl.current));
  }
  function ol(t) {
    (H(cl), Tl === t && (Tl = null), H(Ct));
  }
  var Ct = g(0);
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
  var Vl = 0,
    P = null,
    yt = null,
    xt = null,
    mn = !1,
    Sa = !1,
    Je = !1,
    yn = 0,
    fu = 0,
    ba = null,
    Zm = 0;
  function Ot() {
    throw Error(o(321));
  }
  function of(t, l) {
    if (l === null) return !1;
    for (var e = 0; e < l.length && e < t.length; e++)
      if (!il(t[e], l[e])) return !1;
    return !0;
  }
  function rf(t, l, e, a, u, n) {
    return (
      (Vl = n),
      (P = l),
      (l.memoizedState = null),
      (l.updateQueue = null),
      (l.lanes = 0),
      (D.H = t === null || t.memoizedState === null ? kr : _f),
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
    var l = yt !== null && yt.next !== null;
    if (((Vl = 0), (xt = yt = P = null), (mn = !1), (fu = 0), (ba = null), l))
      throw Error(o(300));
    t === null ||
      Bt ||
      ((t = t.dependencies), t !== null && un(t) && (Bt = !0));
  }
  function yr(t, l, e, a) {
    P = t;
    var u = 0;
    do {
      if ((Sa && (ba = null), (fu = 0), (Sa = !1), 25 <= u))
        throw Error(o(301));
      if (((u += 1), (xt = yt = null), t.updateQueue != null)) {
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
  function Vm() {
    var t = D.H,
      l = t.useState()[0];
    return (
      (l = typeof l.then == "function" ? cu(l) : l),
      (t = t.useState()[0]),
      (yt !== null ? yt.memoizedState : null) !== t && (P.flags |= 1024),
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
    ((Vl = 0), (xt = yt = P = null), (Sa = !1), (fu = yn = 0), (ba = null));
  }
  function $t() {
    var t = {
      memoizedState: null,
      baseState: null,
      baseQueue: null,
      queue: null,
      next: null,
    };
    return (xt === null ? (P.memoizedState = xt = t) : (xt = xt.next = t), xt);
  }
  function Nt() {
    if (yt === null) {
      var t = P.alternate;
      t = t !== null ? t.memoizedState : null;
    } else t = yt.next;
    var l = xt === null ? P.memoizedState : xt.next;
    if (l !== null) ((xt = l), (yt = t));
    else {
      if (t === null)
        throw P.alternate === null ? Error(o(467)) : Error(o(310));
      ((yt = t),
        (t = {
          memoizedState: yt.memoizedState,
          baseState: yt.baseState,
          baseQueue: yt.baseQueue,
          queue: yt.queue,
          next: null,
        }),
        xt === null ? (P.memoizedState = xt = t) : (xt = xt.next = t));
    }
    return xt;
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
      (xt === null ? l.memoizedState : xt.next) === null &&
        ((l = l.alternate),
        (D.H = l === null || l.memoizedState === null ? kr : _f)),
      t
    );
  }
  function gn(t) {
    if (t !== null && typeof t == "object") {
      if (typeof t.then == "function") return cu(t);
      if (t.$$typeof === Y) return Zt(t);
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
      for (e = l.data[l.index] = Array(t), a = 0; a < t; a++) e[a] = ml;
    return (l.index++, e);
  }
  function Kl(t, l) {
    return typeof l == "function" ? l(t) : l;
  }
  function pn(t) {
    var l = Nt();
    return yf(l, yt, t);
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
        O = !1;
      do {
        var C = T.lane & -536870913;
        if (C !== T.lane ? (ut & C) === C : (Vl & C) === C) {
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
              C === ma && (O = !0));
          else if ((Vl & z) === z) {
            ((T = T.next), z === ma && (O = !0));
            continue;
          } else
            ((C = {
              lane: 0,
              revertLane: T.revertLane,
              gesture: null,
              action: T.action,
              hasEagerState: T.hasEagerState,
              eagerState: T.eagerState,
              next: null,
            }),
              d === null ? ((c = d = C), (i = n)) : (d = d.next = C),
              (P.lanes |= z),
              (ge |= z));
          ((C = T.action),
            Je && e(n, C),
            (n = T.hasEagerState ? T.eagerState : e(n, C)));
        } else
          ((z = {
            lane: C,
            revertLane: T.revertLane,
            gesture: T.gesture,
            action: T.action,
            hasEagerState: T.hasEagerState,
            eagerState: T.eagerState,
            next: null,
          }),
            d === null ? ((c = d = z), (i = n)) : (d = d.next = z),
            (P.lanes |= C),
            (ge |= C));
        T = T.next;
      } while (T !== null && T !== l);
      if (
        (d === null ? (i = n) : (d.next = c),
        !il(n, t.memoizedState) && ((Bt = !0), O && ((e = ya), e !== null)))
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
      (il(n, l.memoizedState) || (Bt = !0),
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
    var i = !il((yt || u).memoizedState, e);
    if (
      (i && ((u.memoizedState = e), (Bt = !0)),
      (u = u.queue),
      Sf(Sr.bind(null, a, u, t), [t]),
      u.getSnapshot !== l || i || (xt !== null && xt.memoizedState.tag & 1))
    ) {
      if (
        ((a.flags |= 2048),
        Ea(9, { destroy: void 0 }, pr.bind(null, a, u, e, l), null),
        bt === null)
      )
        throw Error(o(349));
      n || (Vl & 127) !== 0 || gr(a, l, e);
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
      return !il(t, e);
    } catch {
      return !0;
    }
  }
  function Er(t) {
    var l = Ye(t, 2);
    l !== null && el(l, t, 2);
  }
  function gf(t) {
    var l = $t();
    if (typeof t == "function") {
      var e = t;
      if (((t = e()), Je)) {
        ae(!0);
        try {
          e();
        } finally {
          ae(!1);
        }
      }
    }
    return (
      (l.memoizedState = l.baseState = t),
      (l.queue = {
        pending: null,
        lanes: 0,
        dispatch: null,
        lastRenderedReducer: Kl,
        lastRenderedState: t,
      }),
      l
    );
  }
  function Tr(t, l, e, a) {
    return ((t.baseState = e), yf(t, yt, typeof a == "function" ? a : Kl));
  }
  function Km(t, l, e, a, u) {
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
        (d !== null && d(i, c), Ar(t, l, c));
      } catch (T) {
        pf(t, l, T);
      } finally {
        (n !== null && i.types !== null && (n.types = i.types), (D.T = n));
      }
    } else
      try {
        ((n = e(u, a)), Ar(t, l, n));
      } catch (T) {
        pf(t, l, T);
      }
  }
  function Ar(t, l, e) {
    e !== null && typeof e == "object" && typeof e.then == "function"
      ? e.then(
          function (a) {
            _r(t, l, a);
          },
          function (a) {
            return pf(t, l, a);
          },
        )
      : _r(t, l, e);
  }
  function _r(t, l, e) {
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
      var e = bt.formState;
      if (e !== null) {
        t: {
          var a = P;
          if (it) {
            if (Et) {
              l: {
                for (var u = Et, n = El; u.nodeType !== 8; ) {
                  if (!n) {
                    u = null;
                    break l;
                  }
                  if (((u = zl(u.nextSibling)), u === null)) {
                    u = null;
                    break l;
                  }
                }
                ((n = u.data), (u = n === "F!" || n === "F" ? u : null));
              }
              if (u) {
                ((Et = zl(u.nextSibling)), (a = u.data === "F!"));
                break t;
              }
            }
            ce(a);
          }
          a = !1;
        }
        a && (l = e[0]);
      }
    }
    return (
      (e = $t()),
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
      (n = Af.bind(null, P, !1, a.queue)),
      (a = $t()),
      (u = { state: l, dispatch: null, action: t, pending: null }),
      (a.queue = u),
      (e = Km.bind(null, P, u, n, e)),
      (u.dispatch = e),
      (a.memoizedState = t),
      [l, e, !1]
    );
  }
  function Dr(t) {
    var l = Nt();
    return Ur(l, yt, t);
  }
  function Ur(t, l, e) {
    if (
      ((l = yf(t, l, Or)[0]),
      (t = pn(Kl)[0]),
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
        Ea(9, { destroy: void 0 }, Jm.bind(null, u, e), null)),
      [a, n, t]
    );
  }
  function Jm(t, l) {
    t.action = l;
  }
  function Cr(t) {
    var l = Nt(),
      e = yt;
    if (e !== null) return Ur(l, e, t);
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
    var u = $t();
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
    yt !== null && a !== null && of(a, yt.memoizedState.deps)
      ? (u.memoizedState = Ea(l, n, e, a))
      : ((P.flags |= t), (u.memoizedState = Ea(1 | l, n, e, a)));
  }
  function Hr(t, l) {
    Sn(8390656, 8, t, l);
  }
  function Sf(t, l) {
    bn(2048, 8, t, l);
  }
  function wm(t) {
    P.flags |= 4;
    var l = P.updateQueue;
    if (l === null) ((l = vn()), (P.updateQueue = l), (l.events = [t]));
    else {
      var e = l.events;
      e === null ? (l.events = [t]) : e.push(t);
    }
  }
  function xr(t) {
    var l = Nt().memoizedState;
    return (
      wm({ ref: l, nextImpl: t }),
      function () {
        if ((ot & 2) !== 0) throw Error(o(440));
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
  function Yr(t, l) {
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
  function jr(t, l, e) {
    ((e = e != null ? e.concat([t]) : null), bn(4, 4, Yr.bind(null, l, t), e));
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
      ae(!0);
      try {
        t();
      } finally {
        ae(!1);
      }
    }
    return ((e.memoizedState = [a, l]), a);
  }
  function Ef(t, l, e) {
    return e === void 0 || ((Vl & 1073741824) !== 0 && (ut & 261930) === 0)
      ? (t.memoizedState = l)
      : ((t.memoizedState = e), (t = Xs()), (P.lanes |= t), (ge |= t), e);
  }
  function Xr(t, l, e, a) {
    return il(e, l)
      ? e
      : pa.current !== null
        ? ((t = Ef(t, e, a)), il(t, l) || (Bt = !0), t)
        : (Vl & 42) === 0 || ((Vl & 1073741824) !== 0 && (ut & 261930) === 0)
          ? ((Bt = !0), (t.memoizedState = e))
          : ((t = Xs()), (P.lanes |= t), (ge |= t), l);
  }
  function Qr(t, l, e, a, u) {
    var n = B.p;
    B.p = n !== 0 && 8 > n ? n : 8;
    var i = D.T,
      c = {};
    ((D.T = c), Af(t, !1, l, e));
    try {
      var d = u(),
        T = D.S;
      if (
        (T !== null && T(c, d),
        d !== null && typeof d == "object" && typeof d.then == "function")
      ) {
        var O = Qm(d, a);
        ou(t, l, O, dl(t));
      } else ou(t, l, a, dl(t));
    } catch (C) {
      ou(t, l, { then: function () {}, status: "rejected", reason: C }, dl());
    } finally {
      ((B.p = n),
        i !== null && c.types !== null && (i.types = c.types),
        (D.T = i));
    }
  }
  function $m() {}
  function Tf(t, l, e, a) {
    if (t.tag !== 5) throw Error(o(476));
    var u = Zr(t).queue;
    Qr(
      t,
      u,
      l,
      w,
      e === null
        ? $m
        : function () {
            return (Vr(t), e(a));
          },
    );
  }
  function Zr(t) {
    var l = t.memoizedState;
    if (l !== null) return l;
    l = {
      memoizedState: w,
      baseState: w,
      baseQueue: null,
      queue: {
        pending: null,
        lanes: 0,
        dispatch: null,
        lastRenderedReducer: Kl,
        lastRenderedState: w,
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
          lastRenderedReducer: Kl,
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
      ou(t, l.next.queue, {}, dl()));
  }
  function zf() {
    return Zt(Ru);
  }
  function Kr() {
    return Nt().memoizedState;
  }
  function Jr() {
    return Nt().memoizedState;
  }
  function Wm(t) {
    for (var l = t.return; l !== null; ) {
      switch (l.tag) {
        case 24:
        case 3:
          var e = dl();
          t = se(e);
          var a = de(l, t, e);
          (a !== null && (el(a, l, e), uu(a, l, e)),
            (l = { cache: Fi() }),
            (t.payload = l));
          return;
      }
      l = l.return;
    }
  }
  function km(t, l, e) {
    var a = dl();
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
        : ((e = Gi(t, l, e, a)), e !== null && (el(e, t, a), Wr(e, l, a))));
  }
  function wr(t, l, e) {
    var a = dl();
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
          if (((u.hasEagerState = !0), (u.eagerState = c), il(c, i)))
            return (tn(t, l, u, 0), bt === null && Pu(), !1);
        } catch {
        } finally {
        }
      if (((e = Gi(t, l, u, a)), e !== null))
        return (el(e, t, a), Wr(e, l, a), !0);
    }
    return !1;
  }
  function Af(t, l, e, a) {
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
    } else ((l = Gi(t, e, a, 2)), l !== null && el(l, t, 2));
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
    readContext: Zt,
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
      readContext: Zt,
      use: gn,
      useCallback: function (t, l) {
        return (($t().memoizedState = [t, l === void 0 ? null : l]), t);
      },
      useContext: Zt,
      useEffect: Hr,
      useImperativeHandle: function (t, l, e) {
        ((e = e != null ? e.concat([t]) : null),
          Sn(4194308, 4, Yr.bind(null, l, t), e));
      },
      useLayoutEffect: function (t, l) {
        return Sn(4194308, 4, t, l);
      },
      useInsertionEffect: function (t, l) {
        Sn(4, 2, t, l);
      },
      useMemo: function (t, l) {
        var e = $t();
        l = l === void 0 ? null : l;
        var a = t();
        if (Je) {
          ae(!0);
          try {
            t();
          } finally {
            ae(!1);
          }
        }
        return ((e.memoizedState = [a, l]), a);
      },
      useReducer: function (t, l, e) {
        var a = $t();
        if (e !== void 0) {
          var u = e(l);
          if (Je) {
            ae(!0);
            try {
              e(l);
            } finally {
              ae(!1);
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
          (t = t.dispatch = km.bind(null, P, t)),
          [a.memoizedState, t]
        );
      },
      useRef: function (t) {
        var l = $t();
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
        var e = $t();
        return Ef(e, t, l);
      },
      useTransition: function () {
        var t = gf(!1);
        return (
          (t = Qr.bind(null, P, t.queue, !0, !1)),
          ($t().memoizedState = t),
          [!1, t]
        );
      },
      useSyncExternalStore: function (t, l, e) {
        var a = P,
          u = $t();
        if (it) {
          if (e === void 0) throw Error(o(407));
          e = e();
        } else {
          if (((e = l()), bt === null)) throw Error(o(349));
          (ut & 127) !== 0 || gr(a, l, e);
        }
        u.memoizedState = e;
        var n = { value: e, getSnapshot: l };
        return (
          (u.queue = n),
          Hr(Sr.bind(null, a, n, t), [t]),
          (a.flags |= 2048),
          Ea(9, { destroy: void 0 }, pr.bind(null, a, n, e, l), null),
          e
        );
      },
      useId: function () {
        var t = $t(),
          l = bt.identifierPrefix;
        if (it) {
          var e = Nl,
            a = Cl;
          ((e = (a & ~(1 << (32 - nl(a) - 1))).toString(32) + e),
            (l = "_" + l + "R_" + e),
            (e = yn++),
            0 < e && (l += "H" + e.toString(32)),
            (l += "_"));
        } else ((e = Zm++), (l = "_" + l + "r_" + e.toString(32) + "_"));
        return (t.memoizedState = l);
      },
      useHostTransitionStatus: zf,
      useFormState: Mr,
      useActionState: Mr,
      useOptimistic: function (t) {
        var l = $t();
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
          (l = Af.bind(null, P, !0, e)),
          (e.dispatch = l),
          [t, l]
        );
      },
      useMemoCache: mf,
      useCacheRefresh: function () {
        return ($t().memoizedState = Wm.bind(null, P));
      },
      useEffectEvent: function (t) {
        var l = $t(),
          e = { impl: t };
        return (
          (l.memoizedState = e),
          function () {
            if ((ot & 2) !== 0) throw Error(o(440));
            return e.impl.apply(void 0, arguments);
          }
        );
      },
    },
    _f = {
      readContext: Zt,
      use: gn,
      useCallback: Lr,
      useContext: Zt,
      useEffect: Sf,
      useImperativeHandle: jr,
      useInsertionEffect: Br,
      useLayoutEffect: qr,
      useMemo: Gr,
      useReducer: pn,
      useRef: Nr,
      useState: function () {
        return pn(Kl);
      },
      useDebugValue: bf,
      useDeferredValue: function (t, l) {
        var e = Nt();
        return Xr(e, yt.memoizedState, t, l);
      },
      useTransition: function () {
        var t = pn(Kl)[0],
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
        return Tr(e, yt, t, l);
      },
      useMemoCache: mf,
      useCacheRefresh: Jr,
    };
  _f.useEffectEvent = xr;
  var Fr = {
    readContext: Zt,
    use: gn,
    useCallback: Lr,
    useContext: Zt,
    useEffect: Sf,
    useImperativeHandle: jr,
    useInsertionEffect: Br,
    useLayoutEffect: qr,
    useMemo: Gr,
    useReducer: vf,
    useRef: Nr,
    useState: function () {
      return vf(Kl);
    },
    useDebugValue: bf,
    useDeferredValue: function (t, l) {
      var e = Nt();
      return yt === null ? Ef(e, t, l) : Xr(e, yt.memoizedState, t, l);
    },
    useTransition: function () {
      var t = vf(Kl)[0],
        l = Nt().memoizedState;
      return [typeof t == "boolean" ? t : cu(t), l];
    },
    useSyncExternalStore: vr,
    useId: Kr,
    useHostTransitionStatus: zf,
    useFormState: Cr,
    useActionState: Cr,
    useOptimistic: function (t, l) {
      var e = Nt();
      return yt !== null
        ? Tr(e, yt, t, l)
        : ((e.baseState = t), [t, e.queue.dispatch]);
    },
    useMemoCache: mf,
    useCacheRefresh: Jr,
  };
  Fr.useEffectEvent = xr;
  function Rf(t, l, e, a) {
    ((l = t.memoizedState),
      (e = e(a, l)),
      (e = e == null ? l : _({}, l, e)),
      (t.memoizedState = e),
      t.lanes === 0 && (t.updateQueue.baseState = e));
  }
  var Of = {
    enqueueSetState: function (t, l, e) {
      t = t._reactInternals;
      var a = dl(),
        u = se(a);
      ((u.payload = l),
        e != null && (u.callback = e),
        (l = de(t, u, a)),
        l !== null && (el(l, t, a), uu(l, t, a)));
    },
    enqueueReplaceState: function (t, l, e) {
      t = t._reactInternals;
      var a = dl(),
        u = se(a);
      ((u.tag = 1),
        (u.payload = l),
        e != null && (u.callback = e),
        (l = de(t, u, a)),
        l !== null && (el(l, t, a), uu(l, t, a)));
    },
    enqueueForceUpdate: function (t, l) {
      t = t._reactInternals;
      var e = dl(),
        a = se(e);
      ((a.tag = 2),
        l != null && (a.callback = l),
        (l = de(t, a, e)),
        l !== null && (el(l, t, e), uu(l, t, e)));
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
      e === l && (e = _({}, e));
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
      (e = se(e)),
      (e.tag = 3),
      (e.payload = { element: null }),
      (e.callback = function () {
        Tn(t, l);
      }),
      e
    );
  }
  function us(t) {
    return ((t = se(t)), (t.tag = 3), t);
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
            (pe === null ? (pe = new Set([this])) : pe.add(this)));
        var c = a.stack;
        this.componentDidCatch(a.value, {
          componentStack: c !== null ? c : "",
        });
      });
  }
  function Fm(t, l, e, a, u) {
    if (
      ((e.flags |= 32768),
      a !== null && typeof a == "object" && typeof a.then == "function")
    ) {
      if (
        ((l = e.alternate),
        l !== null && ha(l, e, u, !0),
        (e = cl.current),
        e !== null)
      ) {
        switch (e.tag) {
          case 31:
          case 13:
            return (
              Tl === null ? xn() : e.alternate === null && Mt === 0 && (Mt = 3),
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
      return (Pf(t, a, u), xn(), !1);
    }
    if (it)
      return (
        (l = cl.current),
        l !== null
          ? ((l.flags & 65536) === 0 && (l.flags |= 256),
            (l.flags |= 65536),
            (l.lanes = u),
            a !== Ji && ((t = Error(o(422), { cause: a })), Pa(pl(t, e))))
          : (a !== Ji && ((l = Error(o(423), { cause: a })), Pa(pl(l, e))),
            (t = t.current.alternate),
            (t.flags |= 65536),
            (u &= -u),
            (t.lanes |= u),
            (a = pl(a, e)),
            (u = Mf(t.stateNode, a, u)),
            af(t, u),
            Mt !== 4 && (Mt = 2)),
        !1
      );
    var n = Error(o(520), { cause: a });
    if (
      ((n = pl(n, e)),
      pu === null ? (pu = [n]) : pu.push(n),
      Mt !== 4 && (Mt = 2),
      l === null)
    )
      return !0;
    ((a = pl(a, e)), (e = l));
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
                  (pe === null || !pe.has(n)))))
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
    Bt = !1;
  function Vt(t, l, e, a) {
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
      t !== null && !Bt
        ? (df(t, l, u), Jl(t, l, u))
        : (it && c && Vi(l), (l.flags |= 1), Vt(t, l, a, u), l.child)
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
    if (((n = t.child), !Yf(t, u))) {
      var i = n.memoizedProps;
      if (
        ((e = e.compare), (e = e !== null ? e : ka), e(i, a) && t.ref === l.ref)
      )
        return Jl(t, l, u);
    }
    return (
      (l.flags |= 1),
      (t = Gl(n, a)),
      (t.ref = l.ref),
      (t.return = l),
      (l.child = t)
    );
  }
  function cs(t, l, e, a, u) {
    if (t !== null) {
      var n = t.memoizedProps;
      if (ka(n, a) && t.ref === l.ref)
        if (((Bt = !1), (l.pendingProps = a = n), Yf(t, u)))
          (t.flags & 131072) !== 0 && (Bt = !0);
        else return ((l.lanes = t.lanes), Jl(t, l, u));
    }
    return Uf(t, l, e, a, u);
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
        ? (fn(l, n.cachePool), dr(l, n), me(), (l.memoizedState = null))
        : (t !== null && fn(l, null), nf(), me());
    return (Vt(t, l, u, e), l.child);
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
      (l = _n({ mode: l.mode, children: l.children }, t.mode)),
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
      ol(l),
      (l.memoizedState = null),
      t
    );
  }
  function Im(t, l, e) {
    var a = l.pendingProps,
      u = (l.flags & 128) !== 0;
    if (((l.flags &= -129), t === null)) {
      if (it) {
        if (a.mode === "hidden")
          return ((t = zn(l, a)), (l.lanes = 536870912), su(null, t));
        if (
          (cf(l),
          (t = Et)
            ? ((t = zd(t, El)),
              (t = t !== null && t.data === "&" ? t : null),
              t !== null &&
                ((l.memoizedState = {
                  dehydrated: t,
                  treeContext: ie !== null ? { id: Cl, overflow: Nl } : null,
                  retryLane: 536870912,
                  hydrationErrors: null,
                }),
                (e = $o(t)),
                (e.return = l),
                (l.child = e),
                (Qt = l),
                (Et = null)))
            : (t = null),
          t === null)
        )
          throw ce(l);
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
        (Bt || ha(t, l, e, !1), (u = (e & t.childLanes) !== 0), Bt || u)
      ) {
        if (
          ((a = bt),
          a !== null && ((i = to(a, e)), i !== 0 && i !== n.retryLane))
        )
          throw ((n.retryLane = i), Ye(t, i), el(a, t, i), Df);
        (xn(), (l = ss(t, l, e)));
      } else
        ((t = n.treeContext),
          (Et = zl(i.nextSibling)),
          (Qt = l),
          (it = !0),
          (fe = null),
          (El = !1),
          t !== null && Fo(l, t),
          (l = zn(l, a)),
          (l.flags |= 4096));
      return l;
    }
    return (
      (t = Gl(t.child, { mode: a.mode, children: a.children })),
      (t.ref = l.ref),
      (l.child = t),
      (t.return = l),
      t
    );
  }
  function An(t, l) {
    var e = l.ref;
    if (e === null) t !== null && t.ref !== null && (l.flags |= 4194816);
    else {
      if (typeof e != "function" && typeof e != "object") throw Error(o(284));
      (t === null || t.ref !== e) && (l.flags |= 4194816);
    }
  }
  function Uf(t, l, e, a, u) {
    return (
      Xe(l),
      (e = rf(t, l, e, a, void 0, u)),
      (a = sf()),
      t !== null && !Bt
        ? (df(t, l, u), Jl(t, l, u))
        : (it && a && Vi(l), (l.flags |= 1), Vt(t, l, e, u), l.child)
    );
  }
  function ds(t, l, e, a, u, n) {
    return (
      Xe(l),
      (l.updateQueue = null),
      (e = yr(l, a, e, u)),
      mr(t),
      (a = sf()),
      t !== null && !Bt
        ? (df(t, l, n), Jl(t, l, n))
        : (it && a && Vi(l), (l.flags |= 1), Vt(t, l, e, n), l.child)
    );
  }
  function hs(t, l, e, a, u) {
    if ((Xe(l), l.stateNode === null)) {
      var n = oa,
        i = e.contextType;
      (typeof i == "object" && i !== null && (n = Zt(i)),
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
        (n.context = typeof i == "object" && i !== null ? Zt(i) : oa),
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
        O = e.contextType;
      ((i = oa), typeof O == "object" && O !== null && (i = Zt(O)));
      var C = e.getDerivedStateFromProps;
      ((O =
        typeof C == "function" ||
        typeof n.getSnapshotBeforeUpdate == "function"),
        (c = l.pendingProps !== c),
        O ||
          (typeof n.UNSAFE_componentWillReceiveProps != "function" &&
            typeof n.componentWillReceiveProps != "function") ||
          ((c || T !== i) && Pr(l, n, a, i)),
        (re = !1));
      var z = l.memoizedState;
      ((n.state = z),
        iu(l, a, n, u),
        nu(),
        (T = l.memoizedState),
        c || z !== T || re
          ? (typeof C == "function" && (Rf(l, e, C, a), (T = l.memoizedState)),
            (d = re || Ir(l, e, d, a, z, T, i))
              ? (O ||
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
        (O = we(e, i)),
        (n.props = O),
        (C = l.pendingProps),
        (z = n.context),
        (T = e.contextType),
        (d = oa),
        typeof T == "object" && T !== null && (d = Zt(T)),
        (c = e.getDerivedStateFromProps),
        (T =
          typeof c == "function" ||
          typeof n.getSnapshotBeforeUpdate == "function") ||
          (typeof n.UNSAFE_componentWillReceiveProps != "function" &&
            typeof n.componentWillReceiveProps != "function") ||
          ((i !== C || z !== d) && Pr(l, n, a, d)),
        (re = !1),
        (z = l.memoizedState),
        (n.state = z),
        iu(l, a, n, u),
        nu());
      var A = l.memoizedState;
      i !== C ||
      z !== A ||
      re ||
      (t !== null && t.dependencies !== null && un(t.dependencies))
        ? (typeof c == "function" && (Rf(l, e, c, a), (A = l.memoizedState)),
          (O =
            re ||
            Ir(l, e, O, a, z, A, d) ||
            (t !== null && t.dependencies !== null && un(t.dependencies)))
            ? (T ||
                (typeof n.UNSAFE_componentWillUpdate != "function" &&
                  typeof n.componentWillUpdate != "function") ||
                (typeof n.componentWillUpdate == "function" &&
                  n.componentWillUpdate(a, A, d),
                typeof n.UNSAFE_componentWillUpdate == "function" &&
                  n.UNSAFE_componentWillUpdate(a, A, d)),
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
              (l.memoizedState = A)),
          (n.props = a),
          (n.state = A),
          (n.context = d),
          (a = O))
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
      An(t, l),
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
            : Vt(t, l, e, u),
          (l.memoizedState = n.state),
          (t = l.child))
        : (t = Jl(t, l, u)),
      t
    );
  }
  function ms(t, l, e, a) {
    return (Le(), (l.flags |= 256), Vt(t, l, e, a), l.child);
  }
  var Cf = {
    dehydrated: null,
    treeContext: null,
    retryLane: 0,
    hydrationErrors: null,
  };
  function Nf(t) {
    return { baseLanes: t, cachePool: ar() };
  }
  function Hf(t, l, e) {
    return ((t = t !== null ? t.childLanes & ~e : 0), l && (t |= sl), t);
  }
  function ys(t, l, e) {
    var a = l.pendingProps,
      u = !1,
      n = (l.flags & 128) !== 0,
      i;
    if (
      ((i = n) ||
        (i =
          t !== null && t.memoizedState === null ? !1 : (Ct.current & 2) !== 0),
      i && ((u = !0), (l.flags &= -129)),
      (i = (l.flags & 32) !== 0),
      (l.flags &= -33),
      t === null)
    ) {
      if (it) {
        if (
          (u ? he(l) : me(),
          (t = Et)
            ? ((t = zd(t, El)),
              (t = t !== null && t.data !== "&" ? t : null),
              t !== null &&
                ((l.memoizedState = {
                  dehydrated: t,
                  treeContext: ie !== null ? { id: Cl, overflow: Nl } : null,
                  retryLane: 536870912,
                  hydrationErrors: null,
                }),
                (e = $o(t)),
                (e.return = l),
                (l.child = e),
                (Qt = l),
                (Et = null)))
            : (t = null),
          t === null)
        )
          throw ce(l);
        return (yc(t) ? (l.lanes = 32) : (l.lanes = 536870912), null);
      }
      var c = a.children;
      return (
        (a = a.fallback),
        u
          ? (me(),
            (u = l.mode),
            (c = _n({ mode: "hidden", children: c }, u)),
            (a = je(a, u, e, null)),
            (c.return = l),
            (a.return = l),
            (c.sibling = a),
            (l.child = c),
            (a = l.child),
            (a.memoizedState = Nf(e)),
            (a.childLanes = Hf(t, i, e)),
            (l.memoizedState = Cf),
            su(null, a))
          : (he(l), xf(l, c))
      );
    }
    var d = t.memoizedState;
    if (d !== null && ((c = d.dehydrated), c !== null)) {
      if (n)
        l.flags & 256
          ? (he(l), (l.flags &= -257), (l = Bf(t, l, e)))
          : l.memoizedState !== null
            ? (me(), (l.child = t.child), (l.flags |= 128), (l = null))
            : (me(),
              (c = a.fallback),
              (u = l.mode),
              (a = _n({ mode: "visible", children: a.children }, u)),
              (c = je(c, u, e, null)),
              (c.flags |= 2),
              (a.return = l),
              (c.return = l),
              (a.sibling = c),
              (l.child = a),
              Ke(l, t.child, null, e),
              (a = l.child),
              (a.memoizedState = Nf(e)),
              (a.childLanes = Hf(t, i, e)),
              (l.memoizedState = Cf),
              (l = su(null, a)));
      else if ((he(l), yc(c))) {
        if (((i = c.nextSibling && c.nextSibling.dataset), i)) var T = i.dgst;
        ((i = T),
          (a = Error(o(419))),
          (a.stack = ""),
          (a.digest = i),
          Pa({ value: a, source: null, stack: null }),
          (l = Bf(t, l, e)));
      } else if (
        (Bt || ha(t, l, e, !1), (i = (e & t.childLanes) !== 0), Bt || i)
      ) {
        if (
          ((i = bt),
          i !== null && ((a = to(i, e)), a !== 0 && a !== d.retryLane))
        )
          throw ((d.retryLane = a), Ye(t, a), el(i, t, a), Df);
        (mc(c) || xn(), (l = Bf(t, l, e)));
      } else
        mc(c)
          ? ((l.flags |= 192), (l.child = t.child), (l = null))
          : ((t = d.treeContext),
            (Et = zl(c.nextSibling)),
            (Qt = l),
            (it = !0),
            (fe = null),
            (El = !1),
            t !== null && Fo(l, t),
            (l = xf(l, a.children)),
            (l.flags |= 4096));
      return l;
    }
    return u
      ? (me(),
        (c = a.fallback),
        (u = l.mode),
        (d = t.child),
        (T = d.sibling),
        (a = Gl(d, { mode: "hidden", children: a.children })),
        (a.subtreeFlags = d.subtreeFlags & 65011712),
        T !== null ? (c = Gl(T, c)) : ((c = je(c, u, e, null)), (c.flags |= 2)),
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
        (a.childLanes = Hf(t, i, e)),
        (l.memoizedState = Cf),
        su(t.child, a))
      : (he(l),
        (e = t.child),
        (t = e.sibling),
        (e = Gl(e, { mode: "visible", children: a.children })),
        (e.return = l),
        (e.sibling = null),
        t !== null &&
          ((i = l.deletions),
          i === null ? ((l.deletions = [t]), (l.flags |= 16)) : i.push(t)),
        (l.child = e),
        (l.memoizedState = null),
        e);
  }
  function xf(t, l) {
    return (
      (l = _n({ mode: "visible", children: l }, t.mode)),
      (l.return = t),
      (t.child = l)
    );
  }
  function _n(t, l) {
    return ((t = fl(22, t, null, l)), (t.lanes = 0), t);
  }
  function Bf(t, l, e) {
    return (
      Ke(l, t.child, null, e),
      (t = xf(l, l.pendingProps.children)),
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
    var i = Ct.current,
      c = (i & 2) !== 0;
    if (
      (c ? ((i = (i & 1) | 2), (l.flags |= 128)) : (i &= 1),
      q(Ct, i),
      Vt(t, l, a, e),
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
  function Jl(t, l, e) {
    if (
      (t !== null && (l.dependencies = t.dependencies),
      (ge |= l.lanes),
      (e & l.childLanes) === 0)
    )
      if (t !== null) {
        if ((ha(t, l, e, !1), (e & l.childLanes) === 0)) return null;
      } else return null;
    if (t !== null && l.child !== t.child) throw Error(o(153));
    if (l.child !== null) {
      for (
        t = l.child, e = Gl(t, t.pendingProps), l.child = e, e.return = l;
        t.sibling !== null;
      )
        ((t = t.sibling),
          (e = e.sibling = Gl(t, t.pendingProps)),
          (e.return = l));
      e.sibling = null;
    }
    return l.child;
  }
  function Yf(t, l) {
    return (t.lanes & l) !== 0
      ? !0
      : ((t = t.dependencies), !!(t !== null && un(t)));
  }
  function Pm(t, l, e) {
    switch (l.tag) {
      case 3:
        (wt(l, l.stateNode.containerInfo),
          oe(l, Ht, t.memoizedState.cache),
          Le());
        break;
      case 27:
      case 5:
        Ya(l);
        break;
      case 4:
        wt(l, l.stateNode.containerInfo);
        break;
      case 10:
        oe(l, l.type, l.memoizedProps.value);
        break;
      case 31:
        if (l.memoizedState !== null) return ((l.flags |= 128), cf(l), null);
        break;
      case 13:
        var a = l.memoizedState;
        if (a !== null)
          return a.dehydrated !== null
            ? (he(l), (l.flags |= 128), null)
            : (e & l.child.childLanes) !== 0
              ? ys(t, l, e)
              : (he(l), (t = Jl(t, l, e)), t !== null ? t.sibling : null);
        he(l);
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
          q(Ct, Ct.current),
          a)
        )
          break;
        return null;
      case 22:
        return ((l.lanes = 0), os(t, l, e, l.pendingProps));
      case 24:
        oe(l, Ht, t.memoizedState.cache);
    }
    return Jl(t, l, e);
  }
  function ps(t, l, e) {
    if (t !== null)
      if (t.memoizedProps !== l.pendingProps) Bt = !0;
      else {
        if (!Yf(t, e) && (l.flags & 128) === 0) return ((Bt = !1), Pm(t, l, e));
        Bt = (t.flags & 131072) !== 0;
      }
    else ((Bt = !1), it && (l.flags & 1048576) !== 0 && ko(l, Ia, l.index));
    switch (((l.lanes = 0), l.tag)) {
      case 16:
        t: {
          var a = l.pendingProps;
          if (((t = Ze(l.elementType)), (l.type = t), typeof t == "function"))
            Xi(t)
              ? ((a = we(t, a)), (l.tag = 1), (l = hs(null, l, t, a, e)))
              : ((l.tag = 0), (l = Uf(null, l, t, a, e)));
          else {
            if (t != null) {
              var u = t.$$typeof;
              if (u === pt) {
                ((l.tag = 11), (l = is(null, l, t, a, e)));
                break t;
              } else if (u === F) {
                ((l.tag = 14), (l = fs(null, l, t, a, e)));
                break t;
              }
            }
            throw ((l = ql(t) || t), Error(o(306, l, "")));
          }
        }
        return l;
      case 0:
        return Uf(t, l, l.type, l.pendingProps, e);
      case 1:
        return ((a = l.type), (u = we(a, l.pendingProps)), hs(t, l, a, u, e));
      case 3:
        t: {
          if ((wt(l, l.stateNode.containerInfo), t === null))
            throw Error(o(387));
          a = l.pendingProps;
          var n = l.memoizedState;
          ((u = n.element), ef(t, l), iu(l, a, null, e));
          var i = l.memoizedState;
          if (
            ((a = i.cache),
            oe(l, Ht, a),
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
              ((u = pl(Error(o(424)), l)), Pa(u), (l = ms(t, l, a, e)));
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
                Et = zl(t.firstChild),
                  Qt = l,
                  it = !0,
                  fe = null,
                  El = !0,
                  e = or(l, null, a, e),
                  l.child = e;
                e;
              )
                ((e.flags = (e.flags & -3) | 4096), (e = e.sibling));
            }
          else {
            if ((Le(), a === u)) {
              l = Jl(t, l, e);
              break t;
            }
            Vt(t, l, a, e);
          }
          l = l.child;
        }
        return l;
      case 26:
        return (
          An(t, l),
          t === null
            ? (e = Dd(l.type, null, l.pendingProps, null))
              ? (l.memoizedState = e)
              : it ||
                ((e = l.type),
                (t = l.pendingProps),
                (a = Xn(lt.current).createElement(e)),
                (a[Xt] = l),
                (a[kt] = t),
                Kt(a, e, t),
                jt(a),
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
          Ya(l),
          t === null &&
            it &&
            ((a = l.stateNode = Rd(l.type, l.pendingProps, lt.current)),
            (Qt = l),
            (El = !0),
            (u = Et),
            Te(l.type) ? ((vc = u), (Et = zl(a.firstChild))) : (Et = u)),
          Vt(t, l, l.pendingProps.children, e),
          An(t, l),
          t === null && (l.flags |= 4194304),
          l.child
        );
      case 5:
        return (
          t === null &&
            it &&
            ((u = a = Et) &&
              ((a = Dy(a, l.type, l.pendingProps, El)),
              a !== null
                ? ((l.stateNode = a),
                  (Qt = l),
                  (Et = zl(a.firstChild)),
                  (El = !1),
                  (u = !0))
                : (u = !1)),
            u || ce(l)),
          Ya(l),
          (u = l.type),
          (n = l.pendingProps),
          (i = t !== null ? t.memoizedProps : null),
          (a = n.children),
          sc(u, n) ? (a = null) : i !== null && sc(u, i) && (l.flags |= 32),
          l.memoizedState !== null &&
            ((u = rf(t, l, Vm, null, null, e)), (Ru._currentValue = u)),
          An(t, l),
          Vt(t, l, a, e),
          l.child
        );
      case 6:
        return (
          t === null &&
            it &&
            ((t = e = Et) &&
              ((e = Uy(e, l.pendingProps, El)),
              e !== null
                ? ((l.stateNode = e), (Qt = l), (Et = null), (t = !0))
                : (t = !1)),
            t || ce(l)),
          null
        );
      case 13:
        return ys(t, l, e);
      case 4:
        return (
          wt(l, l.stateNode.containerInfo),
          (a = l.pendingProps),
          t === null ? (l.child = Ke(l, null, a, e)) : Vt(t, l, a, e),
          l.child
        );
      case 11:
        return is(t, l, l.type, l.pendingProps, e);
      case 7:
        return (Vt(t, l, l.pendingProps, e), l.child);
      case 8:
        return (Vt(t, l, l.pendingProps.children, e), l.child);
      case 12:
        return (Vt(t, l, l.pendingProps.children, e), l.child);
      case 10:
        return (
          (a = l.pendingProps),
          oe(l, l.type, a.value),
          Vt(t, l, a.children, e),
          l.child
        );
      case 9:
        return (
          (u = l.type._context),
          (a = l.pendingProps.children),
          Xe(l),
          (u = Zt(u)),
          (a = a(u)),
          (l.flags |= 1),
          Vt(t, l, a, e),
          l.child
        );
      case 14:
        return fs(t, l, l.type, l.pendingProps, e);
      case 15:
        return cs(t, l, l.type, l.pendingProps, e);
      case 19:
        return gs(t, l, e);
      case 31:
        return Im(t, l, e);
      case 22:
        return os(t, l, e, l.pendingProps);
      case 24:
        return (
          Xe(l),
          (a = Zt(Ht)),
          t === null
            ? ((u = Pi()),
              u === null &&
                ((u = bt),
                (n = Fi()),
                (u.pooledCache = n),
                n.refCount++,
                n !== null && (u.pooledCacheLanes |= e),
                (u = n)),
              (l.memoizedState = { parent: a, cache: u }),
              lf(l),
              oe(l, Ht, u))
            : ((t.lanes & e) !== 0 && (ef(t, l), iu(l, null, null, e), nu()),
              (u = t.memoizedState),
              (n = l.memoizedState),
              u.parent !== a
                ? ((u = { parent: a, cache: a }),
                  (l.memoizedState = u),
                  l.lanes === 0 &&
                    (l.memoizedState = l.updateQueue.baseState = u),
                  oe(l, Ht, a))
                : ((a = n.cache),
                  oe(l, Ht, a),
                  a !== u.cache && ki(l, [Ht], e, !0))),
          Vt(t, l, l.pendingProps.children, e),
          l.child
        );
      case 29:
        throw l.pendingProps;
    }
    throw Error(o(156, l.tag));
  }
  function wl(t) {
    t.flags |= 4;
  }
  function jf(t, l, e, a, u) {
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
    else if (((t.flags |= 16777216), !xd(l)))
      if (Ks()) t.flags |= 8192;
      else throw ((Ve = on), tf);
  }
  function Rn(t, l) {
    (l !== null && (t.flags |= 4),
      t.flags & 16384 &&
        ((l = t.tag !== 22 ? Fc() : 536870912), (t.lanes |= l), (_a |= l)));
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
  function Tt(t) {
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
  function ty(t, l, e) {
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
        return (Tt(l), null);
      case 1:
        return (Tt(l), null);
      case 3:
        return (
          (e = l.stateNode),
          (a = null),
          t !== null && (a = t.memoizedState.cache),
          l.memoizedState.cache !== a && (l.flags |= 2048),
          Zl(Ht),
          Ut(),
          e.pendingContext &&
            ((e.context = e.pendingContext), (e.pendingContext = null)),
          (t === null || t.child === null) &&
            (da(l)
              ? wl(l)
              : t === null ||
                (t.memoizedState.isDehydrated && (l.flags & 256) === 0) ||
                ((l.flags |= 1024), wi())),
          Tt(l),
          null
        );
      case 26:
        var u = l.type,
          n = l.memoizedState;
        return (
          t === null
            ? (wl(l),
              n !== null ? (Tt(l), Ss(l, n)) : (Tt(l), jf(l, u, null, a, e)))
            : n
              ? n !== t.memoizedState
                ? (wl(l), Tt(l), Ss(l, n))
                : (Tt(l), (l.flags &= -16777217))
              : ((t = t.memoizedProps),
                t !== a && wl(l),
                Tt(l),
                jf(l, u, t, a, e)),
          null
        );
      case 27:
        if (
          (qu(l),
          (e = lt.current),
          (u = l.type),
          t !== null && l.stateNode != null)
        )
          t.memoizedProps !== a && wl(l);
        else {
          if (!a) {
            if (l.stateNode === null) throw Error(o(166));
            return (Tt(l), null);
          }
          ((t = L.current),
            da(l) ? Io(l) : ((t = Rd(u, a, e)), (l.stateNode = t), wl(l)));
        }
        return (Tt(l), null);
      case 5:
        if ((qu(l), (u = l.type), t !== null && l.stateNode != null))
          t.memoizedProps !== a && wl(l);
        else {
          if (!a) {
            if (l.stateNode === null) throw Error(o(166));
            return (Tt(l), null);
          }
          if (((n = L.current), da(l))) Io(l);
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
            ((n[Xt] = l), (n[kt] = a));
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
            t: switch ((Kt(n, u, a), u)) {
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
            a && wl(l);
          }
        }
        return (
          Tt(l),
          jf(l, l.type, t === null ? null : t.memoizedProps, l.pendingProps, e),
          null
        );
      case 6:
        if (t && l.stateNode != null) t.memoizedProps !== a && wl(l);
        else {
          if (typeof a != "string" && l.stateNode === null) throw Error(o(166));
          if (((t = lt.current), da(l))) {
            if (
              ((t = l.stateNode),
              (e = l.memoizedProps),
              (a = null),
              (u = Qt),
              u !== null)
            )
              switch (u.tag) {
                case 27:
                case 5:
                  a = u.memoizedProps;
              }
            ((t[Xt] = l),
              (t = !!(
                t.nodeValue === e ||
                (a !== null && a.suppressHydrationWarning === !0) ||
                yd(t.nodeValue, e)
              )),
              t || ce(l, !0));
          } else
            ((t = Xn(t).createTextNode(a)), (t[Xt] = l), (l.stateNode = t));
        }
        return (Tt(l), null);
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
              t[Xt] = l;
            } else
              (Le(),
                (l.flags & 128) === 0 && (l.memoizedState = null),
                (l.flags |= 4));
            (Tt(l), (t = !1));
          } else
            ((e = wi()),
              t !== null &&
                t.memoizedState !== null &&
                (t.memoizedState.hydrationErrors = e),
              (t = !0));
          if (!t) return l.flags & 256 ? (ol(l), l) : (ol(l), null);
          if ((l.flags & 128) !== 0) throw Error(o(558));
        }
        return (Tt(l), null);
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
              u[Xt] = l;
            } else
              (Le(),
                (l.flags & 128) === 0 && (l.memoizedState = null),
                (l.flags |= 4));
            (Tt(l), (u = !1));
          } else
            ((u = wi()),
              t !== null &&
                t.memoizedState !== null &&
                (t.memoizedState.hydrationErrors = u),
              (u = !0));
          if (!u) return l.flags & 256 ? (ol(l), l) : (ol(l), null);
        }
        return (
          ol(l),
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
              Tt(l),
              null)
        );
      case 4:
        return (Ut(), t === null && ic(l.stateNode.containerInfo), Tt(l), null);
      case 10:
        return (Zl(l.type), Tt(l), null);
      case 19:
        if ((H(Ct), (a = l.memoizedState), a === null)) return (Tt(l), null);
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
                    q(Ct, (Ct.current & 1) | 2),
                    it && Xl(l, a.treeForkCount),
                    l.child
                  );
                }
                t = t.sibling;
              }
            a.tail !== null &&
              al() > Cn &&
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
                return (Tt(l), null);
            } else
              2 * al() - a.renderingStartTime > Cn &&
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
            (a.renderingStartTime = al()),
            (t.sibling = null),
            (e = Ct.current),
            q(Ct, u ? (e & 1) | 2 : e & 1),
            it && Xl(l, a.treeForkCount),
            t)
          : (Tt(l), null);
      case 22:
      case 23:
        return (
          ol(l),
          ff(),
          (a = l.memoizedState !== null),
          t !== null
            ? (t.memoizedState !== null) !== a && (l.flags |= 8192)
            : a && (l.flags |= 8192),
          a
            ? (e & 536870912) !== 0 &&
              (l.flags & 128) === 0 &&
              (Tt(l), l.subtreeFlags & 6 && (l.flags |= 8192))
            : Tt(l),
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
          t !== null && H(Qe),
          null
        );
      case 24:
        return (
          (e = null),
          t !== null && (e = t.memoizedState.cache),
          l.memoizedState.cache !== e && (l.flags |= 2048),
          Zl(Ht),
          Tt(l),
          null
        );
      case 25:
        return null;
      case 30:
        return null;
    }
    throw Error(o(156, l.tag));
  }
  function ly(t, l) {
    switch ((Ki(l), l.tag)) {
      case 1:
        return (
          (t = l.flags),
          t & 65536 ? ((l.flags = (t & -65537) | 128), l) : null
        );
      case 3:
        return (
          Zl(Ht),
          Ut(),
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
          if ((ol(l), l.alternate === null)) throw Error(o(340));
          Le();
        }
        return (
          (t = l.flags),
          t & 65536 ? ((l.flags = (t & -65537) | 128), l) : null
        );
      case 13:
        if (
          (ol(l), (t = l.memoizedState), t !== null && t.dehydrated !== null)
        ) {
          if (l.alternate === null) throw Error(o(340));
          Le();
        }
        return (
          (t = l.flags),
          t & 65536 ? ((l.flags = (t & -65537) | 128), l) : null
        );
      case 19:
        return (H(Ct), null);
      case 4:
        return (Ut(), null);
      case 10:
        return (Zl(l.type), null);
      case 22:
      case 23:
        return (
          ol(l),
          ff(),
          t !== null && H(Qe),
          (t = l.flags),
          t & 65536 ? ((l.flags = (t & -65537) | 128), l) : null
        );
      case 24:
        return (Zl(Ht), null);
      case 25:
        return null;
      default:
        return null;
    }
  }
  function bs(t, l) {
    switch ((Ki(l), l.tag)) {
      case 3:
        (Zl(Ht), Ut());
        break;
      case 26:
      case 27:
      case 5:
        qu(l);
        break;
      case 4:
        Ut();
        break;
      case 31:
        l.memoizedState !== null && ol(l);
        break;
      case 13:
        ol(l);
        break;
      case 19:
        H(Ct);
        break;
      case 10:
        Zl(l.type);
        break;
      case 22:
      case 23:
        (ol(l), ff(), t !== null && H(Qe));
        break;
      case 24:
        Zl(Ht);
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
      dt(l, l.return, c);
    }
  }
  function ye(t, l, e) {
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
              } catch (O) {
                dt(u, d, O);
              }
            }
          }
          a = a.next;
        } while (a !== n);
      }
    } catch (O) {
      dt(l, l.return, O);
    }
  }
  function Es(t) {
    var l = t.updateQueue;
    if (l !== null) {
      var e = t.stateNode;
      try {
        sr(l, e);
      } catch (a) {
        dt(t, t.return, a);
      }
    }
  }
  function Ts(t, l, e) {
    ((e.props = we(t.type, t.memoizedProps)), (e.state = t.memoizedState));
    try {
      e.componentWillUnmount();
    } catch (a) {
      dt(t, l, a);
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
      dt(t, l, u);
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
          dt(t, l, u);
        } finally {
          ((t.refCleanup = null),
            (t = t.alternate),
            t != null && (t.refCleanup = null));
        }
      else if (typeof e == "function")
        try {
          e(null);
        } catch (u) {
          dt(t, l, u);
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
      dt(t, t.return, u);
    }
  }
  function Lf(t, l, e) {
    try {
      var a = t.stateNode;
      (zy(a, t.type, e, l), (a[kt] = l));
    } catch (u) {
      dt(t, t.return, u);
    }
  }
  function As(t) {
    return (
      t.tag === 5 ||
      t.tag === 3 ||
      t.tag === 26 ||
      (t.tag === 27 && Te(t.type)) ||
      t.tag === 4
    );
  }
  function Gf(t) {
    t: for (;;) {
      for (; t.sibling === null; ) {
        if (t.return === null || As(t.return)) return null;
        t = t.return;
      }
      for (
        t.sibling.return = t.return, t = t.sibling;
        t.tag !== 5 && t.tag !== 6 && t.tag !== 18;
      ) {
        if (
          (t.tag === 27 && Te(t.type)) ||
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
            e != null || l.onclick !== null || (l.onclick = jl)));
    else if (
      a !== 4 &&
      (a === 27 && Te(t.type) && ((e = t.stateNode), (l = null)),
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
      (a === 27 && Te(t.type) && (e = t.stateNode), (t = t.child), t !== null)
    )
      for (On(t, l, e), t = t.sibling; t !== null; )
        (On(t, l, e), (t = t.sibling));
  }
  function _s(t) {
    var l = t.stateNode,
      e = t.memoizedProps;
    try {
      for (var a = t.type, u = l.attributes; u.length; )
        l.removeAttributeNode(u[0]);
      (Kt(l, a, e), (l[Xt] = t), (l[kt] = e));
    } catch (n) {
      dt(t, t.return, n);
    }
  }
  var $l = !1,
    qt = !1,
    Qf = !1,
    Rs = typeof WeakSet == "function" ? WeakSet : Set,
    Lt = null;
  function ey(t, l) {
    if (((t = t.containerInfo), (oc = $n), (t = jo(t)), xi(t))) {
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
              O = 0,
              C = t,
              z = null;
            l: for (;;) {
              for (
                var A;
                C !== e || (u !== 0 && C.nodeType !== 3) || (c = i + u),
                  C !== n || (a !== 0 && C.nodeType !== 3) || (d = i + a),
                  C.nodeType === 3 && (i += C.nodeValue.length),
                  (A = C.firstChild) !== null;
              )
                ((z = C), (C = A));
              for (;;) {
                if (C === t) break l;
                if (
                  (z === e && ++T === u && (c = i),
                  z === n && ++O === a && (d = i),
                  (A = C.nextSibling) !== null)
                )
                  break;
                ((C = z), (z = C.parentNode));
              }
              C = A;
            }
            e = c === -1 || d === -1 ? null : { start: c, end: d };
          } else e = null;
        }
      e = e || { start: 0, end: 0 };
    } else e = null;
    for (
      rc = { focusedElem: t, selectionRange: e }, $n = !1, Lt = l;
      Lt !== null;
    )
      if (
        ((l = Lt), (t = l.child), (l.subtreeFlags & 1028) !== 0 && t !== null)
      )
        ((t.return = l), (Lt = t));
      else
        for (; Lt !== null; ) {
          switch (((l = Lt), (n = l.alternate), (t = l.flags), l.tag)) {
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
                  var j = we(e.type, u);
                  ((t = a.getSnapshotBeforeUpdate(j, n)),
                    (a.__reactInternalSnapshotBeforeUpdate = t));
                } catch (J) {
                  dt(e, e.return, J);
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
            ((t.return = l.return), (Lt = t));
            break;
          }
          Lt = l.return;
        }
  }
  function Os(t, l, e) {
    var a = e.flags;
    switch (e.tag) {
      case 0:
      case 11:
      case 15:
        (kl(t, e), a & 4 && hu(5, e));
        break;
      case 1:
        if ((kl(t, e), a & 4))
          if (((t = e.stateNode), l === null))
            try {
              t.componentDidMount();
            } catch (i) {
              dt(e, e.return, i);
            }
          else {
            var u = we(e.type, l.memoizedProps);
            l = l.memoizedState;
            try {
              t.componentDidUpdate(u, l, t.__reactInternalSnapshotBeforeUpdate);
            } catch (i) {
              dt(e, e.return, i);
            }
          }
        (a & 64 && Es(e), a & 512 && mu(e, e.return));
        break;
      case 3:
        if ((kl(t, e), a & 64 && ((t = e.updateQueue), t !== null))) {
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
            dt(e, e.return, i);
          }
        }
        break;
      case 27:
        l === null && a & 4 && _s(e);
      case 26:
      case 5:
        (kl(t, e), l === null && a & 4 && zs(e), a & 512 && mu(e, e.return));
        break;
      case 12:
        kl(t, e);
        break;
      case 31:
        (kl(t, e), a & 4 && Us(t, e));
        break;
      case 13:
        (kl(t, e),
          a & 4 && Cs(t, e),
          a & 64 &&
            ((t = e.memoizedState),
            t !== null &&
              ((t = t.dehydrated),
              t !== null && ((e = sy.bind(null, e)), Cy(t, e)))));
        break;
      case 22:
        if (((a = e.memoizedState !== null || $l), !a)) {
          ((l = (l !== null && l.memoizedState !== null) || qt), (u = $l));
          var n = qt;
          (($l = a),
            (qt = l) && !n ? Fl(t, e, (e.subtreeFlags & 8772) !== 0) : kl(t, e),
            ($l = u),
            (qt = n));
        }
        break;
      case 30:
        break;
      default:
        kl(t, e);
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
    It = !1;
  function Wl(t, l, e) {
    for (e = e.child; e !== null; ) (Ds(t, l, e), (e = e.sibling));
  }
  function Ds(t, l, e) {
    if (ul && typeof ul.onCommitFiberUnmount == "function")
      try {
        ul.onCommitFiberUnmount(ja, e);
      } catch {}
    switch (e.tag) {
      case 26:
        (qt || Hl(e, l),
          Wl(t, l, e),
          e.memoizedState
            ? e.memoizedState.count--
            : e.stateNode && ((e = e.stateNode), e.parentNode.removeChild(e)));
        break;
      case 27:
        qt || Hl(e, l);
        var a = At,
          u = It;
        (Te(e.type) && ((At = e.stateNode), (It = !1)),
          Wl(t, l, e),
          zu(e.stateNode),
          (At = a),
          (It = u));
        break;
      case 5:
        qt || Hl(e, l);
      case 6:
        if (
          ((a = At),
          (u = It),
          (At = null),
          Wl(t, l, e),
          (At = a),
          (It = u),
          At !== null)
        )
          if (It)
            try {
              (At.nodeType === 9
                ? At.body
                : At.nodeName === "HTML"
                  ? At.ownerDocument.body
                  : At
              ).removeChild(e.stateNode);
            } catch (n) {
              dt(e, l, n);
            }
          else
            try {
              At.removeChild(e.stateNode);
            } catch (n) {
              dt(e, l, n);
            }
        break;
      case 18:
        At !== null &&
          (It
            ? ((t = At),
              Ed(
                t.nodeType === 9
                  ? t.body
                  : t.nodeName === "HTML"
                    ? t.ownerDocument.body
                    : t,
                e.stateNode,
              ),
              Ha(t))
            : Ed(At, e.stateNode));
        break;
      case 4:
        ((a = At),
          (u = It),
          (At = e.stateNode.containerInfo),
          (It = !0),
          Wl(t, l, e),
          (At = a),
          (It = u));
        break;
      case 0:
      case 11:
      case 14:
      case 15:
        (ye(2, e, l), qt || ye(4, e, l), Wl(t, l, e));
        break;
      case 1:
        (qt ||
          (Hl(e, l),
          (a = e.stateNode),
          typeof a.componentWillUnmount == "function" && Ts(e, l, a)),
          Wl(t, l, e));
        break;
      case 21:
        Wl(t, l, e);
        break;
      case 22:
        ((qt = (a = qt) || e.memoizedState !== null), Wl(t, l, e), (qt = a));
        break;
      default:
        Wl(t, l, e);
    }
  }
  function Us(t, l) {
    if (
      l.memoizedState === null &&
      ((t = l.alternate), t !== null && ((t = t.memoizedState), t !== null))
    ) {
      t = t.dehydrated;
      try {
        Ha(t);
      } catch (e) {
        dt(l, l.return, e);
      }
    }
  }
  function Cs(t, l) {
    if (
      l.memoizedState === null &&
      ((t = l.alternate),
      t !== null &&
        ((t = t.memoizedState), t !== null && ((t = t.dehydrated), t !== null)))
    )
      try {
        Ha(t);
      } catch (e) {
        dt(l, l.return, e);
      }
  }
  function ay(t) {
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
    var e = ay(t);
    l.forEach(function (a) {
      if (!e.has(a)) {
        e.add(a);
        var u = dy.bind(null, t, a);
        a.then(u, u);
      }
    });
  }
  function Pt(t, l) {
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
              if (Te(c.type)) {
                ((At = c.stateNode), (It = !1));
                break t;
              }
              break;
            case 5:
              ((At = c.stateNode), (It = !1));
              break t;
            case 3:
            case 4:
              ((At = c.stateNode.containerInfo), (It = !0));
              break t;
          }
          c = c.return;
        }
        if (At === null) throw Error(o(160));
        (Ds(n, i, u),
          (At = null),
          (It = !1),
          (n = u.alternate),
          n !== null && (n.return = null),
          (u.return = null));
      }
    if (l.subtreeFlags & 13886)
      for (l = l.child; l !== null; ) (Ns(l, t), (l = l.sibling));
  }
  var Ol = null;
  function Ns(t, l) {
    var e = t.alternate,
      a = t.flags;
    switch (t.tag) {
      case 0:
      case 11:
      case 14:
      case 15:
        (Pt(l, t),
          tl(t),
          a & 4 && (ye(3, t, t.return), hu(3, t), ye(5, t, t.return)));
        break;
      case 1:
        (Pt(l, t),
          tl(t),
          a & 512 && (qt || e === null || Hl(e, e.return)),
          a & 64 &&
            $l &&
            ((t = t.updateQueue),
            t !== null &&
              ((a = t.callbacks),
              a !== null &&
                ((e = t.shared.hiddenCallbacks),
                (t.shared.hiddenCallbacks = e === null ? a : e.concat(a))))));
        break;
      case 26:
        var u = Ol;
        if (
          (Pt(l, t),
          tl(t),
          a & 512 && (qt || e === null || Hl(e, e.return)),
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
                          n[Xt] ||
                          n.namespaceURI === "http://www.w3.org/2000/svg" ||
                          n.hasAttribute("itemprop")) &&
                          ((n = u.createElement(a)),
                          u.head.insertBefore(
                            n,
                            u.querySelector("head > title"),
                          )),
                        Kt(n, a, e),
                        (n[Xt] = t),
                        jt(n),
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
                        Kt(n, a, e),
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
                        Kt(n, a, e),
                        u.head.appendChild(n));
                      break;
                    default:
                      throw Error(o(468, a));
                  }
                  ((n[Xt] = t), jt(n), (a = n));
                }
                t.stateNode = a;
              } else Hd(u, t.type, t.stateNode);
            else t.stateNode = Cd(u, a, t.memoizedProps);
          else
            n !== a
              ? (n === null
                  ? e.stateNode !== null &&
                    ((e = e.stateNode), e.parentNode.removeChild(e))
                  : n.count--,
                a === null
                  ? Hd(u, t.type, t.stateNode)
                  : Cd(u, a, t.memoizedProps))
              : a === null &&
                t.stateNode !== null &&
                Lf(t, t.memoizedProps, e.memoizedProps);
        }
        break;
      case 27:
        (Pt(l, t),
          tl(t),
          a & 512 && (qt || e === null || Hl(e, e.return)),
          e !== null && a & 4 && Lf(t, t.memoizedProps, e.memoizedProps));
        break;
      case 5:
        if (
          (Pt(l, t),
          tl(t),
          a & 512 && (qt || e === null || Hl(e, e.return)),
          t.flags & 32)
        ) {
          u = t.stateNode;
          try {
            ea(u, "");
          } catch (j) {
            dt(t, t.return, j);
          }
        }
        (a & 4 &&
          t.stateNode != null &&
          ((u = t.memoizedProps), Lf(t, u, e !== null ? e.memoizedProps : u)),
          a & 1024 && (Qf = !0));
        break;
      case 6:
        if ((Pt(l, t), tl(t), a & 4)) {
          if (t.stateNode === null) throw Error(o(162));
          ((a = t.memoizedProps), (e = t.stateNode));
          try {
            e.nodeValue = a;
          } catch (j) {
            dt(t, t.return, j);
          }
        }
        break;
      case 3:
        if (
          ((Vn = null),
          (u = Ol),
          (Ol = Qn(l.containerInfo)),
          Pt(l, t),
          (Ol = u),
          tl(t),
          a & 4 && e !== null && e.memoizedState.isDehydrated)
        )
          try {
            Ha(l.containerInfo);
          } catch (j) {
            dt(t, t.return, j);
          }
        Qf && ((Qf = !1), Hs(t));
        break;
      case 4:
        ((a = Ol),
          (Ol = Qn(t.stateNode.containerInfo)),
          Pt(l, t),
          tl(t),
          (Ol = a));
        break;
      case 12:
        (Pt(l, t), tl(t));
        break;
      case 31:
        (Pt(l, t),
          tl(t),
          a & 4 &&
            ((a = t.updateQueue),
            a !== null && ((t.updateQueue = null), Mn(t, a))));
        break;
      case 13:
        (Pt(l, t),
          tl(t),
          t.child.flags & 8192 &&
            (t.memoizedState !== null) !=
              (e !== null && e.memoizedState !== null) &&
            (Un = al()),
          a & 4 &&
            ((a = t.updateQueue),
            a !== null && ((t.updateQueue = null), Mn(t, a))));
        break;
      case 22:
        u = t.memoizedState !== null;
        var d = e !== null && e.memoizedState !== null,
          T = $l,
          O = qt;
        if (
          (($l = T || u),
          (qt = O || d),
          Pt(l, t),
          (qt = O),
          ($l = T),
          tl(t),
          a & 8192)
        )
          t: for (
            l = t.stateNode,
              l._visibility = u ? l._visibility & -2 : l._visibility | 1,
              u && (e === null || d || $l || qt || $e(t)),
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
                    var C = d.memoizedProps.style,
                      z =
                        C != null && C.hasOwnProperty("display")
                          ? C.display
                          : null;
                    c.style.display =
                      z == null || typeof z == "boolean" ? "" : ("" + z).trim();
                  }
                } catch (j) {
                  dt(d, d.return, j);
                }
              }
            } else if (l.tag === 6) {
              if (e === null) {
                d = l;
                try {
                  d.stateNode.nodeValue = u ? "" : d.memoizedProps;
                } catch (j) {
                  dt(d, d.return, j);
                }
              }
            } else if (l.tag === 18) {
              if (e === null) {
                d = l;
                try {
                  var A = d.stateNode;
                  u ? Td(A, !0) : Td(d.stateNode, !1);
                } catch (j) {
                  dt(d, d.return, j);
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
        (Pt(l, t),
          tl(t),
          a & 4 &&
            ((a = t.updateQueue),
            a !== null && ((t.updateQueue = null), Mn(t, a))));
        break;
      case 30:
        break;
      case 21:
        break;
      default:
        (Pt(l, t), tl(t));
    }
  }
  function tl(t) {
    var l = t.flags;
    if (l & 2) {
      try {
        for (var e, a = t.return; a !== null; ) {
          if (As(a)) {
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
      } catch (O) {
        dt(t, t.return, O);
      }
      t.flags &= -3;
    }
    l & 4096 && (t.flags &= -4097);
  }
  function Hs(t) {
    if (t.subtreeFlags & 1024)
      for (t = t.child; t !== null; ) {
        var l = t;
        (Hs(l),
          l.tag === 5 && l.flags & 1024 && l.stateNode.reset(),
          (t = t.sibling));
      }
  }
  function kl(t, l) {
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
          (ye(4, l, l.return), $e(l));
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
  function Fl(t, l, e) {
    for (e = e && (l.subtreeFlags & 8772) !== 0, l = l.child; l !== null; ) {
      var a = l.alternate,
        u = t,
        n = l,
        i = n.flags;
      switch (n.tag) {
        case 0:
        case 11:
        case 15:
          (Fl(u, n, e), hu(4, n));
          break;
        case 1:
          if (
            (Fl(u, n, e),
            (a = n),
            (u = a.stateNode),
            typeof u.componentDidMount == "function")
          )
            try {
              u.componentDidMount();
            } catch (T) {
              dt(a, a.return, T);
            }
          if (((a = n), (u = a.updateQueue), u !== null)) {
            var c = a.stateNode;
            try {
              var d = u.shared.hiddenCallbacks;
              if (d !== null)
                for (u.shared.hiddenCallbacks = null, u = 0; u < d.length; u++)
                  rr(d[u], c);
            } catch (T) {
              dt(a, a.return, T);
            }
          }
          (e && i & 64 && Es(n), mu(n, n.return));
          break;
        case 27:
          _s(n);
        case 26:
        case 5:
          (Fl(u, n, e), e && a === null && i & 4 && zs(n), mu(n, n.return));
          break;
        case 12:
          Fl(u, n, e);
          break;
        case 31:
          (Fl(u, n, e), e && i & 4 && Us(u, n));
          break;
        case 13:
          (Fl(u, n, e), e && i & 4 && Cs(u, n));
          break;
        case 22:
          (n.memoizedState === null && Fl(u, n, e), mu(n, n.return));
          break;
        case 30:
          break;
        default:
          Fl(u, n, e);
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
  function Ml(t, l, e, a) {
    if (l.subtreeFlags & 10256)
      for (l = l.child; l !== null; ) (xs(t, l, e, a), (l = l.sibling));
  }
  function xs(t, l, e, a) {
    var u = l.flags;
    switch (l.tag) {
      case 0:
      case 11:
      case 15:
        (Ml(t, l, e, a), u & 2048 && hu(9, l));
        break;
      case 1:
        Ml(t, l, e, a);
        break;
      case 3:
        (Ml(t, l, e, a),
          u & 2048 &&
            ((t = null),
            l.alternate !== null && (t = l.alternate.memoizedState.cache),
            (l = l.memoizedState.cache),
            l !== t && (l.refCount++, t != null && tu(t))));
        break;
      case 12:
        if (u & 2048) {
          (Ml(t, l, e, a), (t = l.stateNode));
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
            dt(l, l.return, d);
          }
        } else Ml(t, l, e, a);
        break;
      case 31:
        Ml(t, l, e, a);
        break;
      case 13:
        Ml(t, l, e, a);
        break;
      case 23:
        break;
      case 22:
        ((n = l.stateNode),
          (i = l.alternate),
          l.memoizedState !== null
            ? n._visibility & 2
              ? Ml(t, l, e, a)
              : yu(t, l)
            : n._visibility & 2
              ? Ml(t, l, e, a)
              : ((n._visibility |= 2),
                Ta(t, l, e, a, (l.subtreeFlags & 10256) !== 0 || !1)),
          u & 2048 && Zf(i, l));
        break;
      case 24:
        (Ml(t, l, e, a), u & 2048 && Vf(l.alternate, l));
        break;
      default:
        Ml(t, l, e, a);
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
          var O = i.stateNode;
          (i.memoizedState !== null
            ? O._visibility & 2
              ? Ta(n, i, c, d, u)
              : yu(n, i)
            : ((O._visibility |= 2), Ta(n, i, c, d, u)),
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
            Zy(e, Ol, t.memoizedState, t.memoizedProps));
        break;
      case 5:
        za(t, l, e);
        break;
      case 3:
      case 4:
        var a = Ol;
        ((Ol = Qn(t.stateNode.containerInfo)), za(t, l, e), (Ol = a));
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
          ((Lt = a), js(a, t));
        }
      qs(t);
    }
    if (t.subtreeFlags & 10256)
      for (t = t.child; t !== null; ) (Ys(t), (t = t.sibling));
  }
  function Ys(t) {
    switch (t.tag) {
      case 0:
      case 11:
      case 15:
        (gu(t), t.flags & 2048 && ye(9, t, t.return));
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
          ((Lt = a), js(a, t));
        }
      qs(t);
    }
    for (t = t.child; t !== null; ) {
      switch (((l = t), l.tag)) {
        case 0:
        case 11:
        case 15:
          (ye(8, l, l.return), Dn(l));
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
  function js(t, l) {
    for (; Lt !== null; ) {
      var e = Lt;
      switch (e.tag) {
        case 0:
        case 11:
        case 15:
          ye(8, e, l);
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
      if (((a = e.child), a !== null)) ((a.return = e), (Lt = a));
      else
        t: for (e = t; Lt !== null; ) {
          a = Lt;
          var u = a.sibling,
            n = a.return;
          if ((Ms(a), a === e)) {
            Lt = null;
            break t;
          }
          if (u !== null) {
            ((u.return = n), (Lt = u));
            break t;
          }
          Lt = n;
        }
    }
  }
  var uy = {
      getCacheForType: function (t) {
        var l = Zt(Ht),
          e = l.data.get(t);
        return (e === void 0 && ((e = t()), l.data.set(t, e)), e);
      },
      cacheSignal: function () {
        return Zt(Ht).controller.signal;
      },
    },
    ny = typeof WeakMap == "function" ? WeakMap : Map,
    ot = 0,
    bt = null,
    et = null,
    ut = 0,
    st = 0,
    rl = null,
    ve = !1,
    Aa = !1,
    Kf = !1,
    Il = 0,
    Mt = 0,
    ge = 0,
    We = 0,
    Jf = 0,
    sl = 0,
    _a = 0,
    pu = null,
    ll = null,
    wf = !1,
    Un = 0,
    Ls = 0,
    Cn = 1 / 0,
    Nn = null,
    pe = null,
    Yt = 0,
    Se = null,
    Ra = null,
    Pl = 0,
    $f = 0,
    Wf = null,
    Gs = null,
    Su = 0,
    kf = null;
  function dl() {
    return (ot & 2) !== 0 && ut !== 0 ? ut & -ut : D.T !== null ? ec() : lo();
  }
  function Xs() {
    if (sl === 0)
      if ((ut & 536870912) === 0 || it) {
        var t = Lu;
        ((Lu <<= 1), (Lu & 3932160) === 0 && (Lu = 262144), (sl = t));
      } else sl = 536870912;
    return ((t = cl.current), t !== null && (t.flags |= 32), sl);
  }
  function el(t, l, e) {
    (((t === bt && (st === 2 || st === 9)) || t.cancelPendingCommit !== null) &&
      (Oa(t, 0), be(t, ut, sl, !1)),
      Ga(t, e),
      ((ot & 2) === 0 || t !== bt) &&
        (t === bt &&
          ((ot & 2) === 0 && (We |= e), Mt === 4 && be(t, ut, sl, !1)),
        xl(t)));
  }
  function Qs(t, l, e) {
    if ((ot & 6) !== 0) throw Error(o(327));
    var a = (!e && (l & 127) === 0 && (l & t.expiredLanes) === 0) || La(t, l),
      u = a ? cy(t, l) : If(t, l, !0),
      n = a;
    do {
      if (u === 0) {
        Aa && !a && be(t, l, 0, !1);
        break;
      } else {
        if (((e = t.current.alternate), n && !iy(e))) {
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
                ((n = ll),
                  (ll = u),
                  n !== null &&
                    (ll === null ? (ll = n) : ll.push.apply(ll, n)));
              }
              u = i;
            }
            if (((n = !1), u !== 2)) continue;
          }
        }
        if (u === 1) {
          (Oa(t, 0), be(t, l, 0, !0));
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
              be(a, l, sl, !ve);
              break t;
            case 2:
              ll = null;
              break;
            case 3:
            case 5:
              break;
            default:
              throw Error(o(329));
          }
          if ((l & 62914560) === l && ((u = Un + 300 - al()), 10 < u)) {
            if ((be(a, l, sl, !ve), Xu(a, 0, !0) !== 0)) break t;
            ((Pl = l),
              (a.timeoutHandle = Sd(
                Zs.bind(
                  null,
                  a,
                  e,
                  ll,
                  Nn,
                  wf,
                  l,
                  sl,
                  We,
                  _a,
                  ve,
                  n,
                  "Throttled",
                  -0,
                  0,
                ),
                u,
              )));
            break t;
          }
          Zs(a, e, ll, Nn, wf, l, sl, We, _a, ve, n, null, -0, 0);
        }
      }
      break;
    } while (!0);
    xl(t);
  }
  function Zs(t, l, e, a, u, n, i, c, d, T, O, C, z, A) {
    if (
      ((t.timeoutHandle = -1),
      (C = l.subtreeFlags),
      C & 8192 || (C & 16785408) === 16785408)
    ) {
      ((C = {
        stylesheets: null,
        count: 0,
        imgCount: 0,
        imgBytes: 0,
        suspenseyImages: [],
        waitingForImages: !0,
        waitingForViewTransition: !1,
        unsuspend: jl,
      }),
        Bs(l, n, C));
      var j =
        (n & 62914560) === n ? Un - al() : (n & 4194048) === n ? Ls - al() : 0;
      if (((j = Vy(C, j)), j !== null)) {
        ((Pl = n),
          (t.cancelPendingCommit = j(
            Fs.bind(null, t, l, n, e, a, u, i, c, d, O, C, null, z, A),
          )),
          be(t, n, i, !T));
        return;
      }
    }
    Fs(t, l, n, e, a, u, i, c, d);
  }
  function iy(t) {
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
            if (!il(n(), u)) return !1;
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
  function be(t, l, e, a) {
    ((l &= ~Jf),
      (l &= ~We),
      (t.suspendedLanes |= l),
      (t.pingedLanes &= ~l),
      a && (t.warmLanes |= l),
      (a = t.expirationTimes));
    for (var u = l; 0 < u; ) {
      var n = 31 - nl(u),
        i = 1 << n;
      ((a[n] = -1), (u &= ~i));
    }
    e !== 0 && Ic(t, e, l);
  }
  function Hn() {
    return (ot & 6) === 0 ? (bu(0), !1) : !0;
  }
  function Ff() {
    if (et !== null) {
      if (st === 0) var t = et.return;
      else ((t = et), (Ql = Ge = null), hf(t), (ga = null), (eu = 0), (t = et));
      for (; t !== null; ) (bs(t.alternate, t), (t = t.return));
      et = null;
    }
  }
  function Oa(t, l) {
    var e = t.timeoutHandle;
    (e !== -1 && ((t.timeoutHandle = -1), Ry(e)),
      (e = t.cancelPendingCommit),
      e !== null && ((t.cancelPendingCommit = null), e()),
      (Pl = 0),
      Ff(),
      (bt = t),
      (et = e = Gl(t.current, null)),
      (ut = l),
      (st = 0),
      (rl = null),
      (ve = !1),
      (Aa = La(t, l)),
      (Kf = !1),
      (_a = sl = Jf = We = ge = Mt = 0),
      (ll = pu = null),
      (wf = !1),
      (l & 8) !== 0 && (l |= l & 32));
    var a = t.entangledLanes;
    if (a !== 0)
      for (t = t.entanglements, a &= l; 0 < a; ) {
        var u = 31 - nl(a),
          n = 1 << u;
        ((l |= t[u]), (a &= ~n));
      }
    return ((Il = l), Pu(), e);
  }
  function Vs(t, l) {
    ((P = null),
      (D.H = ru),
      l === va || l === cn
        ? ((l = ir()), (st = 3))
        : l === tf
          ? ((l = ir()), (st = 4))
          : (st =
              l === Df
                ? 8
                : l !== null &&
                    typeof l == "object" &&
                    typeof l.then == "function"
                  ? 6
                  : 1),
      (rl = l),
      et === null && ((Mt = 1), Tn(t, pl(l, t.current))));
  }
  function Ks() {
    var t = cl.current;
    return t === null
      ? !0
      : (ut & 4194048) === ut
        ? Tl === null
        : (ut & 62914560) === ut || (ut & 536870912) !== 0
          ? t === Tl
          : !1;
  }
  function Js() {
    var t = D.H;
    return ((D.H = ru), t === null ? ru : t);
  }
  function ws() {
    var t = D.A;
    return ((D.A = uy), t);
  }
  function xn() {
    ((Mt = 4),
      ve || ((ut & 4194048) !== ut && cl.current !== null) || (Aa = !0),
      ((ge & 134217727) === 0 && (We & 134217727) === 0) ||
        bt === null ||
        be(bt, ut, sl, !1));
  }
  function If(t, l, e) {
    var a = ot;
    ot |= 2;
    var u = Js(),
      n = ws();
    ((bt !== t || ut !== l) && ((Nn = null), Oa(t, l)), (l = !1));
    var i = Mt;
    t: do
      try {
        if (st !== 0 && et !== null) {
          var c = et,
            d = rl;
          switch (st) {
            case 8:
              (Ff(), (i = 6));
              break t;
            case 3:
            case 2:
            case 9:
            case 6:
              cl.current === null && (l = !0);
              var T = st;
              if (((st = 0), (rl = null), Ma(t, c, d, T), e && Aa)) {
                i = 0;
                break t;
              }
              break;
            default:
              ((T = st), (st = 0), (rl = null), Ma(t, c, d, T));
          }
        }
        (fy(), (i = Mt));
        break;
      } catch (O) {
        Vs(t, O);
      }
    while (!0);
    return (
      l && t.shellSuspendCounter++,
      (Ql = Ge = null),
      (ot = a),
      (D.H = u),
      (D.A = n),
      et === null && ((bt = null), (ut = 0), Pu()),
      i
    );
  }
  function fy() {
    for (; et !== null; ) $s(et);
  }
  function cy(t, l) {
    var e = ot;
    ot |= 2;
    var a = Js(),
      u = ws();
    bt !== t || ut !== l
      ? ((Nn = null), (Cn = al() + 500), Oa(t, l))
      : (Aa = La(t, l));
    t: do
      try {
        if (st !== 0 && et !== null) {
          l = et;
          var n = rl;
          l: switch (st) {
            case 1:
              ((st = 0), (rl = null), Ma(t, l, n, 1));
              break;
            case 2:
            case 9:
              if (ur(n)) {
                ((st = 0), (rl = null), Ws(l));
                break;
              }
              ((l = function () {
                ((st !== 2 && st !== 9) || bt !== t || (st = 7), xl(t));
              }),
                n.then(l, l));
              break t;
            case 3:
              st = 7;
              break t;
            case 4:
              st = 5;
              break t;
            case 7:
              ur(n)
                ? ((st = 0), (rl = null), Ws(l))
                : ((st = 0), (rl = null), Ma(t, l, n, 7));
              break;
            case 5:
              var i = null;
              switch (et.tag) {
                case 26:
                  i = et.memoizedState;
                case 5:
                case 27:
                  var c = et;
                  if (i ? xd(i) : c.stateNode.complete) {
                    ((st = 0), (rl = null));
                    var d = c.sibling;
                    if (d !== null) et = d;
                    else {
                      var T = c.return;
                      T !== null ? ((et = T), Bn(T)) : (et = null);
                    }
                    break l;
                  }
              }
              ((st = 0), (rl = null), Ma(t, l, n, 5));
              break;
            case 6:
              ((st = 0), (rl = null), Ma(t, l, n, 6));
              break;
            case 8:
              (Ff(), (Mt = 6));
              break t;
            default:
              throw Error(o(462));
          }
        }
        oy();
        break;
      } catch (O) {
        Vs(t, O);
      }
    while (!0);
    return (
      (Ql = Ge = null),
      (D.H = a),
      (D.A = u),
      (ot = e),
      et !== null ? 0 : ((bt = null), (ut = 0), Pu(), Mt)
    );
  }
  function oy() {
    for (; et !== null && !Nh(); ) $s(et);
  }
  function $s(t) {
    var l = ps(t.alternate, t, Il);
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
        (bs(e, l), (l = et = wo(l, Il)), (l = ps(e, l, Il)));
    }
    ((t.memoizedProps = t.pendingProps), l === null ? Bn(t) : (et = l));
  }
  function Ma(t, l, e, a) {
    ((Ql = Ge = null), hf(l), (ga = null), (eu = 0));
    var u = l.return;
    try {
      if (Fm(t, u, l, e, ut)) {
        ((Mt = 1), Tn(t, pl(e, t.current)), (et = null));
        return;
      }
    } catch (n) {
      if (u !== null) throw ((et = u), n);
      ((Mt = 1), Tn(t, pl(e, t.current)), (et = null));
      return;
    }
    l.flags & 32768
      ? (it || a === 1
          ? (t = !0)
          : Aa || (ut & 536870912) !== 0
            ? (t = !1)
            : ((ve = t = !0),
              (a === 2 || a === 9 || a === 3 || a === 6) &&
                ((a = cl.current),
                a !== null && a.tag === 13 && (a.flags |= 16384))),
        ks(l, t))
      : Bn(l);
  }
  function Bn(t) {
    var l = t;
    do {
      if ((l.flags & 32768) !== 0) {
        ks(l, ve);
        return;
      }
      t = l.return;
      var e = ty(l.alternate, l, Il);
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
      var e = ly(t.alternate, t);
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
    if ((ot & 6) !== 0) throw Error(o(327));
    if (l !== null) {
      if (l === t.current) throw Error(o(177));
      if (
        ((n = l.lanes | l.childLanes),
        (n |= Li),
        Qh(t, e, n, i, c, d),
        t === bt && ((et = bt = null), (ut = 0)),
        (Ra = l),
        (Se = t),
        (Pl = e),
        ($f = n),
        (Wf = u),
        (Gs = a),
        (l.subtreeFlags & 10256) !== 0 || (l.flags & 10256) !== 0
          ? ((t.callbackNode = null),
            (t.callbackPriority = 0),
            hy(Yu, function () {
              return (ed(), null);
            }))
          : ((t.callbackNode = null), (t.callbackPriority = 0)),
        (a = (l.flags & 13878) !== 0),
        (l.subtreeFlags & 13878) !== 0 || a)
      ) {
        ((a = D.T), (D.T = null), (u = B.p), (B.p = 2), (i = ot), (ot |= 4));
        try {
          ey(t, l, e);
        } finally {
          ((ot = i), (B.p = u), (D.T = a));
        }
      }
      ((Yt = 1), Is(), Ps(), td());
    }
  }
  function Is() {
    if (Yt === 1) {
      Yt = 0;
      var t = Se,
        l = Ra,
        e = (l.flags & 13878) !== 0;
      if ((l.subtreeFlags & 13878) !== 0 || e) {
        ((e = D.T), (D.T = null));
        var a = B.p;
        B.p = 2;
        var u = ot;
        ot |= 4;
        try {
          Ns(l, t);
          var n = rc,
            i = jo(t.containerInfo),
            c = n.focusedElem,
            d = n.selectionRange;
          if (
            i !== c &&
            c &&
            c.ownerDocument &&
            Yo(c.ownerDocument.documentElement, c)
          ) {
            if (d !== null && xi(c)) {
              var T = d.start,
                O = d.end;
              if ((O === void 0 && (O = T), "selectionStart" in c))
                ((c.selectionStart = T),
                  (c.selectionEnd = Math.min(O, c.value.length)));
              else {
                var C = c.ownerDocument || document,
                  z = (C && C.defaultView) || window;
                if (z.getSelection) {
                  var A = z.getSelection(),
                    j = c.textContent.length,
                    J = Math.min(d.start, j),
                    gt = d.end === void 0 ? J : Math.min(d.end, j);
                  !A.extend && J > gt && ((i = gt), (gt = J), (J = i));
                  var p = qo(c, J),
                    m = qo(c, gt);
                  if (
                    p &&
                    m &&
                    (A.rangeCount !== 1 ||
                      A.anchorNode !== p.node ||
                      A.anchorOffset !== p.offset ||
                      A.focusNode !== m.node ||
                      A.focusOffset !== m.offset)
                  ) {
                    var E = C.createRange();
                    (E.setStart(p.node, p.offset),
                      A.removeAllRanges(),
                      J > gt
                        ? (A.addRange(E), A.extend(m.node, m.offset))
                        : (E.setEnd(m.node, m.offset), A.addRange(E)));
                  }
                }
              }
            }
            for (C = [], A = c; (A = A.parentNode); )
              A.nodeType === 1 &&
                C.push({ element: A, left: A.scrollLeft, top: A.scrollTop });
            for (
              typeof c.focus == "function" && c.focus(), c = 0;
              c < C.length;
              c++
            ) {
              var U = C[c];
              ((U.element.scrollLeft = U.left), (U.element.scrollTop = U.top));
            }
          }
          (($n = !!oc), (rc = oc = null));
        } finally {
          ((ot = u), (B.p = a), (D.T = e));
        }
      }
      ((t.current = l), (Yt = 2));
    }
  }
  function Ps() {
    if (Yt === 2) {
      Yt = 0;
      var t = Se,
        l = Ra,
        e = (l.flags & 8772) !== 0;
      if ((l.subtreeFlags & 8772) !== 0 || e) {
        ((e = D.T), (D.T = null));
        var a = B.p;
        B.p = 2;
        var u = ot;
        ot |= 4;
        try {
          Os(t, l.alternate, l);
        } finally {
          ((ot = u), (B.p = a), (D.T = e));
        }
      }
      Yt = 3;
    }
  }
  function td() {
    if (Yt === 4 || Yt === 3) {
      ((Yt = 0), Hh());
      var t = Se,
        l = Ra,
        e = Pl,
        a = Gs;
      (l.subtreeFlags & 10256) !== 0 || (l.flags & 10256) !== 0
        ? (Yt = 5)
        : ((Yt = 0), (Ra = Se = null), ld(t, t.pendingLanes));
      var u = t.pendingLanes;
      if (
        (u === 0 && (pe = null),
        yi(e),
        (l = l.stateNode),
        ul && typeof ul.onCommitFiberRoot == "function")
      )
        try {
          ul.onCommitFiberRoot(ja, l, void 0, (l.current.flags & 128) === 128);
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
      ((Pl & 3) !== 0 && qn(),
        xl(t),
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
    var t = Se,
      l = $f;
    $f = 0;
    var e = yi(Pl),
      a = D.T,
      u = B.p;
    try {
      ((B.p = 32 > e ? 32 : e), (D.T = null), (e = Wf), (Wf = null));
      var n = Se,
        i = Pl;
      if (((Yt = 0), (Ra = Se = null), (Pl = 0), (ot & 6) !== 0))
        throw Error(o(331));
      var c = ot;
      if (
        ((ot |= 4),
        Ys(n.current),
        xs(n, n.current, i, e),
        (ot = c),
        bu(0, !1),
        ul && typeof ul.onPostCommitFiberRoot == "function")
      )
        try {
          ul.onPostCommitFiberRoot(ja, n);
        } catch {}
      return !0;
    } finally {
      ((B.p = u), (D.T = a), ld(t, l));
    }
  }
  function ad(t, l, e) {
    ((l = pl(e, l)),
      (l = Mf(t.stateNode, l, 2)),
      (t = de(t, l, 2)),
      t !== null && (Ga(t, 2), xl(t)));
  }
  function dt(t, l, e) {
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
              (pe === null || !pe.has(a)))
          ) {
            ((t = pl(e, t)),
              (e = us(2)),
              (a = de(l, e, 2)),
              a !== null && (ns(e, a, l, t), Ga(a, 2), xl(a)));
            break;
          }
        }
        l = l.return;
      }
  }
  function Pf(t, l, e) {
    var a = t.pingCache;
    if (a === null) {
      a = t.pingCache = new ny();
      var u = new Set();
      a.set(l, u);
    } else ((u = a.get(l)), u === void 0 && ((u = new Set()), a.set(l, u)));
    u.has(e) ||
      ((Kf = !0), u.add(e), (t = ry.bind(null, t, l, e)), l.then(t, t));
  }
  function ry(t, l, e) {
    var a = t.pingCache;
    (a !== null && a.delete(l),
      (t.pingedLanes |= t.suspendedLanes & e),
      (t.warmLanes &= ~e),
      bt === t &&
        (ut & e) === e &&
        (Mt === 4 || (Mt === 3 && (ut & 62914560) === ut && 300 > al() - Un)
          ? (ot & 2) === 0 && Oa(t, 0)
          : (Jf |= e),
        _a === ut && (_a = 0)),
      xl(t));
  }
  function ud(t, l) {
    (l === 0 && (l = Fc()), (t = Ye(t, l)), t !== null && (Ga(t, l), xl(t)));
  }
  function sy(t) {
    var l = t.memoizedState,
      e = 0;
    (l !== null && (e = l.retryLane), ud(t, e));
  }
  function dy(t, l) {
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
  function hy(t, l) {
    return si(t, l);
  }
  var Yn = null,
    Da = null,
    tc = !1,
    jn = !1,
    lc = !1,
    Ee = 0;
  function xl(t) {
    (t !== Da &&
      t.next === null &&
      (Da === null ? (Yn = Da = t) : (Da = Da.next = t)),
      (jn = !0),
      tc || ((tc = !0), yy()));
  }
  function bu(t, l) {
    if (!lc && jn) {
      lc = !0;
      do
        for (var e = !1, a = Yn; a !== null; ) {
          if (t !== 0) {
            var u = a.pendingLanes;
            if (u === 0) var n = 0;
            else {
              var i = a.suspendedLanes,
                c = a.pingedLanes;
              ((n = (1 << (31 - nl(42 | t) + 1)) - 1),
                (n &= u & ~(i & ~c)),
                (n = n & 201326741 ? (n & 201326741) | 1 : n ? n | 2 : 0));
            }
            n !== 0 && ((e = !0), cd(a, n));
          } else
            ((n = ut),
              (n = Xu(
                a,
                a === bt ? n : 0,
                a.cancelPendingCommit !== null || a.timeoutHandle !== -1,
              )),
              (n & 3) === 0 || La(a, n) || ((e = !0), cd(a, n)));
          a = a.next;
        }
      while (e);
      lc = !1;
    }
  }
  function my() {
    nd();
  }
  function nd() {
    jn = tc = !1;
    var t = 0;
    Ee !== 0 && _y() && (t = Ee);
    for (var l = al(), e = null, a = Yn; a !== null; ) {
      var u = a.next,
        n = id(a, l);
      (n === 0
        ? ((a.next = null),
          e === null ? (Yn = u) : (e.next = u),
          u === null && (Da = e))
        : ((e = a), (t !== 0 || (n & 3) !== 0) && (jn = !0)),
        (a = u));
    }
    ((Yt !== 0 && Yt !== 5) || bu(t), Ee !== 0 && (Ee = 0));
  }
  function id(t, l) {
    for (
      var e = t.suspendedLanes,
        a = t.pingedLanes,
        u = t.expirationTimes,
        n = t.pendingLanes & -62914561;
      0 < n;
    ) {
      var i = 31 - nl(n),
        c = 1 << i,
        d = u[i];
      (d === -1
        ? ((c & e) === 0 || (c & a) !== 0) && (u[i] = Xh(c, l))
        : d <= l && (t.expiredLanes |= c),
        (n &= ~c));
    }
    if (
      ((l = bt),
      (e = ut),
      (e = Xu(
        t,
        t === l ? e : 0,
        t.cancelPendingCommit !== null || t.timeoutHandle !== -1,
      )),
      (a = t.callbackNode),
      e === 0 ||
        (t === l && (st === 2 || st === 9)) ||
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
          e = Yu;
          break;
        case 268435456:
          e = kc;
          break;
        default:
          e = Yu;
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
        t === bt ? a : 0,
        t.cancelPendingCommit !== null || t.timeoutHandle !== -1,
      )),
      a === 0
        ? null
        : (Qs(t, a, l),
          id(t, al()),
          t.callbackNode != null && t.callbackNode === e
            ? fd.bind(null, t)
            : null)
    );
  }
  function cd(t, l) {
    if (qn()) return null;
    Qs(t, l, !0);
  }
  function yy() {
    Oy(function () {
      (ot & 6) !== 0 ? si($c, my) : nd();
    });
  }
  function ec() {
    if (Ee === 0) {
      var t = ma;
      (t === 0 && ((t = ju), (ju <<= 1), (ju & 261888) === 0 && (ju = 256)),
        (Ee = t));
    }
    return Ee;
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
  function vy(t, l, e, a, u) {
    if (l === "submit" && e && e.stateNode === u) {
      var n = od((u[kt] || null).action),
        i = a.submitter;
      i &&
        ((l = (l = i[kt] || null)
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
                if (Ee !== 0) {
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
  for (var ac = 0; ac < ji.length; ac++) {
    var uc = ji[ac],
      gy = uc.toLowerCase(),
      py = uc[0].toUpperCase() + uc.slice(1);
    Rl(gy, "on" + py);
  }
  (Rl(Xo, "onAnimationEnd"),
    Rl(Qo, "onAnimationIteration"),
    Rl(Zo, "onAnimationStart"),
    Rl("dblclick", "onDoubleClick"),
    Rl("focusin", "onFocus"),
    Rl("focusout", "onBlur"),
    Rl(xm, "onTransitionRun"),
    Rl(Bm, "onTransitionStart"),
    Rl(qm, "onTransitionCancel"),
    Rl(Vo, "onTransitionEnd"),
    ta("onMouseEnter", ["mouseout", "mouseover"]),
    ta("onMouseLeave", ["mouseout", "mouseover"]),
    ta("onPointerEnter", ["pointerout", "pointerover"]),
    ta("onPointerLeave", ["pointerout", "pointerover"]),
    He(
      "onChange",
      "change click focusin focusout input keydown keyup selectionchange".split(
        " ",
      ),
    ),
    He(
      "onSelect",
      "focusout contextmenu dragend focusin keydown keyup mousedown mouseup selectionchange".split(
        " ",
      ),
    ),
    He("onBeforeInput", ["compositionend", "keypress", "textInput", "paste"]),
    He(
      "onCompositionEnd",
      "compositionend focusout keydown keypress keyup mousedown".split(" "),
    ),
    He(
      "onCompositionStart",
      "compositionstart focusout keydown keypress keyup mousedown".split(" "),
    ),
    He(
      "onCompositionUpdate",
      "compositionupdate focusout keydown keypress keyup mousedown".split(" "),
    ));
  var Eu =
      "abort canplay canplaythrough durationchange emptied encrypted ended error loadeddata loadedmetadata loadstart pause play playing progress ratechange resize seeked seeking stalled suspend timeupdate volumechange waiting".split(
        " ",
      ),
    Sy = new Set(
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
            } catch (O) {
              Iu(O);
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
            } catch (O) {
              Iu(O);
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
          e !== "selectionchange" && (Sy.has(e) || nc(e, !1, t), nc(e, !0, t));
        }));
      var l = t.nodeType === 9 ? t : t.ownerDocument;
      l === null || l[Ln] || ((l[Ln] = !0), nc("selectionchange", !1, l));
    }
  }
  function dd(t, l, e, a) {
    switch (Xd(l)) {
      case 2:
        var u = wy;
        break;
      case 8:
        u = $y;
        break;
      default:
        u = Ec;
    }
    ((e = u.bind(null, l, e, t)),
      (u = void 0),
      !_i ||
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
        O = zi(e),
        C = [];
      t: {
        var z = Ko.get(t);
        if (z !== void 0) {
          var A = Wu,
            j = t;
          switch (t) {
            case "keypress":
              if (wu(e) === 0) break t;
            case "keydown":
            case "keyup":
              A = dm;
              break;
            case "focusin":
              ((j = "focus"), (A = Di));
              break;
            case "focusout":
              ((j = "blur"), (A = Di));
              break;
            case "beforeblur":
            case "afterblur":
              A = Di;
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
              A = bo;
              break;
            case "drag":
            case "dragend":
            case "dragenter":
            case "dragexit":
            case "dragleave":
            case "dragover":
            case "dragstart":
            case "drop":
              A = tm;
              break;
            case "touchcancel":
            case "touchend":
            case "touchmove":
            case "touchstart":
              A = ym;
              break;
            case Xo:
            case Qo:
            case Zo:
              A = am;
              break;
            case Vo:
              A = gm;
              break;
            case "scroll":
            case "scrollend":
              A = Ih;
              break;
            case "wheel":
              A = Sm;
              break;
            case "copy":
            case "cut":
            case "paste":
              A = nm;
              break;
            case "gotpointercapture":
            case "lostpointercapture":
            case "pointercancel":
            case "pointerdown":
            case "pointermove":
            case "pointerout":
            case "pointerover":
            case "pointerup":
              A = To;
              break;
            case "toggle":
            case "beforetoggle":
              A = Em;
          }
          var J = (l & 4) !== 0,
            gt = !J && (t === "scroll" || t === "scrollend"),
            p = J ? (z !== null ? z + "Capture" : null) : z;
          J = [];
          for (var m = T, E; m !== null; ) {
            var U = m;
            if (
              ((E = U.stateNode),
              (U = U.tag),
              (U !== 5 && U !== 26 && U !== 27) ||
                E === null ||
                p === null ||
                ((U = Za(m, p)), U != null && J.push(Tu(m, U, E))),
              gt)
            )
              break;
            m = m.return;
          }
          0 < J.length &&
            ((z = new A(z, j, null, e, O)), C.push({ event: z, listeners: J }));
        }
      }
      if ((l & 7) === 0) {
        t: {
          if (
            ((z = t === "mouseover" || t === "pointerover"),
            (A = t === "mouseout" || t === "pointerout"),
            z &&
              e !== Ti &&
              (j = e.relatedTarget || e.fromElement) &&
              (Fe(j) || j[ke]))
          )
            break t;
          if (
            (A || z) &&
            ((z =
              O.window === O
                ? O
                : (z = O.ownerDocument)
                  ? z.defaultView || z.parentWindow
                  : window),
            A
              ? ((j = e.relatedTarget || e.toElement),
                (A = T),
                (j = j ? Fe(j) : null),
                j !== null &&
                  ((gt = y(j)),
                  (J = j.tag),
                  j !== gt || (J !== 5 && J !== 27 && J !== 6)) &&
                  (j = null))
              : ((A = null), (j = T)),
            A !== j)
          ) {
            if (
              ((J = bo),
              (U = "onMouseLeave"),
              (p = "onMouseEnter"),
              (m = "mouse"),
              (t === "pointerout" || t === "pointerover") &&
                ((J = To),
                (U = "onPointerLeave"),
                (p = "onPointerEnter"),
                (m = "pointer")),
              (gt = A == null ? z : Qa(A)),
              (E = j == null ? z : Qa(j)),
              (z = new J(U, m + "leave", A, e, O)),
              (z.target = gt),
              (z.relatedTarget = E),
              (U = null),
              Fe(O) === T &&
                ((J = new J(p, m + "enter", j, e, O)),
                (J.target = E),
                (J.relatedTarget = gt),
                (U = J)),
              (gt = U),
              A && j)
            )
              l: {
                for (J = by, p = A, m = j, E = 0, U = p; U; U = J(U)) E++;
                U = 0;
                for (var V = m; V; V = J(V)) U++;
                for (; 0 < E - U; ) ((p = J(p)), E--);
                for (; 0 < U - E; ) ((m = J(m)), U--);
                for (; E--; ) {
                  if (p === m || (m !== null && p === m.alternate)) {
                    J = p;
                    break l;
                  }
                  ((p = J(p)), (m = J(m)));
                }
                J = null;
              }
            else J = null;
            (A !== null && hd(C, z, A, J, !1),
              j !== null && gt !== null && hd(C, gt, j, J, !0));
          }
        }
        t: {
          if (
            ((z = T ? Qa(T) : window),
            (A = z.nodeName && z.nodeName.toLowerCase()),
            A === "select" || (A === "input" && z.type === "file"))
          )
            var ft = Uo;
          else if (Mo(z))
            if (Co) ft = Cm;
            else {
              ft = Dm;
              var X = Mm;
            }
          else
            ((A = z.nodeName),
              !A ||
              A.toLowerCase() !== "input" ||
              (z.type !== "checkbox" && z.type !== "radio")
                ? T && Ei(T.elementType) && (ft = Uo)
                : (ft = Um));
          if (ft && (ft = ft(t, T))) {
            Do(C, ft, e, O);
            break t;
          }
          (X && X(t, z, T),
            t === "focusout" &&
              T &&
              z.type === "number" &&
              T.memoizedProps.value != null &&
              bi(z, "number", z.value));
        }
        switch (((X = T ? Qa(T) : window), t)) {
          case "focusin":
            (Mo(X) || X.contentEditable === "true") &&
              ((ia = X), (Bi = T), (Fa = null));
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
            ((qi = !1), Lo(C, e, O));
            break;
          case "selectionchange":
            if (Hm) break;
          case "keydown":
          case "keyup":
            Lo(C, e, O);
        }
        var tt;
        if (Ci)
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
              : ((ne = O),
                (Ri = "value" in ne ? ne.value : ne.textContent),
                (na = !0))),
          (X = Gn(T, nt)),
          0 < X.length &&
            ((nt = new Eo(nt, t, null, e, O)),
            C.push({ event: nt, listeners: X }),
            tt
              ? (nt.data = tt)
              : ((tt = Oo(e)), tt !== null && (nt.data = tt)))),
          (tt = zm ? Am(t, e) : _m(t, e)) &&
            ((nt = Gn(T, "onBeforeInput")),
            0 < nt.length &&
              ((X = new Eo("onBeforeInput", "beforeinput", null, e, O)),
              C.push({ event: X, listeners: nt }),
              (X.data = tt))),
          vy(C, t, T, e, O));
      }
      sd(C, l);
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
  function by(t) {
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
  var Ey = /\r\n?/g,
    Ty = /\u0000|\uFFFD/g;
  function md(t) {
    return (typeof t == "string" ? t : "" + t)
      .replace(
        Ey,
        `
`,
      )
      .replace(Ty, "");
  }
  function yd(t, l) {
    return ((l = md(l)), md(t) === l);
  }
  function vt(t, l, e, a, u, n) {
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
              ? (l !== "input" && vt(t, l, "name", u.name, u, null),
                vt(t, l, "formEncType", u.formEncType, u, null),
                vt(t, l, "formMethod", u.formMethod, u, null),
                vt(t, l, "formTarget", u.formTarget, u, null))
              : (vt(t, l, "encType", u.encType, u, null),
                vt(t, l, "method", u.method, u, null),
                vt(t, l, "target", u.target, u, null)));
        if (a == null || typeof a == "symbol" || typeof a == "boolean") {
          t.removeAttribute(e);
          break;
        }
        ((a = Ku("" + a)), t.setAttribute(e, a));
        break;
      case "onClick":
        a != null && (t.onclick = jl);
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
          ((e = kh.get(e) || e), Qu(t, e, a));
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
        a != null && (t.onclick = jl);
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
              (n = t[kt] || null),
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
  function Kt(t, l, e) {
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
                  vt(t, l, n, i, e, null);
              }
          }
        (u && vt(t, l, "srcSet", e.srcSet, e, null),
          a && vt(t, l, "src", e.src, e, null));
        return;
      case "input":
        at("invalid", t);
        var c = (n = i = u = null),
          d = null,
          T = null;
        for (a in e)
          if (e.hasOwnProperty(a)) {
            var O = e[a];
            if (O != null)
              switch (a) {
                case "name":
                  u = O;
                  break;
                case "type":
                  i = O;
                  break;
                case "checked":
                  d = O;
                  break;
                case "defaultChecked":
                  T = O;
                  break;
                case "value":
                  n = O;
                  break;
                case "defaultValue":
                  c = O;
                  break;
                case "children":
                case "dangerouslySetInnerHTML":
                  if (O != null) throw Error(o(137, l));
                  break;
                default:
                  vt(t, l, a, O, e, null);
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
                vt(t, l, u, c, e, null);
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
                vt(t, l, i, c, e, null);
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
                vt(t, l, d, a, e, null);
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
                vt(t, l, T, a, e, null);
            }
        return;
      default:
        if (Ei(l)) {
          for (O in e)
            e.hasOwnProperty(O) &&
              ((a = e[O]), a !== void 0 && cc(t, l, O, a, e, void 0));
          return;
        }
    }
    for (c in e)
      e.hasOwnProperty(c) && ((a = e[c]), a != null && vt(t, l, c, a, e, null));
  }
  function zy(t, l, e, a) {
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
          O = null;
        for (A in e) {
          var C = e[A];
          if (e.hasOwnProperty(A) && C != null)
            switch (A) {
              case "checked":
                break;
              case "value":
                break;
              case "defaultValue":
                d = C;
              default:
                a.hasOwnProperty(A) || vt(t, l, A, null, a, C);
            }
        }
        for (var z in a) {
          var A = a[z];
          if (((C = e[z]), a.hasOwnProperty(z) && (A != null || C != null)))
            switch (z) {
              case "type":
                n = A;
                break;
              case "name":
                u = A;
                break;
              case "checked":
                T = A;
                break;
              case "defaultChecked":
                O = A;
                break;
              case "value":
                i = A;
                break;
              case "defaultValue":
                c = A;
                break;
              case "children":
              case "dangerouslySetInnerHTML":
                if (A != null) throw Error(o(137, l));
                break;
              default:
                A !== C && vt(t, l, z, A, a, C);
            }
        }
        Si(t, i, c, d, T, O, n, u);
        return;
      case "select":
        A = i = c = z = null;
        for (n in e)
          if (((d = e[n]), e.hasOwnProperty(n) && d != null))
            switch (n) {
              case "value":
                break;
              case "multiple":
                A = d;
              default:
                a.hasOwnProperty(n) || vt(t, l, n, null, a, d);
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
                n !== d && vt(t, l, u, n, a, d);
            }
        ((l = c),
          (e = i),
          (a = A),
          z != null
            ? la(t, !!e, z, !1)
            : !!a != !!e &&
              (l != null ? la(t, !!e, l, !0) : la(t, !!e, e ? [] : "", !1)));
        return;
      case "textarea":
        A = z = null;
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
                vt(t, l, c, null, a, u);
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
                A = u;
                break;
              case "children":
                break;
              case "dangerouslySetInnerHTML":
                if (u != null) throw Error(o(91));
                break;
              default:
                u !== n && vt(t, l, i, u, a, n);
            }
        so(t, z, A);
        return;
      case "option":
        for (var j in e)
          if (
            ((z = e[j]),
            e.hasOwnProperty(j) && z != null && !a.hasOwnProperty(j))
          )
            switch (j) {
              case "selected":
                t.selected = !1;
                break;
              default:
                vt(t, l, j, null, a, z);
            }
        for (d in a)
          if (
            ((z = a[d]),
            (A = e[d]),
            a.hasOwnProperty(d) && z !== A && (z != null || A != null))
          )
            switch (d) {
              case "selected":
                t.selected =
                  z && typeof z != "function" && typeof z != "symbol";
                break;
              default:
                vt(t, l, d, z, a, A);
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
              vt(t, l, J, null, a, z));
        for (T in a)
          if (
            ((z = a[T]),
            (A = e[T]),
            a.hasOwnProperty(T) && z !== A && (z != null || A != null))
          )
            switch (T) {
              case "children":
              case "dangerouslySetInnerHTML":
                if (z != null) throw Error(o(137, l));
                break;
              default:
                vt(t, l, T, z, a, A);
            }
        return;
      default:
        if (Ei(l)) {
          for (var gt in e)
            ((z = e[gt]),
              e.hasOwnProperty(gt) &&
                z !== void 0 &&
                !a.hasOwnProperty(gt) &&
                cc(t, l, gt, void 0, a, z));
          for (O in a)
            ((z = a[O]),
              (A = e[O]),
              !a.hasOwnProperty(O) ||
                z === A ||
                (z === void 0 && A === void 0) ||
                cc(t, l, O, z, a, A));
          return;
        }
    }
    for (var p in e)
      ((z = e[p]),
        e.hasOwnProperty(p) &&
          z != null &&
          !a.hasOwnProperty(p) &&
          vt(t, l, p, null, a, z));
    for (C in a)
      ((z = a[C]),
        (A = e[C]),
        !a.hasOwnProperty(C) ||
          z === A ||
          (z == null && A == null) ||
          vt(t, l, C, z, a, A));
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
  function Ay() {
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
            var O = d.transferSize,
              C = d.initiatorType;
            O &&
              vd(C) &&
              ((d = d.responseEnd), (i += O * (d < c ? 1 : (c - T) / (d - T))));
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
    Ry = typeof clearTimeout == "function" ? clearTimeout : void 0,
    bd = typeof Promise == "function" ? Promise : void 0,
    Oy =
      typeof queueMicrotask == "function"
        ? queueMicrotask
        : typeof bd < "u"
          ? function (t) {
              return bd.resolve(null).then(t).catch(My);
            }
          : Sd;
  function My(t) {
    setTimeout(function () {
      throw t;
    });
  }
  function Te(t) {
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
            (t.removeChild(u), Ha(l));
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
    Ha(l);
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
  function Dy(t, l, e, a) {
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
      if (((t = zl(t.nextSibling)), t === null)) break;
    }
    return null;
  }
  function Uy(t, l, e) {
    if (l === "") return null;
    for (; t.nodeType !== 3; )
      if (
        ((t.nodeType !== 1 || t.nodeName !== "INPUT" || t.type !== "hidden") &&
          !e) ||
        ((t = zl(t.nextSibling)), t === null)
      )
        return null;
    return t;
  }
  function zd(t, l) {
    for (; t.nodeType !== 8; )
      if (
        ((t.nodeType !== 1 || t.nodeName !== "INPUT" || t.type !== "hidden") &&
          !l) ||
        ((t = zl(t.nextSibling)), t === null)
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
  function zl(t) {
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
  function Ad(t) {
    t = t.nextSibling;
    for (var l = 0; t; ) {
      if (t.nodeType === 8) {
        var e = t.data;
        if (e === "/$" || e === "/&") {
          if (l === 0) return zl(t.nextSibling);
          l--;
        } else
          (e !== "$" && e !== "$!" && e !== "$?" && e !== "$~" && e !== "&") ||
            l++;
      }
      t = t.nextSibling;
    }
    return null;
  }
  function _d(t) {
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
  var te = B.d;
  B.d = { f: Ny, r: Hy, D: xy, C: By, L: qy, m: Yy, X: Ly, S: jy, M: Gy };
  function Ny() {
    var t = te.f(),
      l = Hn();
    return t || l;
  }
  function Hy(t) {
    var l = Ie(t);
    l !== null && l.tag === 5 && l.type === "form" ? Vr(l) : te.r(t);
  }
  var Ua = typeof document > "u" ? null : document;
  function Md(t, l, e) {
    var a = Ua;
    if (a && typeof l == "string" && l) {
      var u = vl(l);
      ((u = 'link[rel="' + t + '"][href="' + u + '"]'),
        typeof e == "string" && (u += '[crossorigin="' + e + '"]'),
        Od.has(u) ||
          (Od.add(u),
          (t = { rel: t, crossOrigin: e, href: l }),
          a.querySelector(u) === null &&
            ((l = a.createElement("link")),
            Kt(l, "link", t),
            jt(l),
            a.head.appendChild(l))));
    }
  }
  function xy(t) {
    (te.D(t), Md("dns-prefetch", t, null));
  }
  function By(t, l) {
    (te.C(t, l), Md("preconnect", t, l));
  }
  function qy(t, l, e) {
    te.L(t, l, e);
    var a = Ua;
    if (a && t && l) {
      var u = 'link[rel="preload"][as="' + vl(l) + '"]';
      l === "image" && e && e.imageSrcSet
        ? ((u += '[imagesrcset="' + vl(e.imageSrcSet) + '"]'),
          typeof e.imageSizes == "string" &&
            (u += '[imagesizes="' + vl(e.imageSizes) + '"]'))
        : (u += '[href="' + vl(t) + '"]');
      var n = u;
      switch (l) {
        case "style":
          n = Ca(t);
          break;
        case "script":
          n = Na(t);
      }
      Al.has(n) ||
        ((t = _(
          {
            rel: "preload",
            href: l === "image" && e && e.imageSrcSet ? void 0 : t,
            as: l,
          },
          e,
        )),
        Al.set(n, t),
        a.querySelector(u) !== null ||
          (l === "style" && a.querySelector(Au(n))) ||
          (l === "script" && a.querySelector(_u(n))) ||
          ((l = a.createElement("link")),
          Kt(l, "link", t),
          jt(l),
          a.head.appendChild(l)));
    }
  }
  function Yy(t, l) {
    te.m(t, l);
    var e = Ua;
    if (e && t) {
      var a = l && typeof l.as == "string" ? l.as : "script",
        u =
          'link[rel="modulepreload"][as="' + vl(a) + '"][href="' + vl(t) + '"]',
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
        ((t = _({ rel: "modulepreload", href: t }, l)),
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
            if (e.querySelector(_u(n))) return;
        }
        ((a = e.createElement("link")),
          Kt(a, "link", t),
          jt(a),
          e.head.appendChild(a));
      }
    }
  }
  function jy(t, l, e) {
    te.S(t, l, e);
    var a = Ua;
    if (a && t) {
      var u = Pe(a).hoistableStyles,
        n = Ca(t);
      l = l || "default";
      var i = u.get(n);
      if (!i) {
        var c = { loading: 0, preload: null };
        if ((i = a.querySelector(Au(n)))) c.loading = 5;
        else {
          ((t = _({ rel: "stylesheet", href: t, "data-precedence": l }, e)),
            (e = Al.get(n)) && gc(t, e));
          var d = (i = a.createElement("link"));
          (jt(d),
            Kt(d, "link", t),
            (d._p = new Promise(function (T, O) {
              ((d.onload = T), (d.onerror = O));
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
  function Ly(t, l) {
    te.X(t, l);
    var e = Ua;
    if (e && t) {
      var a = Pe(e).hoistableScripts,
        u = Na(t),
        n = a.get(u);
      n ||
        ((n = e.querySelector(_u(u))),
        n ||
          ((t = _({ src: t, async: !0 }, l)),
          (l = Al.get(u)) && pc(t, l),
          (n = e.createElement("script")),
          jt(n),
          Kt(n, "link", t),
          e.head.appendChild(n)),
        (n = { type: "script", instance: n, count: 1, state: null }),
        a.set(u, n));
    }
  }
  function Gy(t, l) {
    te.M(t, l);
    var e = Ua;
    if (e && t) {
      var a = Pe(e).hoistableScripts,
        u = Na(t),
        n = a.get(u);
      n ||
        ((n = e.querySelector(_u(u))),
        n ||
          ((t = _({ src: t, async: !0, type: "module" }, l)),
          (l = Al.get(u)) && pc(t, l),
          (n = e.createElement("script")),
          jt(n),
          Kt(n, "link", t),
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
          ? ((l = Ca(e.href)),
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
          t = Ca(e.href);
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
              (n = u.querySelector(Au(t))) &&
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
                n || Xy(u, t, e, i.state))),
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
  function Ca(t) {
    return 'href="' + vl(t) + '"';
  }
  function Au(t) {
    return 'link[rel="stylesheet"][' + t + "]";
  }
  function Ud(t) {
    return _({}, t, { "data-precedence": t.precedence, precedence: null });
  }
  function Xy(t, l, e, a) {
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
        Kt(l, "link", e),
        jt(l),
        t.head.appendChild(l));
  }
  function Na(t) {
    return '[src="' + vl(t) + '"]';
  }
  function _u(t) {
    return "script[async]" + t;
  }
  function Cd(t, l, e) {
    if ((l.count++, l.instance === null))
      switch (l.type) {
        case "style":
          var a = t.querySelector('style[data-href~="' + vl(e.href) + '"]');
          if (a) return ((l.instance = a), jt(a), a);
          var u = _({}, e, {
            "data-href": e.href,
            "data-precedence": e.precedence,
            href: null,
            precedence: null,
          });
          return (
            (a = (t.ownerDocument || t).createElement("style")),
            jt(a),
            Kt(a, "style", u),
            Zn(a, e.precedence, t),
            (l.instance = a)
          );
        case "stylesheet":
          u = Ca(e.href);
          var n = t.querySelector(Au(u));
          if (n) return ((l.state.loading |= 4), (l.instance = n), jt(n), n);
          ((a = Ud(e)),
            (u = Al.get(u)) && gc(a, u),
            (n = (t.ownerDocument || t).createElement("link")),
            jt(n));
          var i = n;
          return (
            (i._p = new Promise(function (c, d) {
              ((i.onload = c), (i.onerror = d));
            })),
            Kt(n, "link", a),
            (l.state.loading |= 4),
            Zn(n, e.precedence, t),
            (l.instance = n)
          );
        case "script":
          return (
            (n = Na(e.src)),
            (u = t.querySelector(_u(n)))
              ? ((l.instance = u), jt(u), u)
              : ((a = e),
                (u = Al.get(n)) && ((a = _({}, e)), pc(a, u)),
                (t = t.ownerDocument || t),
                (u = t.createElement("script")),
                jt(u),
                Kt(u, "link", a),
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
          n[Xt] ||
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
  function Hd(t, l, e) {
    ((t = t.ownerDocument || t),
      t.head.insertBefore(
        e,
        l === "title" ? t.querySelector("head > title") : null,
      ));
  }
  function Qy(t, l, e) {
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
  function xd(t) {
    return !(t.type === "stylesheet" && (t.state.loading & 3) === 0);
  }
  function Zy(t, l, e, a) {
    if (
      e.type === "stylesheet" &&
      (typeof a.media != "string" || matchMedia(a.media).matches !== !1) &&
      (e.state.loading & 4) === 0
    ) {
      if (e.instance === null) {
        var u = Ca(a.href),
          n = l.querySelector(Au(u));
        if (n) {
          ((l = n._p),
            l !== null &&
              typeof l == "object" &&
              typeof l.then == "function" &&
              (t.count++, (t = Kn.bind(t)), l.then(t, t)),
            (e.state.loading |= 4),
            (e.instance = n),
            jt(n));
          return;
        }
        ((n = l.ownerDocument || l),
          (a = Ud(a)),
          (u = Al.get(u)) && gc(a, u),
          (n = n.createElement("link")),
          jt(n));
        var i = n;
        ((i._p = new Promise(function (c, d) {
          ((i.onload = c), (i.onerror = d));
        })),
          Kt(n, "link", a),
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
  function Vy(t, l) {
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
            0 < t.imgBytes && Sc === 0 && (Sc = 62500 * Ay());
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
        l.forEach(Ky, t),
        (Jn = null),
        Kn.call(t)));
  }
  function Ky(t, l) {
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
    _currentValue: w,
    _currentValue2: w,
    _threadCount: 0,
  };
  function Jy(t, l, e, a, u, n, i, c, d) {
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
  function Bd(t, l, e, a, u, n, i, c, d, T, O, C) {
    return (
      (t = new Jy(t, l, e, i, d, T, O, C, c)),
      (l = 1),
      n === !0 && (l |= 24),
      (n = fl(3, null, null, l)),
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
  function Yd(t, l, e, a, u, n) {
    ((u = qd(u)),
      a.context === null ? (a.context = u) : (a.pendingContext = u),
      (a = se(l)),
      (a.payload = { element: e }),
      (n = n === void 0 ? null : n),
      n !== null && (a.callback = n),
      (e = de(t, a, l)),
      e !== null && (el(e, t, l), uu(e, t, l)));
  }
  function jd(t, l) {
    if (((t = t.memoizedState), t !== null && t.dehydrated !== null)) {
      var e = t.retryLane;
      t.retryLane = e !== 0 && e < l ? e : l;
    }
  }
  function bc(t, l) {
    (jd(t, l), (t = t.alternate) && jd(t, l));
  }
  function Ld(t) {
    if (t.tag === 13 || t.tag === 31) {
      var l = Ye(t, 67108864);
      (l !== null && el(l, t, 67108864), bc(t, 67108864));
    }
  }
  function Gd(t) {
    if (t.tag === 13 || t.tag === 31) {
      var l = dl();
      l = mi(l);
      var e = Ye(t, l);
      (e !== null && el(e, t, l), bc(t, l));
    }
  }
  var $n = !0;
  function wy(t, l, e, a) {
    var u = D.T;
    D.T = null;
    var n = B.p;
    try {
      ((B.p = 2), Ec(t, l, e, a));
    } finally {
      ((B.p = n), (D.T = u));
    }
  }
  function $y(t, l, e, a) {
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
      else if (ky(u, t, l, e, a)) a.stopPropagation();
      else if ((Qd(t, a), l & 4 && -1 < Wy.indexOf(t))) {
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
                      var d = 1 << (31 - nl(i));
                      ((c.entanglements[1] |= d), (i &= ~d));
                    }
                    (xl(n), (ot & 6) === 0 && ((Cn = al() + 500), bu(0)));
                  }
                }
                break;
              case 31:
              case 13:
                ((c = Ye(n, 2)), c !== null && el(c, n, 2), Hn(), bc(n, 2));
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
      var l = y(t);
      if (l === null) t = null;
      else {
        var e = l.tag;
        if (e === 13) {
          if (((t = S(l)), t !== null)) return t;
          t = null;
        } else if (e === 31) {
          if (((t = R(l)), t !== null)) return t;
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
          case Yu:
          case Bh:
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
  var Ac = !1,
    ze = null,
    Ae = null,
    _e = null,
    Ou = new Map(),
    Mu = new Map(),
    Re = [],
    Wy =
      "mousedown mouseup touchcancel touchend touchstart auxclick dblclick pointercancel pointerdown pointerup dragend dragstart drop compositionend compositionstart keydown keypress keyup input textInput copy cut paste click change contextmenu reset".split(
        " ",
      );
  function Qd(t, l) {
    switch (t) {
      case "focusin":
      case "focusout":
        ze = null;
        break;
      case "dragenter":
      case "dragleave":
        Ae = null;
        break;
      case "mouseover":
      case "mouseout":
        _e = null;
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
  function ky(t, l, e, a, u) {
    switch (l) {
      case "focusin":
        return ((ze = Du(ze, t, l, e, a, u)), !0);
      case "dragenter":
        return ((Ae = Du(Ae, t, l, e, a, u)), !0);
      case "mouseover":
        return ((_e = Du(_e, t, l, e, a, u)), !0);
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
      var e = y(l);
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
          if (((l = R(e)), l !== null)) {
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
  function Fy() {
    ((Ac = !1),
      ze !== null && kn(ze) && (ze = null),
      Ae !== null && kn(Ae) && (Ae = null),
      _e !== null && kn(_e) && (_e = null),
      Ou.forEach(Vd),
      Mu.forEach(Vd));
  }
  function Fn(t, l) {
    t.blockedOn === l &&
      ((t.blockedOn = null),
      Ac ||
        ((Ac = !0),
        f.unstable_scheduleCallback(f.unstable_NormalPriority, Fy)));
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
  function Ha(t) {
    function l(d) {
      return Fn(d, t);
    }
    (ze !== null && Fn(ze, t),
      Ae !== null && Fn(Ae, t),
      _e !== null && Fn(_e, t),
      Ou.forEach(l),
      Mu.forEach(l));
    for (var e = 0; e < Re.length; e++) {
      var a = Re[e];
      a.blockedOn === t && (a.blockedOn = null);
    }
    for (; 0 < Re.length && ((e = Re[0]), e.blockedOn === null); )
      (Zd(e), e.blockedOn === null && Re.shift());
    if (((e = (t.ownerDocument || t).$$reactFormReplay), e != null))
      for (a = 0; a < e.length; a += 3) {
        var u = e[a],
          n = e[a + 1],
          i = u[kt] || null;
        if (typeof n == "function") i || Kd(e);
        else if (i) {
          var c = null;
          if (n && n.hasAttribute("formAction")) {
            if (((u = n), (i = n[kt] || null))) c = i.formAction;
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
  function _c(t) {
    this._internalRoot = t;
  }
  ((Pn.prototype.render = _c.prototype.render =
    function (t) {
      var l = this._internalRoot;
      if (l === null) throw Error(o(409));
      var e = l.current,
        a = dl();
      Yd(e, a, t, l, null, null);
    }),
    (Pn.prototype.unmount = _c.prototype.unmount =
      function () {
        var t = this._internalRoot;
        if (t !== null) {
          this._internalRoot = null;
          var l = t.containerInfo;
          (Yd(t.current, 2, null, t, null, null), Hn(), (l[ke] = null));
        }
      }));
  function Pn(t) {
    this._internalRoot = t;
  }
  Pn.prototype.unstable_scheduleHydration = function (t) {
    if (t) {
      var l = lo();
      t = { blockedOn: null, target: t, priority: l };
      for (var e = 0; e < Re.length && l !== 0 && l < Re[e].priority; e++);
      (Re.splice(e, 0, t), e === 0 && Zd(t));
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
      (t = t !== null ? N(t) : null),
      (t = t === null ? null : t.stateNode),
      t
    );
  };
  var Iy = {
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
        ((ja = ti.inject(Iy)), (ul = ti));
      } catch {}
  }
  return (
    (Cu.createRoot = function (t, l) {
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
        new _c(l)
      );
    }),
    (Cu.hydrateRoot = function (t, l, e) {
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
        (a = dl()),
        (a = mi(a)),
        (u = se(a)),
        (u.callback = null),
        de(e, u, a),
        (e = a),
        (l.current.lanes = e),
        Ga(l, e),
        xl(l),
        (t[ke] = l.current),
        ic(t),
        new Pn(l)
      );
    }),
    (Cu.version = "19.2.4"),
    Cu
  );
}
var ah;
function cv() {
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
  return (f(), (Mc.exports = fv()), Mc.exports);
}
var ov = cv();
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
function rv(f = {}) {
  function r(o, h) {
    let { pathname: y, search: S, hash: R } = o.location;
    return Bc(
      "",
      { pathname: y, search: S, hash: R },
      (h.state && h.state.usr) || null,
      (h.state && h.state.key) || "default",
    );
  }
  function s(o, h) {
    return typeof h == "string" ? h : Hu(h);
  }
  return dv(r, s, null, f);
}
function _t(f, r) {
  if (f === !1 || f === null || typeof f > "u") throw new Error(r);
}
function Dl(f, r) {
  if (!f) {
    typeof console < "u" && console.warn(r);
    try {
      throw new Error(r);
    } catch {}
  }
}
function sv() {
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
    ...(typeof r == "string" ? xa(r) : r),
    state: s,
    key: (r && r.key) || o || sv(),
  };
}
function Hu({ pathname: f = "/", search: r = "", hash: s = "" }) {
  return (
    r && r !== "?" && (f += r.charAt(0) === "?" ? r : "?" + r),
    s && s !== "#" && (f += s.charAt(0) === "#" ? s : "#" + s),
    f
  );
}
function xa(f) {
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
function dv(f, r, s, o = {}) {
  let { window: h = document.defaultView, v5Compat: y = !1 } = o,
    S = h.history,
    R = "POP",
    b = null,
    v = N();
  v == null && ((v = 0), S.replaceState({ ...S.state, idx: v }, ""));
  function N() {
    return (S.state || { idx: null }).idx;
  }
  function _() {
    R = "POP";
    let Q = N(),
      K = Q == null ? null : Q - v;
    ((v = Q), b && b({ action: R, location: Z.location, delta: K }));
  }
  function x(Q, K) {
    R = "PUSH";
    let W = Bc(Z.location, Q, K);
    v = N() + 1;
    let Y = nh(W, v),
      pt = Z.createHref(W);
    try {
      S.pushState(Y, "", pt);
    } catch (ht) {
      if (ht instanceof DOMException && ht.name === "DataCloneError") throw ht;
      h.location.assign(pt);
    }
    y && b && b({ action: R, location: Z.location, delta: 1 });
  }
  function G(Q, K) {
    R = "REPLACE";
    let W = Bc(Z.location, Q, K);
    v = N();
    let Y = nh(W, v),
      pt = Z.createHref(W);
    (S.replaceState(Y, "", pt),
      y && b && b({ action: R, location: Z.location, delta: 0 }));
  }
  function $(Q) {
    return hv(Q);
  }
  let Z = {
    get action() {
      return R;
    },
    get location() {
      return f(h, S);
    },
    listen(Q) {
      if (b) throw new Error("A history only accepts one active listener");
      return (
        h.addEventListener(uh, _),
        (b = Q),
        () => {
          (h.removeEventListener(uh, _), (b = null));
        }
      );
    },
    createHref(Q) {
      return r(h, Q);
    },
    createURL: $,
    encodeLocation(Q) {
      let K = $(Q);
      return { pathname: K.pathname, search: K.search, hash: K.hash };
    },
    push: x,
    replace: G,
    go(Q) {
      return S.go(Q);
    },
  };
  return Z;
}
function hv(f, r = !1) {
  let s = "http://localhost";
  (typeof window < "u" &&
    (s =
      window.location.origin !== "null"
        ? window.location.origin
        : window.location.href),
    _t(s, "No window.location.(origin|href) available to create URL"));
  let o = typeof f == "string" ? f : Hu(f);
  return (
    (o = o.replace(/ $/, "%20")),
    !r && o.startsWith("//") && (o = s + o),
    new URL(o, s)
  );
}
function sh(f, r, s = "/") {
  return mv(f, r, s, !1);
}
function mv(f, r, s, o) {
  let h = typeof r == "string" ? xa(r) : r,
    y = ee(h.pathname || "/", s);
  if (y == null) return null;
  let S = dh(f);
  yv(S);
  let R = null;
  for (let b = 0; R == null && b < S.length; ++b) {
    let v = Rv(y);
    R = Av(S[b], v, o);
  }
  return R;
}
function dh(f, r = [], s = [], o = "", h = !1) {
  let y = (S, R, b = h, v) => {
    let N = {
      relativePath: v === void 0 ? S.path || "" : v,
      caseSensitive: S.caseSensitive === !0,
      childrenIndex: R,
      route: S,
    };
    if (N.relativePath.startsWith("/")) {
      if (!N.relativePath.startsWith(o) && b) return;
      (_t(
        N.relativePath.startsWith(o),
        `Absolute route path "${N.relativePath}" nested under path "${o}" is not valid. An absolute child route path must start with the combined path of all its parent routes.`,
      ),
        (N.relativePath = N.relativePath.slice(o.length)));
    }
    let _ = le([o, N.relativePath]),
      x = s.concat(N);
    (S.children &&
      S.children.length > 0 &&
      (_t(
        S.index !== !0,
        `Index routes must not have child routes. Please remove all child routes from route path "${_}".`,
      ),
      dh(S.children, r, x, _, b)),
      !(S.path == null && !S.index) &&
        r.push({ path: _, score: Tv(_, S.index), routesMeta: x }));
  };
  return (
    f.forEach((S, R) => {
      var b;
      if (S.path === "" || !((b = S.path) != null && b.includes("?"))) y(S, R);
      else for (let v of hh(S.path)) y(S, R, !0, v);
    }),
    r
  );
}
function hh(f) {
  let r = f.split("/");
  if (r.length === 0) return [];
  let [s, ...o] = r,
    h = s.endsWith("?"),
    y = s.replace(/\?$/, "");
  if (o.length === 0) return h ? [y, ""] : [y];
  let S = hh(o.join("/")),
    R = [];
  return (
    R.push(...S.map((b) => (b === "" ? y : [y, b].join("/")))),
    h && R.push(...S),
    R.map((b) => (f.startsWith("/") && b === "" ? "/" : b))
  );
}
function yv(f) {
  f.sort((r, s) =>
    r.score !== s.score
      ? s.score - r.score
      : zv(
          r.routesMeta.map((o) => o.childrenIndex),
          s.routesMeta.map((o) => o.childrenIndex),
        ),
  );
}
var vv = /^:[\w-]+$/,
  gv = 3,
  pv = 2,
  Sv = 1,
  bv = 10,
  Ev = -2,
  ih = (f) => f === "*";
function Tv(f, r) {
  let s = f.split("/"),
    o = s.length;
  return (
    s.some(ih) && (o += Ev),
    r && (o += pv),
    s
      .filter((h) => !ih(h))
      .reduce((h, y) => h + (vv.test(y) ? gv : y === "" ? Sv : bv), o)
  );
}
function zv(f, r) {
  return f.length === r.length && f.slice(0, -1).every((o, h) => o === r[h])
    ? f[f.length - 1] - r[r.length - 1]
    : 0;
}
function Av(f, r, s = !1) {
  let { routesMeta: o } = f,
    h = {},
    y = "/",
    S = [];
  for (let R = 0; R < o.length; ++R) {
    let b = o[R],
      v = R === o.length - 1,
      N = y === "/" ? r : r.slice(y.length) || "/",
      _ = ui(
        { path: b.relativePath, caseSensitive: b.caseSensitive, end: v },
        N,
      ),
      x = b.route;
    if (
      (!_ &&
        v &&
        s &&
        !o[o.length - 1].route.index &&
        (_ = ui(
          { path: b.relativePath, caseSensitive: b.caseSensitive, end: !1 },
          N,
        )),
      !_)
    )
      return null;
    (Object.assign(h, _.params),
      S.push({
        params: h,
        pathname: le([y, _.pathname]),
        pathnameBase: Uv(le([y, _.pathnameBase])),
        route: x,
      }),
      _.pathnameBase !== "/" && (y = le([y, _.pathnameBase])));
  }
  return S;
}
function ui(f, r) {
  typeof f == "string" && (f = { path: f, caseSensitive: !1, end: !0 });
  let [s, o] = _v(f.path, f.caseSensitive, f.end),
    h = r.match(s);
  if (!h) return null;
  let y = h[0],
    S = y.replace(/(.)\/+$/, "$1"),
    R = h.slice(1);
  return {
    params: o.reduce((v, { paramName: N, isOptional: _ }, x) => {
      if (N === "*") {
        let $ = R[x] || "";
        S = y.slice(0, y.length - $.length).replace(/(.)\/+$/, "$1");
      }
      const G = R[x];
      return (
        _ && !G ? (v[N] = void 0) : (v[N] = (G || "").replace(/%2F/g, "/")),
        v
      );
    }, {}),
    pathname: y,
    pathnameBase: S,
    pattern: f,
  };
}
function _v(f, r = !1, s = !0) {
  Dl(
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
          (S, R, b) => (
            o.push({ paramName: R, isOptional: b != null }),
            b ? "/?([^\\/]+)?" : "/([^\\/]+)"
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
function Rv(f) {
  try {
    return f
      .split("/")
      .map((r) => decodeURIComponent(r).replace(/\//g, "%2F"))
      .join("/");
  } catch (r) {
    return (
      Dl(
        !1,
        `The URL path "${f}" could not be decoded because it is a malformed URL segment. This is probably due to a bad percent encoding (${r}).`,
      ),
      f
    );
  }
}
function ee(f, r) {
  if (r === "/") return f;
  if (!f.toLowerCase().startsWith(r.toLowerCase())) return null;
  let s = r.endsWith("/") ? r.length - 1 : r.length,
    o = f.charAt(s);
  return o && o !== "/" ? null : f.slice(s) || "/";
}
var Ov = /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i;
function Mv(f, r = "/") {
  let {
      pathname: s,
      search: o = "",
      hash: h = "",
    } = typeof f == "string" ? xa(f) : f,
    y;
  return (
    s
      ? ((s = s.replace(/\/\/+/g, "/")),
        s.startsWith("/") ? (y = fh(s.substring(1), "/")) : (y = fh(s, r)))
      : (y = r),
    { pathname: y, search: Cv(o), hash: Nv(h) }
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
function Dv(f) {
  return f.filter(
    (r, s) => s === 0 || (r.route.path && r.route.path.length > 0),
  );
}
function Lc(f) {
  let r = Dv(f);
  return r.map((s, o) => (o === r.length - 1 ? s.pathname : s.pathnameBase));
}
function Gc(f, r, s, o = !1) {
  let h;
  typeof f == "string"
    ? (h = xa(f))
    : ((h = { ...f }),
      _t(
        !h.pathname || !h.pathname.includes("?"),
        Nc("?", "pathname", "search", h),
      ),
      _t(
        !h.pathname || !h.pathname.includes("#"),
        Nc("#", "pathname", "hash", h),
      ),
      _t(!h.search || !h.search.includes("#"), Nc("#", "search", "hash", h)));
  let y = f === "" || h.pathname === "",
    S = y ? "/" : h.pathname,
    R;
  if (S == null) R = s;
  else {
    let _ = r.length - 1;
    if (!o && S.startsWith("..")) {
      let x = S.split("/");
      for (; x[0] === ".."; ) (x.shift(), (_ -= 1));
      h.pathname = x.join("/");
    }
    R = _ >= 0 ? r[_] : "/";
  }
  let b = Mv(h, R),
    v = S && S !== "/" && S.endsWith("/"),
    N = (y || S === ".") && s.endsWith("/");
  return (!b.pathname.endsWith("/") && (v || N) && (b.pathname += "/"), b);
}
var le = (f) => f.join("/").replace(/\/\/+/g, "/"),
  Uv = (f) => f.replace(/\/+$/, "").replace(/^\/*/, "/"),
  Cv = (f) => (!f || f === "?" ? "" : f.startsWith("?") ? f : "?" + f),
  Nv = (f) => (!f || f === "#" ? "" : f.startsWith("#") ? f : "#" + f),
  Hv = class {
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
function Bv(f) {
  return (
    f
      .map((r) => r.route.path)
      .filter(Boolean)
      .join("/")
      .replace(/\/\/*/g, "/") || "/"
  );
}
var mh =
  typeof window < "u" &&
  typeof window.document < "u" &&
  typeof window.document.createElement < "u";
function yh(f, r) {
  let s = f;
  if (typeof s != "string" || !Ov.test(s))
    return { absoluteURL: void 0, isExternal: !1, to: s };
  let o = s,
    h = !1;
  if (mh)
    try {
      let y = new URL(window.location.href),
        S = s.startsWith("//") ? new URL(y.protocol + s) : new URL(s),
        R = ee(S.pathname, r);
      S.origin === y.origin && R != null
        ? (s = R + S.search + S.hash)
        : (h = !0);
    } catch {
      Dl(
        !1,
        `<Link to="${s}"> contains an invalid URL which will probably break when clicked - please update to a valid URL path.`,
      );
    }
  return { absoluteURL: o, isExternal: h, to: s };
}
Object.getOwnPropertyNames(Object.prototype).sort().join("\0");
var vh = ["POST", "PUT", "PATCH", "DELETE"];
new Set(vh);
var qv = ["GET", ...vh];
new Set(qv);
var Ba = M.createContext(null);
Ba.displayName = "DataRouter";
var ni = M.createContext(null);
ni.displayName = "DataRouterState";
var Yv = M.createContext(!1),
  gh = M.createContext({ isTransitioning: !1 });
gh.displayName = "ViewTransition";
var jv = M.createContext(new Map());
jv.displayName = "Fetchers";
var Lv = M.createContext(null);
Lv.displayName = "Await";
var hl = M.createContext(null);
hl.displayName = "Navigation";
var xu = M.createContext(null);
xu.displayName = "Location";
var Bl = M.createContext({ outlet: null, matches: [], isDataRoute: !1 });
Bl.displayName = "Route";
var Xc = M.createContext(null);
Xc.displayName = "RouteError";
var ph = "REACT_ROUTER_ERROR",
  Gv = "REDIRECT",
  Xv = "ROUTE_ERROR_RESPONSE";
function Qv(f) {
  if (f.startsWith(`${ph}:${Gv}:{`))
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
function Zv(f) {
  if (f.startsWith(`${ph}:${Xv}:{`))
    try {
      let r = JSON.parse(f.slice(40));
      if (
        typeof r == "object" &&
        r &&
        typeof r.status == "number" &&
        typeof r.statusText == "string"
      )
        return new Hv(r.status, r.statusText, r.data);
    } catch {}
}
function Vv(f, { relative: r } = {}) {
  _t(
    qa(),
    "useHref() may be used only in the context of a <Router> component.",
  );
  let { basename: s, navigator: o } = M.useContext(hl),
    { hash: h, pathname: y, search: S } = Bu(f, { relative: r }),
    R = y;
  return (
    s !== "/" && (R = y === "/" ? s : le([s, y])),
    o.createHref({ pathname: R, search: S, hash: h })
  );
}
function qa() {
  return M.useContext(xu) != null;
}
function De() {
  return (
    _t(
      qa(),
      "useLocation() may be used only in the context of a <Router> component.",
    ),
    M.useContext(xu).location
  );
}
var Sh =
  "You should call navigate() in a React.useEffect(), not when your component is first rendered.";
function bh(f) {
  M.useContext(hl).static || M.useLayoutEffect(f);
}
function Eh() {
  let { isDataRoute: f } = M.useContext(Bl);
  return f ? a0() : Kv();
}
function Kv() {
  _t(
    qa(),
    "useNavigate() may be used only in the context of a <Router> component.",
  );
  let f = M.useContext(Ba),
    { basename: r, navigator: s } = M.useContext(hl),
    { matches: o } = M.useContext(Bl),
    { pathname: h } = De(),
    y = JSON.stringify(Lc(o)),
    S = M.useRef(!1);
  return (
    bh(() => {
      S.current = !0;
    }),
    M.useCallback(
      (b, v = {}) => {
        if ((Dl(S.current, Sh), !S.current)) return;
        if (typeof b == "number") {
          s.go(b);
          return;
        }
        let N = Gc(b, JSON.parse(y), h, v.relative === "path");
        (f == null &&
          r !== "/" &&
          (N.pathname = N.pathname === "/" ? r : le([r, N.pathname])),
          (v.replace ? s.replace : s.push)(N, v.state, v));
      },
      [r, s, y, h, f],
    )
  );
}
M.createContext(null);
function Bu(f, { relative: r } = {}) {
  let { matches: s } = M.useContext(Bl),
    { pathname: o } = De(),
    h = JSON.stringify(Lc(s));
  return M.useMemo(() => Gc(f, JSON.parse(h), o, r === "path"), [f, h, o, r]);
}
function Jv(f, r) {
  return Th(f, r);
}
function Th(f, r, s, o, h) {
  var W;
  _t(
    qa(),
    "useRoutes() may be used only in the context of a <Router> component.",
  );
  let { navigator: y } = M.useContext(hl),
    { matches: S } = M.useContext(Bl),
    R = S[S.length - 1],
    b = R ? R.params : {},
    v = R ? R.pathname : "/",
    N = R ? R.pathnameBase : "/",
    _ = R && R.route;
  {
    let Y = (_ && _.path) || "";
    Ah(
      v,
      !_ || Y.endsWith("*") || Y.endsWith("*?"),
      `You rendered descendant <Routes> (or called \`useRoutes()\`) at "${v}" (under <Route path="${Y}">) but the parent route path has no trailing "*". This means if you navigate deeper, the parent won't match anymore and therefore the child routes will never render.

Please change the parent <Route path="${Y}"> to <Route path="${Y === "/" ? "*" : `${Y}/*`}">.`,
    );
  }
  let x = De(),
    G;
  if (r) {
    let Y = typeof r == "string" ? xa(r) : r;
    (_t(
      N === "/" || ((W = Y.pathname) == null ? void 0 : W.startsWith(N)),
      `When overriding the location using \`<Routes location>\` or \`useRoutes(routes, location)\`, the location pathname must begin with the portion of the URL pathname that was matched by all parent routes. The current pathname base is "${N}" but pathname "${Y.pathname}" was given in the \`location\` prop.`,
    ),
      (G = Y));
  } else G = x;
  let $ = G.pathname || "/",
    Z = $;
  if (N !== "/") {
    let Y = N.replace(/^\//, "").split("/");
    Z = "/" + $.replace(/^\//, "").split("/").slice(Y.length).join("/");
  }
  let Q = sh(f, { pathname: Z });
  (Dl(
    _ || Q != null,
    `No routes matched location "${G.pathname}${G.search}${G.hash}" `,
  ),
    Dl(
      Q == null ||
        Q[Q.length - 1].route.element !== void 0 ||
        Q[Q.length - 1].route.Component !== void 0 ||
        Q[Q.length - 1].route.lazy !== void 0,
      `Matched leaf route at location "${G.pathname}${G.search}${G.hash}" does not have an element or Component. This means it will render an <Outlet /> with a null value by default resulting in an "empty" page.`,
    ));
  let K = Fv(
    Q &&
      Q.map((Y) =>
        Object.assign({}, Y, {
          params: Object.assign({}, b, Y.params),
          pathname: le([
            N,
            y.encodeLocation
              ? y.encodeLocation(
                  Y.pathname.replace(/\?/g, "%3F").replace(/#/g, "%23"),
                ).pathname
              : Y.pathname,
          ]),
          pathnameBase:
            Y.pathnameBase === "/"
              ? N
              : le([
                  N,
                  y.encodeLocation
                    ? y.encodeLocation(
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
  return r && K
    ? M.createElement(
        xu.Provider,
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
        K,
      )
    : K;
}
function wv() {
  let f = e0(),
    r = xv(f)
      ? `${f.status} ${f.statusText}`
      : f instanceof Error
        ? f.message
        : JSON.stringify(f),
    s = f instanceof Error ? f.stack : null,
    o = "rgba(200,200,200, 0.5)",
    h = { padding: "0.5rem", backgroundColor: o },
    y = { padding: "2px 4px", backgroundColor: o },
    S = null;
  return (
    console.error("Error handled by React Router default ErrorBoundary:", f),
    (S = M.createElement(
      M.Fragment,
      null,
      M.createElement("p", null, "💿 Hey developer 👋"),
      M.createElement(
        "p",
        null,
        "You can provide a way better UX than this when your app throws errors by providing your own ",
        M.createElement("code", { style: y }, "ErrorBoundary"),
        " or",
        " ",
        M.createElement("code", { style: y }, "errorElement"),
        " prop on your route.",
      ),
    )),
    M.createElement(
      M.Fragment,
      null,
      M.createElement("h2", null, "Unexpected Application Error!"),
      M.createElement("h3", { style: { fontStyle: "italic" } }, r),
      s ? M.createElement("pre", { style: h }, s) : null,
      S,
    )
  );
}
var $v = M.createElement(wv, null),
  zh = class extends M.Component {
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
        const s = Zv(f.digest);
        s && (f = s);
      }
      let r =
        f !== void 0
          ? M.createElement(
              Bl.Provider,
              { value: this.props.routeContext },
              M.createElement(Xc.Provider, {
                value: f,
                children: this.props.component,
              }),
            )
          : this.props.children;
      return this.context ? M.createElement(Wv, { error: f }, r) : r;
    }
  };
zh.contextType = Yv;
var Hc = new WeakMap();
function Wv({ children: f, error: r }) {
  let { basename: s } = M.useContext(hl);
  if (
    typeof r == "object" &&
    r &&
    "digest" in r &&
    typeof r.digest == "string"
  ) {
    let o = Qv(r.digest);
    if (o) {
      let h = Hc.get(r);
      if (h) throw h;
      let y = yh(o.location, s);
      if (mh && !Hc.get(r))
        if (y.isExternal || o.reloadDocument)
          window.location.href = y.absoluteURL || y.to;
        else {
          const S = Promise.resolve().then(() =>
            window.__reactRouterDataRouter.navigate(y.to, {
              replace: o.replace,
            }),
          );
          throw (Hc.set(r, S), S);
        }
      return M.createElement("meta", {
        httpEquiv: "refresh",
        content: `0;url=${y.absoluteURL || y.to}`,
      });
    }
  }
  return f;
}
function kv({ routeContext: f, match: r, children: s }) {
  let o = M.useContext(Ba);
  return (
    o &&
      o.static &&
      o.staticContext &&
      (r.route.errorElement || r.route.ErrorBoundary) &&
      (o.staticContext._deepestRenderedBoundaryId = r.route.id),
    M.createElement(Bl.Provider, { value: f }, s)
  );
}
function Fv(f, r = [], s = null, o = null, h = null) {
  if (f == null) {
    if (!s) return null;
    if (s.errors) f = s.matches;
    else if (r.length === 0 && !s.initialized && s.matches.length > 0)
      f = s.matches;
    else return null;
  }
  let y = f,
    S = s == null ? void 0 : s.errors;
  if (S != null) {
    let N = y.findIndex(
      (_) => _.route.id && (S == null ? void 0 : S[_.route.id]) !== void 0,
    );
    (_t(
      N >= 0,
      `Could not find a matching route for errors on route IDs: ${Object.keys(S).join(",")}`,
    ),
      (y = y.slice(0, Math.min(y.length, N + 1))));
  }
  let R = !1,
    b = -1;
  if (s)
    for (let N = 0; N < y.length; N++) {
      let _ = y[N];
      if (
        ((_.route.HydrateFallback || _.route.hydrateFallbackElement) && (b = N),
        _.route.id)
      ) {
        let { loaderData: x, errors: G } = s,
          $ =
            _.route.loader &&
            !x.hasOwnProperty(_.route.id) &&
            (!G || G[_.route.id] === void 0);
        if (_.route.lazy || $) {
          ((R = !0), b >= 0 ? (y = y.slice(0, b + 1)) : (y = [y[0]]));
          break;
        }
      }
    }
  let v =
    s && o
      ? (N, _) => {
          var x, G;
          o(N, {
            location: s.location,
            params:
              ((G = (x = s.matches) == null ? void 0 : x[0]) == null
                ? void 0
                : G.params) ?? {},
            unstable_pattern: Bv(s.matches),
            errorInfo: _,
          });
        }
      : void 0;
  return y.reduceRight((N, _, x) => {
    let G,
      $ = !1,
      Z = null,
      Q = null;
    s &&
      ((G = S && _.route.id ? S[_.route.id] : void 0),
      (Z = _.route.errorElement || $v),
      R &&
        (b < 0 && x === 0
          ? (Ah(
              "route-fallback",
              !1,
              "No `HydrateFallback` element provided to render during initial hydration",
            ),
            ($ = !0),
            (Q = null))
          : b === x &&
            (($ = !0), (Q = _.route.hydrateFallbackElement || null))));
    let K = r.concat(y.slice(0, x + 1)),
      W = () => {
        let Y;
        return (
          G
            ? (Y = Z)
            : $
              ? (Y = Q)
              : _.route.Component
                ? (Y = M.createElement(_.route.Component, null))
                : _.route.element
                  ? (Y = _.route.element)
                  : (Y = N),
          M.createElement(kv, {
            match: _,
            routeContext: { outlet: N, matches: K, isDataRoute: s != null },
            children: Y,
          })
        );
      };
    return s && (_.route.ErrorBoundary || _.route.errorElement || x === 0)
      ? M.createElement(zh, {
          location: s.location,
          revalidation: s.revalidation,
          component: Z,
          error: G,
          children: W(),
          routeContext: { outlet: null, matches: K, isDataRoute: !0 },
          onError: v,
        })
      : W();
  }, null);
}
function Qc(f) {
  return `${f} must be used within a data router.  See https://reactrouter.com/en/main/routers/picking-a-router.`;
}
function Iv(f) {
  let r = M.useContext(Ba);
  return (_t(r, Qc(f)), r);
}
function Pv(f) {
  let r = M.useContext(ni);
  return (_t(r, Qc(f)), r);
}
function t0(f) {
  let r = M.useContext(Bl);
  return (_t(r, Qc(f)), r);
}
function Zc(f) {
  let r = t0(f),
    s = r.matches[r.matches.length - 1];
  return (
    _t(
      s.route.id,
      `${f} can only be used on routes that contain a unique "id"`,
    ),
    s.route.id
  );
}
function l0() {
  return Zc("useRouteId");
}
function e0() {
  var o;
  let f = M.useContext(Xc),
    r = Pv("useRouteError"),
    s = Zc("useRouteError");
  return f !== void 0 ? f : (o = r.errors) == null ? void 0 : o[s];
}
function a0() {
  let { router: f } = Iv("useNavigate"),
    r = Zc("useNavigate"),
    s = M.useRef(!1);
  return (
    bh(() => {
      s.current = !0;
    }),
    M.useCallback(
      async (h, y = {}) => {
        (Dl(s.current, Sh),
          s.current &&
            (typeof h == "number"
              ? await f.navigate(h)
              : await f.navigate(h, { fromRouteId: r, ...y })));
      },
      [f, r],
    )
  );
}
var ch = {};
function Ah(f, r, s) {
  !r && !ch[f] && ((ch[f] = !0), Dl(!1, s));
}
M.memo(u0);
function u0({ routes: f, future: r, state: s, onError: o }) {
  return Th(f, void 0, s, o, r);
}
function n0({ to: f, replace: r, state: s, relative: o }) {
  _t(
    qa(),
    "<Navigate> may be used only in the context of a <Router> component.",
  );
  let { static: h } = M.useContext(hl);
  Dl(
    !h,
    "<Navigate> must not be used on the initial render in a <StaticRouter>. This is a no-op, but you should modify your code so the <Navigate> is only ever rendered in response to some user interaction or state change.",
  );
  let { matches: y } = M.useContext(Bl),
    { pathname: S } = De(),
    R = Eh(),
    b = Gc(f, Lc(y), S, o === "path"),
    v = JSON.stringify(b);
  return (
    M.useEffect(() => {
      R(JSON.parse(v), { replace: r, state: s, relative: o });
    }, [R, v, o, r, s]),
    null
  );
}
function qc(f) {
  _t(
    !1,
    "A <Route> is only ever to be used as the child of <Routes> element, never rendered directly. Please wrap your <Route> in a <Routes>.",
  );
}
function i0({
  basename: f = "/",
  children: r = null,
  location: s,
  navigationType: o = "POP",
  navigator: h,
  static: y = !1,
  unstable_useTransitions: S,
}) {
  _t(
    !qa(),
    "You cannot render a <Router> inside another <Router>. You should never have more than one in your app.",
  );
  let R = f.replace(/^\/*/, "/"),
    b = M.useMemo(
      () => ({
        basename: R,
        navigator: h,
        static: y,
        unstable_useTransitions: S,
        future: {},
      }),
      [R, h, y, S],
    );
  typeof s == "string" && (s = xa(s));
  let {
      pathname: v = "/",
      search: N = "",
      hash: _ = "",
      state: x = null,
      key: G = "default",
    } = s,
    $ = M.useMemo(() => {
      let Z = ee(v, R);
      return Z == null
        ? null
        : {
            location: { pathname: Z, search: N, hash: _, state: x, key: G },
            navigationType: o,
          };
    }, [R, v, N, _, x, G, o]);
  return (
    Dl(
      $ != null,
      `<Router basename="${R}"> is not able to match the URL "${v}${N}${_}" because it does not start with the basename, so the <Router> won't render anything.`,
    ),
    $ == null
      ? null
      : M.createElement(
          hl.Provider,
          { value: b },
          M.createElement(xu.Provider, { children: r, value: $ }),
        )
  );
}
function f0({ children: f, location: r }) {
  return Jv(Yc(f), r);
}
function Yc(f, r = []) {
  let s = [];
  return (
    M.Children.forEach(f, (o, h) => {
      if (!M.isValidElement(o)) return;
      let y = [...r, h];
      if (o.type === M.Fragment) {
        s.push.apply(s, Yc(o.props.children, y));
        return;
      }
      (_t(
        o.type === qc,
        `[${typeof o.type == "string" ? o.type : o.type.name}] is not a <Route> component. All component children of <Routes> must be a <Route> or <React.Fragment>`,
      ),
        _t(
          !o.props.index || !o.props.children,
          "An index route cannot have child routes.",
        ));
      let S = {
        id: o.props.id || y.join("-"),
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
      (o.props.children && (S.children = Yc(o.props.children, y)), s.push(S));
    }),
    s
  );
}
var ei = "get",
  ai = "application/x-www-form-urlencoded";
function ii(f) {
  return typeof HTMLElement < "u" && f instanceof HTMLElement;
}
function c0(f) {
  return ii(f) && f.tagName.toLowerCase() === "button";
}
function o0(f) {
  return ii(f) && f.tagName.toLowerCase() === "form";
}
function r0(f) {
  return ii(f) && f.tagName.toLowerCase() === "input";
}
function s0(f) {
  return !!(f.metaKey || f.altKey || f.ctrlKey || f.shiftKey);
}
function d0(f, r) {
  return f.button === 0 && (!r || r === "_self") && !s0(f);
}
var li = null;
function h0() {
  if (li === null)
    try {
      (new FormData(document.createElement("form"), 0), (li = !1));
    } catch {
      li = !0;
    }
  return li;
}
var m0 = new Set([
  "application/x-www-form-urlencoded",
  "multipart/form-data",
  "text/plain",
]);
function xc(f) {
  return f != null && !m0.has(f)
    ? (Dl(
        !1,
        `"${f}" is not a valid \`encType\` for \`<Form>\`/\`<fetcher.Form>\` and will default to "${ai}"`,
      ),
      null)
    : f;
}
function y0(f, r) {
  let s, o, h, y, S;
  if (o0(f)) {
    let R = f.getAttribute("action");
    ((o = R ? ee(R, r) : null),
      (s = f.getAttribute("method") || ei),
      (h = xc(f.getAttribute("enctype")) || ai),
      (y = new FormData(f)));
  } else if (c0(f) || (r0(f) && (f.type === "submit" || f.type === "image"))) {
    let R = f.form;
    if (R == null)
      throw new Error(
        'Cannot submit a <button> or <input type="submit"> without a <form>',
      );
    let b = f.getAttribute("formaction") || R.getAttribute("action");
    if (
      ((o = b ? ee(b, r) : null),
      (s = f.getAttribute("formmethod") || R.getAttribute("method") || ei),
      (h =
        xc(f.getAttribute("formenctype")) ||
        xc(R.getAttribute("enctype")) ||
        ai),
      (y = new FormData(R, f)),
      !h0())
    ) {
      let { name: v, type: N, value: _ } = f;
      if (N === "image") {
        let x = v ? `${v}.` : "";
        (y.append(`${x}x`, "0"), y.append(`${x}y`, "0"));
      } else v && y.append(v, _);
    }
  } else {
    if (ii(f))
      throw new Error(
        'Cannot submit element that is not <form>, <button>, or <input type="submit|image">',
      );
    ((s = ei), (o = null), (h = ai), (S = f));
  }
  return (
    y && h === "text/plain" && ((S = y), (y = void 0)),
    { action: o, method: s.toLowerCase(), encType: h, formData: y, body: S }
  );
}
Object.getOwnPropertyNames(Object.prototype).sort().join("\0");
function Vc(f, r) {
  if (f === !1 || f === null || typeof f > "u") throw new Error(r);
}
function v0(f, r, s, o) {
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
        : r && ee(h.pathname, r) === "/"
          ? (h.pathname = `${r.replace(/\/$/, "")}/_root.${o}`)
          : (h.pathname = `${h.pathname.replace(/\/$/, "")}.${o}`),
    h
  );
}
async function g0(f, r) {
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
function p0(f) {
  return f == null
    ? !1
    : f.href == null
      ? f.rel === "preload" &&
        typeof f.imageSrcSet == "string" &&
        typeof f.imageSizes == "string"
      : typeof f.rel == "string" && typeof f.href == "string";
}
async function S0(f, r, s) {
  let o = await Promise.all(
    f.map(async (h) => {
      let y = r.routes[h.route.id];
      if (y) {
        let S = await g0(y, s);
        return S.links ? S.links() : [];
      }
      return [];
    }),
  );
  return z0(
    o
      .flat(1)
      .filter(p0)
      .filter((h) => h.rel === "stylesheet" || h.rel === "preload")
      .map((h) =>
        h.rel === "stylesheet"
          ? { ...h, rel: "prefetch", as: "style" }
          : { ...h, rel: "prefetch" },
      ),
  );
}
function oh(f, r, s, o, h, y) {
  let S = (b, v) => (s[v] ? b.route.id !== s[v].route.id : !0),
    R = (b, v) => {
      var N;
      return (
        s[v].pathname !== b.pathname ||
        (((N = s[v].route.path) == null ? void 0 : N.endsWith("*")) &&
          s[v].params["*"] !== b.params["*"])
      );
    };
  return y === "assets"
    ? r.filter((b, v) => S(b, v) || R(b, v))
    : y === "data"
      ? r.filter((b, v) => {
          var _;
          let N = o.routes[b.route.id];
          if (!N || !N.hasLoader) return !1;
          if (S(b, v) || R(b, v)) return !0;
          if (b.route.shouldRevalidate) {
            let x = b.route.shouldRevalidate({
              currentUrl: new URL(
                h.pathname + h.search + h.hash,
                window.origin,
              ),
              currentParams: ((_ = s[0]) == null ? void 0 : _.params) || {},
              nextUrl: new URL(f, window.origin),
              nextParams: b.params,
              defaultShouldRevalidate: !0,
            });
            if (typeof x == "boolean") return x;
          }
          return !0;
        })
      : [];
}
function b0(f, r, { includeHydrateFallback: s } = {}) {
  return E0(
    f
      .map((o) => {
        let h = r.routes[o.route.id];
        if (!h) return [];
        let y = [h.module];
        return (
          h.clientActionModule && (y = y.concat(h.clientActionModule)),
          h.clientLoaderModule && (y = y.concat(h.clientLoaderModule)),
          s &&
            h.hydrateFallbackModule &&
            (y = y.concat(h.hydrateFallbackModule)),
          h.imports && (y = y.concat(h.imports)),
          y
        );
      })
      .flat(1),
  );
}
function E0(f) {
  return [...new Set(f)];
}
function T0(f) {
  let r = {},
    s = Object.keys(f).sort();
  for (let o of s) r[o] = f[o];
  return r;
}
function z0(f, r) {
  let s = new Set();
  return (
    new Set(r),
    f.reduce((o, h) => {
      let y = JSON.stringify(T0(h));
      return (s.has(y) || (s.add(y), o.push({ key: y, link: h })), o);
    }, [])
  );
}
function _h() {
  let f = M.useContext(Ba);
  return (
    Vc(
      f,
      "You must render this element inside a <DataRouterContext.Provider> element",
    ),
    f
  );
}
function A0() {
  let f = M.useContext(ni);
  return (
    Vc(
      f,
      "You must render this element inside a <DataRouterStateContext.Provider> element",
    ),
    f
  );
}
var Kc = M.createContext(void 0);
Kc.displayName = "FrameworkContext";
function Rh() {
  let f = M.useContext(Kc);
  return (
    Vc(f, "You must render this element inside a <HydratedRouter> element"),
    f
  );
}
function _0(f, r) {
  let s = M.useContext(Kc),
    [o, h] = M.useState(!1),
    [y, S] = M.useState(!1),
    {
      onFocus: R,
      onBlur: b,
      onMouseEnter: v,
      onMouseLeave: N,
      onTouchStart: _,
    } = r,
    x = M.useRef(null);
  (M.useEffect(() => {
    if ((f === "render" && S(!0), f === "viewport")) {
      let Z = (K) => {
          K.forEach((W) => {
            S(W.isIntersecting);
          });
        },
        Q = new IntersectionObserver(Z, { threshold: 0.5 });
      return (
        x.current && Q.observe(x.current),
        () => {
          Q.disconnect();
        }
      );
    }
  }, [f]),
    M.useEffect(() => {
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
    $ = () => {
      (h(!1), S(!1));
    };
  return s
    ? f !== "intent"
      ? [y, x, {}]
      : [
          y,
          x,
          {
            onFocus: Nu(R, G),
            onBlur: Nu(b, $),
            onMouseEnter: Nu(v, G),
            onMouseLeave: Nu(N, $),
            onTouchStart: Nu(_, G),
          },
        ]
    : [!1, x, {}];
}
function Nu(f, r) {
  return (s) => {
    (f && f(s), s.defaultPrevented || r(s));
  };
}
function R0({ page: f, ...r }) {
  let { router: s } = _h(),
    o = M.useMemo(() => sh(s.routes, f, s.basename), [s.routes, f, s.basename]);
  return o ? M.createElement(M0, { page: f, matches: o, ...r }) : null;
}
function O0(f) {
  let { manifest: r, routeModules: s } = Rh(),
    [o, h] = M.useState([]);
  return (
    M.useEffect(() => {
      let y = !1;
      return (
        S0(f, r, s).then((S) => {
          y || h(S);
        }),
        () => {
          y = !0;
        }
      );
    }, [f, r, s]),
    o
  );
}
function M0({ page: f, matches: r, ...s }) {
  let o = De(),
    { future: h, manifest: y, routeModules: S } = Rh(),
    { basename: R } = _h(),
    { loaderData: b, matches: v } = A0(),
    N = M.useMemo(() => oh(f, r, v, y, o, "data"), [f, r, v, y, o]),
    _ = M.useMemo(() => oh(f, r, v, y, o, "assets"), [f, r, v, y, o]),
    x = M.useMemo(() => {
      if (f === o.pathname + o.search + o.hash) return [];
      let Z = new Set(),
        Q = !1;
      if (
        (r.forEach((W) => {
          var pt;
          let Y = y.routes[W.route.id];
          !Y ||
            !Y.hasLoader ||
            ((!N.some((ht) => ht.route.id === W.route.id) &&
              W.route.id in b &&
              (pt = S[W.route.id]) != null &&
              pt.shouldRevalidate) ||
            Y.hasClientLoader
              ? (Q = !0)
              : Z.add(W.route.id));
        }),
        Z.size === 0)
      )
        return [];
      let K = v0(f, R, h.unstable_trailingSlashAwareDataRequests, "data");
      return (
        Q &&
          Z.size > 0 &&
          K.searchParams.set(
            "_routes",
            r
              .filter((W) => Z.has(W.route.id))
              .map((W) => W.route.id)
              .join(","),
          ),
        [K.pathname + K.search]
      );
    }, [R, h.unstable_trailingSlashAwareDataRequests, b, o, y, N, r, f, S]),
    G = M.useMemo(() => b0(_, y), [_, y]),
    $ = O0(_);
  return M.createElement(
    M.Fragment,
    null,
    x.map((Z) =>
      M.createElement("link", {
        key: Z,
        rel: "prefetch",
        as: "fetch",
        href: Z,
        ...s,
      }),
    ),
    G.map((Z) =>
      M.createElement("link", { key: Z, rel: "modulepreload", href: Z, ...s }),
    ),
    $.map(({ key: Z, link: Q }) =>
      M.createElement("link", {
        key: Z,
        nonce: s.nonce,
        ...Q,
        crossOrigin: Q.crossOrigin ?? s.crossOrigin,
      }),
    ),
  );
}
function D0(...f) {
  return (r) => {
    f.forEach((s) => {
      typeof s == "function" ? s(r) : s != null && (s.current = r);
    });
  };
}
var U0 =
  typeof window < "u" &&
  typeof window.document < "u" &&
  typeof window.document.createElement < "u";
try {
  U0 && (window.__reactRouterVersion = "7.13.0");
} catch {}
function C0({
  basename: f,
  children: r,
  unstable_useTransitions: s,
  window: o,
}) {
  let h = M.useRef();
  h.current == null && (h.current = rv({ window: o, v5Compat: !0 }));
  let y = h.current,
    [S, R] = M.useState({ action: y.action, location: y.location }),
    b = M.useCallback(
      (v) => {
        s === !1 ? R(v) : M.startTransition(() => R(v));
      },
      [s],
    );
  return (
    M.useLayoutEffect(() => y.listen(b), [y, b]),
    M.createElement(i0, {
      basename: f,
      children: r,
      location: S.location,
      navigationType: S.action,
      navigator: y,
      unstable_useTransitions: s,
    })
  );
}
var Oh = /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i,
  Mh = M.forwardRef(function (
    {
      onClick: r,
      discover: s = "render",
      prefetch: o = "none",
      relative: h,
      reloadDocument: y,
      replace: S,
      state: R,
      target: b,
      to: v,
      preventScrollReset: N,
      viewTransition: _,
      unstable_defaultShouldRevalidate: x,
      ...G
    },
    $,
  ) {
    let { basename: Z, unstable_useTransitions: Q } = M.useContext(hl),
      K = typeof v == "string" && Oh.test(v),
      W = yh(v, Z);
    v = W.to;
    let Y = Vv(v, { relative: h }),
      [pt, ht, zt] = _0(o, G),
      F = x0(v, {
        replace: S,
        state: R,
        target: b,
        preventScrollReset: N,
        relative: h,
        viewTransition: _,
        unstable_defaultShouldRevalidate: x,
        unstable_useTransitions: Q,
      });
    function Dt(ml) {
      (r && r(ml), ml.defaultPrevented || F(ml));
    }
    let Gt = M.createElement("a", {
      ...G,
      ...zt,
      href: W.absoluteURL || Y,
      onClick: W.isExternal || y ? r : Dt,
      ref: D0($, ht),
      target: b,
      "data-discover": !K && s === "render" ? "true" : void 0,
    });
    return pt && !K
      ? M.createElement(M.Fragment, null, Gt, M.createElement(R0, { page: Y }))
      : Gt;
  });
Mh.displayName = "Link";
var Dh = M.forwardRef(function (
  {
    "aria-current": r = "page",
    caseSensitive: s = !1,
    className: o = "",
    end: h = !1,
    style: y,
    to: S,
    viewTransition: R,
    children: b,
    ...v
  },
  N,
) {
  let _ = Bu(S, { relative: v.relative }),
    x = De(),
    G = M.useContext(ni),
    { navigator: $, basename: Z } = M.useContext(hl),
    Q = G != null && L0(_) && R === !0,
    K = $.encodeLocation ? $.encodeLocation(_).pathname : _.pathname,
    W = x.pathname,
    Y =
      G && G.navigation && G.navigation.location
        ? G.navigation.location.pathname
        : null;
  (s ||
    ((W = W.toLowerCase()),
    (Y = Y ? Y.toLowerCase() : null),
    (K = K.toLowerCase())),
    Y && Z && (Y = ee(Y, Z) || Y));
  const pt = K !== "/" && K.endsWith("/") ? K.length - 1 : K.length;
  let ht = W === K || (!h && W.startsWith(K) && W.charAt(pt) === "/"),
    zt =
      Y != null &&
      (Y === K || (!h && Y.startsWith(K) && Y.charAt(K.length) === "/")),
    F = { isActive: ht, isPending: zt, isTransitioning: Q },
    Dt = ht ? r : void 0,
    Gt;
  typeof o == "function"
    ? (Gt = o(F))
    : (Gt = [
        o,
        ht ? "active" : null,
        zt ? "pending" : null,
        Q ? "transitioning" : null,
      ]
        .filter(Boolean)
        .join(" "));
  let ml = typeof y == "function" ? y(F) : y;
  return M.createElement(
    Mh,
    {
      ...v,
      "aria-current": Dt,
      className: Gt,
      ref: N,
      style: ml,
      to: S,
      viewTransition: R,
    },
    typeof b == "function" ? b(F) : b,
  );
});
Dh.displayName = "NavLink";
var N0 = M.forwardRef(
  (
    {
      discover: f = "render",
      fetcherKey: r,
      navigate: s,
      reloadDocument: o,
      replace: h,
      state: y,
      method: S = ei,
      action: R,
      onSubmit: b,
      relative: v,
      preventScrollReset: N,
      viewTransition: _,
      unstable_defaultShouldRevalidate: x,
      ...G
    },
    $,
  ) => {
    let { unstable_useTransitions: Z } = M.useContext(hl),
      Q = Y0(),
      K = j0(R, { relative: v }),
      W = S.toLowerCase() === "get" ? "get" : "post",
      Y = typeof R == "string" && Oh.test(R),
      pt = (ht) => {
        if ((b && b(ht), ht.defaultPrevented)) return;
        ht.preventDefault();
        let zt = ht.nativeEvent.submitter,
          F = (zt == null ? void 0 : zt.getAttribute("formmethod")) || S,
          Dt = () =>
            Q(zt || ht.currentTarget, {
              fetcherKey: r,
              method: F,
              navigate: s,
              replace: h,
              state: y,
              relative: v,
              preventScrollReset: N,
              viewTransition: _,
              unstable_defaultShouldRevalidate: x,
            });
        Z && s !== !1 ? M.startTransition(() => Dt()) : Dt();
      };
    return M.createElement("form", {
      ref: $,
      method: W,
      action: K,
      onSubmit: o ? b : pt,
      ...G,
      "data-discover": !Y && f === "render" ? "true" : void 0,
    });
  },
);
N0.displayName = "Form";
function H0(f) {
  return `${f} must be used within a data router.  See https://reactrouter.com/en/main/routers/picking-a-router.`;
}
function Uh(f) {
  let r = M.useContext(Ba);
  return (_t(r, H0(f)), r);
}
function x0(
  f,
  {
    target: r,
    replace: s,
    state: o,
    preventScrollReset: h,
    relative: y,
    viewTransition: S,
    unstable_defaultShouldRevalidate: R,
    unstable_useTransitions: b,
  } = {},
) {
  let v = Eh(),
    N = De(),
    _ = Bu(f, { relative: y });
  return M.useCallback(
    (x) => {
      if (d0(x, r)) {
        x.preventDefault();
        let G = s !== void 0 ? s : Hu(N) === Hu(_),
          $ = () =>
            v(f, {
              replace: G,
              state: o,
              preventScrollReset: h,
              relative: y,
              viewTransition: S,
              unstable_defaultShouldRevalidate: R,
            });
        b ? M.startTransition(() => $()) : $();
      }
    },
    [N, v, _, s, o, r, f, h, y, S, R, b],
  );
}
var B0 = 0,
  q0 = () => `__${String(++B0)}__`;
function Y0() {
  let { router: f } = Uh("useSubmit"),
    { basename: r } = M.useContext(hl),
    s = l0(),
    o = f.fetch,
    h = f.navigate;
  return M.useCallback(
    async (y, S = {}) => {
      let { action: R, method: b, encType: v, formData: N, body: _ } = y0(y, r);
      if (S.navigate === !1) {
        let x = S.fetcherKey || q0();
        await o(x, s, S.action || R, {
          unstable_defaultShouldRevalidate: S.unstable_defaultShouldRevalidate,
          preventScrollReset: S.preventScrollReset,
          formData: N,
          body: _,
          formMethod: S.method || b,
          formEncType: S.encType || v,
          flushSync: S.flushSync,
        });
      } else
        await h(S.action || R, {
          unstable_defaultShouldRevalidate: S.unstable_defaultShouldRevalidate,
          preventScrollReset: S.preventScrollReset,
          formData: N,
          body: _,
          formMethod: S.method || b,
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
  let { basename: s } = M.useContext(hl),
    o = M.useContext(Bl);
  _t(o, "useFormAction must be used inside a RouteContext");
  let [h] = o.matches.slice(-1),
    y = { ...Bu(f || ".", { relative: r }) },
    S = De();
  if (f == null) {
    y.search = S.search;
    let R = new URLSearchParams(y.search),
      b = R.getAll("index");
    if (b.some((N) => N === "")) {
      (R.delete("index"),
        b.filter((_) => _).forEach((_) => R.append("index", _)));
      let N = R.toString();
      y.search = N ? `?${N}` : "";
    }
  }
  return (
    (!f || f === ".") &&
      h.route.index &&
      (y.search = y.search ? y.search.replace(/^\?/, "?index&") : "?index"),
    s !== "/" && (y.pathname = y.pathname === "/" ? s : le([s, y.pathname])),
    Hu(y)
  );
}
function L0(f, { relative: r } = {}) {
  let s = M.useContext(gh);
  _t(
    s != null,
    "`useViewTransitionState` must be used within `react-router-dom`'s `RouterProvider`.  Did you accidentally import `RouterProvider` from `react-router`?",
  );
  let { basename: o } = Uh("useViewTransitionState"),
    h = Bu(f, { relative: r });
  if (!s.isTransitioning) return !1;
  let y = ee(s.currentLocation.pathname, o) || s.currentLocation.pathname,
    S = ee(s.nextLocation.pathname, o) || s.nextLocation.pathname;
  return ui(h.pathname, S) != null || ui(h.pathname, y) != null;
}
async function G0() {
  const f = await fetch("/api/config");
  if (!f.ok) throw new Error("Failed to load config");
  return f.json();
}
async function X0(f) {
  const r = await fetch("/api/config", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(f),
  });
  if (!r.ok) throw new Error("Failed to save config");
  return r.json();
}
const Q0 = "_heading_1yk8p_1",
  Z0 = "_toast_1yk8p_6",
  V0 = "_success_1yk8p_13",
  K0 = "_error_1yk8p_18",
  J0 = "_form_1yk8p_23",
  w0 = "_field_1yk8p_29",
  $0 = "_label_1yk8p_35",
  W0 = "_input_1yk8p_40",
  k0 = "_button_1yk8p_54",
  Me = {
    heading: Q0,
    toast: Z0,
    success: V0,
    error: K0,
    form: J0,
    field: w0,
    label: $0,
    input: W0,
    button: k0,
  },
  rh = [
    {
      key: "plex_url",
      label: "Plex URL",
      type: "text",
      placeholder: "http://localhost:32400",
    },
    {
      key: "plex_token",
      label: "Plex Token",
      type: "password",
      placeholder: "Enter token",
    },
    {
      key: "anthropic_api_key",
      label: "AI Token",
      type: "password",
      placeholder: "Enter API key",
    },
  ];
function F0() {
  const [f, r] = M.useState({}),
    [s, o] = M.useState(null),
    [h, y] = M.useState(!0);
  M.useEffect(() => {
    G0()
      .then(r)
      .catch(() => o({ type: "error", msg: "Failed to load settings" }))
      .finally(() => y(!1));
  }, []);
  const S = async (R) => {
    (R.preventDefault(), o(null));
    try {
      const b = {};
      for (const v of rh) b[v.key] = f[v.key] || "";
      (await X0(b), o({ type: "success", msg: "Settings saved" }));
    } catch {
      o({ type: "error", msg: "Failed to save settings" });
    }
  };
  return h
    ? Rt.jsx("p", { children: "Loading..." })
    : Rt.jsxs("div", {
        children: [
          Rt.jsx("h2", { className: Me.heading, children: "Settings" }),
          s &&
            Rt.jsx("div", {
              className: `${Me.toast} ${Me[s.type]}`,
              children: s.msg,
            }),
          Rt.jsxs("form", {
            onSubmit: S,
            className: Me.form,
            children: [
              rh.map((R) =>
                Rt.jsxs(
                  "label",
                  {
                    className: Me.field,
                    children: [
                      Rt.jsx("span", {
                        className: Me.label,
                        children: R.label,
                      }),
                      Rt.jsx("input", {
                        type: R.type,
                        className: Me.input,
                        placeholder: R.placeholder,
                        value: f[R.key] || "",
                        onChange: (b) => r({ ...f, [R.key]: b.target.value }),
                      }),
                    ],
                  },
                  R.key,
                ),
              ),
              Rt.jsx("button", {
                type: "submit",
                className: Me.button,
                children: "Save",
              }),
            ],
          }),
        ],
      });
}
function I0() {
  return Rt.jsxs("div", {
    className: "layout",
    children: [
      Rt.jsxs("aside", {
        className: "sidebar",
        children: [
          Rt.jsx("h1", { className: "sidebar-title", children: "Tinkerbell" }),
          Rt.jsx("nav", {
            children: Rt.jsx(Dh, {
              to: "/settings",
              className: "nav-link",
              children: "Settings",
            }),
          }),
        ],
      }),
      Rt.jsx("main", {
        className: "content",
        children: Rt.jsxs(f0, {
          children: [
            Rt.jsx(qc, { path: "/settings", element: Rt.jsx(F0, {}) }),
            Rt.jsx(qc, {
              path: "*",
              element: Rt.jsx(n0, { to: "/settings", replace: !0 }),
            }),
          ],
        }),
      }),
    ],
  });
}
ov.createRoot(document.getElementById("root")).render(
  Rt.jsx(M.StrictMode, { children: Rt.jsx(C0, { children: Rt.jsx(I0, {}) }) }),
);
