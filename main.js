/**
 * Phoenix 2 Stage Tool
 * block_submit_score.js
 *
 * 安全保护：
 *
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
 * 不向服务器发送替代请求。
 *
 *
 * Loon Request Script：
 *
 *   $done()
 *
 * 表示直接中断当前请求。
 */


(function () {
    "use strict";


    console.log(
        "[P2] submit-score blocked"
    );


    /**
     * 注意：
     *
     * 这里不是：
     *
     *   $done({})
     *
     * 因为 $done({}) = 原请求继续发送。
     *
     * 裸 $done() = abort request。
     */
    $done();

})();