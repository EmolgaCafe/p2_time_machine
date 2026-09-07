/**
 * 拦截：
 *
 *   POST
 *   /phoenix2/backend/submit-score
 *
 * 请求在发送到 proxy-phoenix2.firigames.com
 * 之前直接被 Loon 中断。
 *
 * 不读取：
 *
 *   - Authorization
 *   - 请求 body
 *   - score 数据
 *
 */

(function () {
    "use strict";
    console.log(
        "[P2] submit-score blocked"
    );
    $done();
})();