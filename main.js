/**
 * Phoenix 2 Stage Tool
 * main.js
 *
 * ============================================================================
 * p2 控制
 * ============================================================================
 *
 * persistentStore key:
 *
 *   p2
 *
 *
 * 记录模式：
 *
 *   p2 = record
 *
 * 自动保存当前 LoginResponse 中的全部 DailyStage。
 *
 *
 * 历史任务复玩：
 *
 *   p2 = <rank>-<dailyId>-<slot>
 *
 * 例如：
 *
 *   commander-3902-1
 *   commander-3902-2
 *   commander-3902-3
 *
 * slot:
 *
 *   1 = easy
 *   2 = normal
 *   3 = hard
 *
 * 内部转换为：
 *
 *   commander-3902-1
 *       ↓
 *   daily-commander/easy-3902
 *
 *
 * 其它任何值：
 *
 *   - 不修改 LoginResponse
 *   - 给出简短通知
 *
 *
 * ============================================================================
 * 注意
 * ============================================================================
 *
 * submit-score 阻断不在本文件处理。
 *
 * 它由独立的：
 *
 *   src/block_submit_score.js
 *
 * 在请求发出前直接 abort。
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
    "[P2]";


const SLOT_NAMES = {
    1: "easy",
    2: "normal",
    3: "hard"
};


// ============================================================================
// Main
// ============================================================================

(function () {
    "use strict";


    // ========================================================================
    // Helpers
    // ========================================================================

    function log(text) {
        console.log(
            `${TAG} ${text}`
        );
    }


    /**
     * 通知刻意保持很短。
     *
     * iOS / Loon 通知区域较小，
     * 不把内部调试细节塞进去。
     */
    function notify(
        subtitle,
        body = ""
    ) {
        $notification.post(
            "Phoenix 2",
            subtitle,
            body
        );
    }


    function finishUnmodified() {
        $done({});
    }


    /**
     * 用户简写：
     *
     *   commander-3902-2
     *
     * 转换为：
     *
     *   daily-commander/normal-3902
     *
     *
     * 返回 null 表示格式不是一个有效的任务选择。
     */
    function parseMissionSelector(
        text
    ) {
        /**
         * rank：
         *   commander
         *   marshal
         *   ...
         *
         * 为了不把 rank 名称写死，
         * 这里只要求它由字母/数字/_ 组成。
         *
         * daily number：
         *   数字
         *
         * slot：
         *   1 / 2 / 3
         */
        const match =
            /^([a-z0-9_]+)-(\d+)-([1-3])$/i
                .exec(text);


        if (!match) {
            return null;
        }


        const rank =
            match[1].toLowerCase();

        const dailyId =
            match[2];

        const slot =
            Number(
                match[3]
            );

        const difficulty =
            SLOT_NAMES[slot];


        return {
            selector:
                text,

            rank,

            dailyId,

            slot,

            difficulty,

            missionId:
                `daily-${rank}/${difficulty}-${dailyId}`
        };
    }


    // ========================================================================
    // Read p2
    // ========================================================================

    let control =
        $persistentStore.read(
            CONTROL_KEY
        );


    if (
        typeof control !==
        "string"
    ) {
        control = "";
    }


    control =
        control.trim();


    log(
        `p2="${control}"`
    );


    // ========================================================================
    // Read response body
    //
    // 无论 record 还是 replay 都需要 LoginResponse。
    // ========================================================================

    if (
        !$response ||
        !$response.body
    ) {
        log(
            "no response body"
        );

        notify(
            "失败",
            "无 LoginResponse"
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
            "body is not binary"
        );

        notify(
            "失败",
            "binary-body-mode"
        );

        finishUnmodified();

        return;
    }


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
    // TASK SELECTOR
    // ========================================================================

    const selection =
        parseMissionSelector(
            control
        );


    /**
     * 不是 record，
     * 也不是 rank-id-slot 格式。
     *
     * 什么都不做。
     */
    if (!selection) {
        log(
            `idle / invalid control: "${control}"`
        );


        notify(
            "未执行",
            control || "p2 未设置"
        );


        finishUnmodified();

        return;
    }


    // ========================================================================
    // REPLAY
    // ========================================================================

    runReplay(
        buffer,
        selection
    );



    // ========================================================================
    // RECORD
    // ========================================================================

    function runRecord(
        responseBody
    ) {
        log(
            "RECORD"
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
                `record parse error: ` +
                e.message
            );


            notify(
                "记录失败"
            );


            finishUnmodified();

            return;
        }


        if (
            stages.length === 0
        ) {
            log(
                "no DailyStage"
            );


            notify(
                "记录失败",
                "未找到 Daily"
            );


            finishUnmodified();

            return;
        }


        let saved = 0;


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


                if (result.ok) {
                    saved++;

                    log(
                        `saved ${stage.missionId}`
                    );
                }

                else {
                    log(
                        `save failed ${stage.missionId}`
                    );
                }
            }

            catch (e) {
                log(
                    `save error ` +
                    `${stage.missionId}: ` +
                    e.message
                );
            }
        }


        notify(
            "记录完成",
            `${saved}/${stages.length} Daily`
        );


        /**
         * RECORD 不修改游戏数据。
         */
        finishUnmodified();
    }



    // ========================================================================
    // REPLAY
    // ========================================================================

    function runReplay(
        responseBody,
        selection
    ) {
        const missionId =
            selection.missionId;


        log(
            `lookup ${missionId}`
        );


        // --------------------------------------------------------------------
        // Read package
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
                `package error: ` +
                e.message
            );


            notify(
                "读取失败",
                selection.selector
            );


            finishUnmodified();

            return;
        }


        /**
         * selector 格式正确，
         * 但是对应任务没有被保存。
         */
        if (!pkg) {
            log(
                `not found: ${missionId}`
            );


            notify(
                "任务不存在",
                selection.selector
            );


            finishUnmodified();

            return;
        }


        // --------------------------------------------------------------------
        // Inject
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
                `inject error: ` +
                e.message
            );


            notify(
                "注入失败",
                selection.selector
            );


            finishUnmodified();

            return;
        }


        // --------------------------------------------------------------------
        // Rebuild headers
        // --------------------------------------------------------------------

        const headers = {};


        if ($response.headers) {
            for (
                const key in
                $response.headers
            ) {
                const lower =
                    key.toLowerCase();


                /**
                 * 新 body 长度可能不同。
                 *
                 * 旧 Content-Length / Content-Encoding
                 * 都不继续使用。
                 */
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
        // Status
        // --------------------------------------------------------------------

        log(
            `REPLAY OK`
        );


        log(
            `${result.sourceMissionId}` +
            ` -> ` +
            `${result.targetMissionId}`
        );


        log(
            `body ${result.oldSize}` +
            ` -> ` +
            `${result.newSize}`
        );


        /**
         * 给用户看的通知只显示简写。
         */
        notify(
            "任务已载入",
            selection.selector
        );


        // --------------------------------------------------------------------
        // Return modified LoginResponse
        // --------------------------------------------------------------------

        $done({
            body:
                result.body,

            headers:
                headers
        });
    }

})();