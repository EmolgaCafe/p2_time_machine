/**
 * Phoenix 2 Stage Tool
 * main.js
 *
 * ============================================================================
 * 核心控制方式
 * ============================================================================
 *
 * Loon persistentStore 中使用一个固定 KV：
 *
 *   key:
 *       p2
 *
 * 这个值决定当前脚本行为。
 *
 *
 * ----------------------------------------------------------------------------
 * 1. Record mode
 * ----------------------------------------------------------------------------
 *
 * p2 = record
 *
 * 行为：
 *
 *   当前 /backend/login
 *       ↓
 *   提取所有 DailyStage
 *       ↓
 *   保存 field 2 / 3 / 14
 *       ↓
 *   写入 persistentStore 历史库
 *
 *
 * ----------------------------------------------------------------------------
 * 2. Replay / Inject mode
 * ----------------------------------------------------------------------------
 *
 * p2 = 某个已保存的 missionId
 *
 * 例如：
 *
 *   p2 = daily-commander/normal-3902
 *
 * 行为：
 *
 *   persistentStore
 *       ↓
 *   查找这个历史 StagePackage
 *       ↓
 *   固定注入当前 Daily 第一个 slot
 *
 *
 * ----------------------------------------------------------------------------
 * 3. Idle mode
 * ----------------------------------------------------------------------------
 *
 * p2 =
 *
 * 或者 p2 key 不存在。
 *
 * 行为：
 *
 *   什么都不修改。
 *
 *
 * ----------------------------------------------------------------------------
 * 4. Unknown missionId
 * ----------------------------------------------------------------------------
 *
 * 如果 p2 既不是 record，
 * 又找不到对应历史 missionId：
 *
 *   不修改 response
 *   弹通知说明任务未找到
 *
 *
 * ============================================================================
 * 设计原则
 * ============================================================================
 *
 * p2 是整个工具唯一的用户控制入口。
 *
 * 不需要：
 *
 *   - 修改 main.js
 *   - 修改 MODE
 *   - 重新 build
 *
 * 只修改 Loon KV 中的 p2 即可切换状态。
 */


import {
    asUint8Array,
    extractAllDailyStages
} from "./src/daily.js";


import {
    createRawPackage,
    saveRawPackage,
    loadRawPackage
} from "./src/package.js";


import {
    injectToFirstDailySlot
} from "./src/injector.js";


// ============================================================================
// Constants
// ============================================================================

const CONTROL_KEY =
    "p2";

const RECORD_COMMAND =
    "record";

const TAG =
    "[P2-StageTool]";


// ============================================================================
// Main
// ============================================================================

