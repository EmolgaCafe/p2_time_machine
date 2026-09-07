/**
 * Phoenix 2 Stage Tool
 * main.js
 *
 * 当前版本功能：
 *
 *   /backend/login
 *        ↓
 *   找出全部 DailyStage
 *        ↓
 *   提取 field 2 / 3 / 14
 *        ↓
 *   创建 p2stage-raw-v1
 *        ↓
 *   保存到 Loon $persistentStore
 *
 * 当前是纯导出模式：
 *
 *   - 不修改 response
 *   - 不修改 request
 *   - 不联网
 *   - 不处理 Community
 *
 * Loon 运行时需要 bundle：
 *
 *   main.js
 *   daily.js
 *   package.js
 *
 * injector.js 当前不参与这个 exporter bundle。
 */

import {
    asUint8Array,
    extractAllDailyStages
} from "./src/daily.js";

import {
    createRawPackage,
    saveRawPackage
} from "./src/package.js";


(function () {
    "use strict";

    const TAG =
        "[P2-StageTool]";


    function log(message) {
        console.log(
            `${TAG} ${message}`
        );
    }


    function stop(message) {
        log(
            `❌ ${message}`
        );

        $done({});
    }


    // ========================================================================
    // Read response
    // ========================================================================

    const body =
        $response.body;


    if (!body) {
        stop(
            "没有获取到 /login response body"
        );

        return;
    }


    const buffer =
        asUint8Array(body);


    if (!buffer) {
        stop(
            "response body 不是二进制数据；" +
            "请启用 binary-body-mode=true"
        );

        return;
    }


    log(
        `扫描 LoginResponse: ` +
        `${buffer.length} bytes`
    );


    // ========================================================================
    // Extract Daily
    // ========================================================================

    let stages;


    try {
        stages =
            extractAllDailyStages(
                buffer
            );
    }

    catch (e) {
        stop(
            `Daily 提取失败: ` +
            e.message
        );

        return;
    }


    if (
        stages.length === 0
    ) {
        stop(
            "没有发现真正的 DailyStage"
        );

        return;
    }


    // ========================================================================
    // Save packages
    // ========================================================================

    const saved = [];
    const failed = [];


    for (const stage of stages) {
        try {
            const pkg =
                createRawPackage(
                    stage
                );


            const result =
                saveRawPackage(pkg);


            if (!result.ok) {
                failed.push(
                    stage.missionId
                );

                log(
                    `❌ 保存失败: ` +
                    stage.missionId
                );

                continue;
            }


            saved.push({
                missionId:
                    stage.missionId,

                luaBytes:
                    stage.field3.length,

                packageChars:
                    result.jsonLength
            });


            log(
                `✅ ${stage.missionId} | ` +
                `Lua ${stage.field3.length} B | ` +
                `package ${result.jsonLength} chars`
            );
        }

        catch (e) {
            failed.push(
                stage.missionId
            );

            log(
                `❌ ${stage.missionId}: ` +
                e.message
            );
        }
    }


    // ========================================================================
    // Result notification
    // ========================================================================

    if (
        saved.length > 0
    ) {
        const names =
            saved
                .map(
                    item =>
                        item.missionId
                )
                .join("\n");


        $notification.post(
            "Phoenix 2 Stage Tool",
            `已保存 ${saved.length} 个 DailyStage`,
            names
        );
    }


    if (
        failed.length > 0
    ) {
        log(
            `⚠️ ${failed.length} 个 DailyStage 保存失败`
        );
    }


    // 纯 extractor。
    // 原始服务器响应不做任何修改。
    $done({});
})();