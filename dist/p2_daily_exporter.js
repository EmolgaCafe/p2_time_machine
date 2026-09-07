(() => {
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __commonJS = (cb, mod) => function __require() {
    try {
      return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
    } catch (e) {
      throw mod = 0, e;
    }
  };

  // main.js
  var require_main = __commonJS({
    "main.js"() {
      (function() {
        "use strict";
        console.log(
          "[P2] submit-score blocked"
        );
        $done();
      })();
    }
  });
  require_main();
})();