(function () {
    "use strict";


    // ========================================================================
    // Small helpers
    // ========================================================================

    function log(message) {
        console.log(
            `${TAG} ${message}`
        );
    }


    function notify(
        subtitle,
        body = ""
    ) {
        $notification.post(
            "Phoenix 2 Stage Tool",
            subtitle,
            body
        );
    }


    /**
     * 不修改服务器 response。
     */
    function finishUnmodified() {
        $done({});
    }


    // ========================================================================
    // Read control register
    // ========================================================================

    let control =
        $persistentStore.read(
            CONTROL_KEY
        );


    /**
     * persistentStore 返回 string。
     *
     * trim()：
     * 避免手工编辑 KV 时因为前后空格导致识别失败。
     */
    if (
        typeof control ===
        "string"
    ) {
        control =
            control.trim();
    }

    else {
        control = "";
    }


    // ========================================================================
    // Idle
    // ========================================================================

    if (!control) {
        log(
            "IDLE: p2 为空"
        );


        notify(
            "空闲状态",
            "p2 为空，本次不记录、不注入"
        );


        finishUnmodified();

        return;
    }


    // ========================================================================
    // Read binary response
    // ========================================================================

    if (
        !$response ||
        !$response.body
    ) {
        log(
            "❌ 没有获取到 response body"
        );


        notify(
            "执行失败",
            "没有获取到 LoginResponse"
        );


        finishUnmodified();

        return;
    }


    const buffer =
        asUint8Array(
            $response.body
        );


    if (!buffer) {
        log(
            "❌ response body 不是二进制数据"
        );


        notify(
            "执行失败",
            "请确认 binary-body-mode=true"
        );


        finishUnmodified();

        return;
    }


    log(
        `control="${control}", ` +
        `LoginResponse=${buffer.length} B`
    );


    // ========================================================================
    // RECORD
    // ========================================================================

    if (
        control.toLowerCase() ===
        RECORD_COMMAND
    ) {
        runRecord(
            buffer
        );

        return;
    }


    // ========================================================================
    // REPLAY / INJECT
    //
    // 除 record 外，其它非空值全部按照 missionId 查询。
    // ========================================================================

    runReplay(
        buffer,
        control
    );



    // ========================================================================
    // RECORD implementation
    // ========================================================================

    function runRecord(
        responseBody
    ) {
        log(
            "MODE=RECORD"
        );


        let stages;


        try {
            stages =
                extractAllDailyStages(
                    responseBody
                );
        }

        catch (e) {
            log(
                `❌ Daily 提取失败: ` +
                e.message
            );


            notify(
                "记录失败",
                e.message
            );


            finishUnmodified();

            return;
        }


        if (
            stages.length === 0
        ) {
            log(
                "❌ 没有发现 DailyStage"
            );


            notify(
                "记录失败",
                "LoginResponse 中没有找到 DailyStage"
            );


            finishUnmodified();

            return;
        }


        const saved = [];
        const failed = [];


        // --------------------------------------------------------------------
        // 保存当天所有 DailyStage
        // --------------------------------------------------------------------

        for (
            const stage of stages
        ) {
            try {
                const pkg =
                    createRawPackage(
                        stage
                    );


                const result =
                    saveRawPackage(
                        pkg
                    );


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


                saved.push(
                    stage.missionId
                );


                log(
                    `✅ RECORD ` +
                    `${stage.missionId}` +
                    ` | Lua ` +
                    `${stage.field3.length} B`
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


        // --------------------------------------------------------------------
        // Notification
        // --------------------------------------------------------------------

        if (
            saved.length > 0
        ) {
            let body =
                saved.join("\n");


            if (
                failed.length > 0
            ) {
                body +=
                    `\n\n失败 ${failed.length} 个`;
            }


            notify(
                `RECORD：已保存 ${saved.length} 个 Daily`,
                body
            );
        }

        else {
            notify(
                "RECORD：没有保存成功",
                `失败 ${failed.length} 个任务`
            );
        }


        /**
         * RECORD 是纯读取 / 存储。
         *
         * 不修改游戏收到的 LoginResponse。
         */
        finishUnmodified();
    }



    // ========================================================================
    // REPLAY implementation
    // ========================================================================

    function runReplay(
        responseBody,
        missionId
    ) {
        log(
            `MODE=REPLAY: ${missionId}`
        );


        // --------------------------------------------------------------------
        // 1. 从历史库读取指定 Package
        // --------------------------------------------------------------------

        let pkg;


        try {
            pkg =
                loadRawPackage(
                    missionId
                );
        }

        catch (e) {
            log(
                `❌ Package 读取异常: ` +
                e.message
            );


            notify(
                "任务读取失败",
                `${missionId}\n${e.message}`
            );


            finishUnmodified();

            return;
        }


        // --------------------------------------------------------------------
        // 找不到：
        //
        // 安全行为 = 什么都不修改。
        // --------------------------------------------------------------------

        if (!pkg) {
            log(
                `⚠️ 未找到历史任务: ` +
                missionId
            );


            notify(
                "未找到历史任务",
                `${missionId}\n本次不修改 Daily`
            );


            finishUnmodified();

            return;
        }


        log(
            `✅ 找到 Package: ` +
            pkg.missionId
        );


        // --------------------------------------------------------------------
        // 2. 注入当前 Daily 第一个 slot
        // --------------------------------------------------------------------

        let result;


        try {
            result =
                injectToFirstDailySlot(
                    responseBody,
                    pkg
                );
        }

        catch (e) {
            log(
                `❌ 注入失败: ` +
                e.message
            );


            notify(
                "注入失败",
                `${missionId}\n${e.message}`
            );


            finishUnmodified();

            return;
        }


        // --------------------------------------------------------------------
        // 3. HTTP headers
        //
        // protobuf body 长度可能变化，所以旧 Content-Length 不可继续使用。
        //
        // 同时移除 Content-Encoding，确保返回的是当前 raw body。
        // --------------------------------------------------------------------

        const headers = {};


        if ($response.headers) {
            for (
                const key in
                $response.headers
            ) {
                const lower =
                    key.toLowerCase();


                if (
                    lower ===
                    "content-length" ||
                    lower ===
                    "content-encoding"
                ) {
                    continue;
                }


                headers[key] =
                    $response.headers[key];
            }
        }


        headers["Content-Length"] =
            String(
                result.body.length
            );


        // --------------------------------------------------------------------
        // 4. Status
        // --------------------------------------------------------------------

        log(
            `✅ REPLAY SUCCESS`
        );


        log(
            `source: ` +
            result.sourceMissionId
        );


        log(
            `target: ` +
            result.targetMissionId
        );


        log(
            `DailyStage: ` +
            `${result.oldTargetPayloadSize}` +
            ` -> ` +
            `${result.newTargetPayloadSize}`
        );


        log(
            `HTTP body: ` +
            `${result.oldSize}` +
            ` -> ` +
            `${result.newSize}`
        );


        notify(
            "REPLAY：注入成功",
            (
                `${result.sourceMissionId}` +
                `\n↓\n` +
                `${result.targetMissionId}`
            )
        );


        // --------------------------------------------------------------------
        // 5. Return modified response
        // --------------------------------------------------------------------

        $done({
            body:
                result.body,

            headers:
                headers
        });
    }

})();