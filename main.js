/**
 * Phoenix 2 Stage Tool
 * main.js
 *
 * ============================================================================
 * p2 控制方式
 * ============================================================================
 *
 * persistentStore key:
 *
 *   p2
 *
 *
 * 1. 记录当前 Daily
 *
 *   p2 = record
 *
 * 会保存当前 LoginResponse 中所有 DailyStage。
 *
 *
 * 2. 载入历史 Daily
 *
 * 格式：
 *
 *   <rank>-<dailyId>-<slot>
 *
 * 例如：
 *
 *   cadet-3902-1
 *   commander-3902-2
 *   commander-3902-3
 *
 * slot:
 *
 *   1 = easy
 *   2 = normal
 *   3 = hard
 *
 *
 * 注意：
 *
 * 本版本不会直接“猜”完整 missionId 后查 KV。
 *
 * 而是：
 *
 *   cadet-3902-1
 *        ↓
 *   搜索 p2stage.raw.index
 *        ↓
 *   找到实际保存的：
 *   daily-cadet/easy-3902
 *        ↓
 *   再读取对应 Package
 *
 * 因此 rank 不需要预定义。
 *
 *
 * 3. 其它任意值
 *
 *   不修改 LoginResponse
 *   弹一个简短通知
 *
 *
 * ============================================================================
 * submit-score 阻断
 * ============================================================================
 *
 * 不在本文件处理。
 *
 * 由独立 request script：
 *
 *   src/block_submit_score.js
 *
 * 负责。
 */


import {
    asUint8Array,
    extractAllDailyStages
} from "./src/daily.js";


import {
    createRawPackage,
    saveRawPackage,
    loadRawPackage,
    readPackageIndex
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
     * 通知尽量保持简短。
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


    /**
     * 不修改服务器 response。
     */
    function finishUnmodified() {
        $done({});
    }


    // ========================================================================
    // 用户输入解析
    // ========================================================================

    /**
     * 用户简写：
     *
     *   cadet-3902-1
     *
     * 解析为：
     *
     * {
     *   rank: "cadet",
     *   dailyId: "3902",
     *   slot: 1,
     *   difficulty: "easy"
     * }
     *
     * rank 不写死。
     */
    function parseMissionSelector(
        text
    ) {
        const match =
            /^([a-z0-9_]+)-(\d+)-([1-3])$/i
                .exec(text);


        if (!match) {
            return null;
        }


        const rank =
            match[1]
                .toLowerCase();

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

            difficulty
        };
    }


    /**
     * 从实际保存的 index 中寻找对应任务。
     *
     * 例如：
     *
     * 用户：
     *
     *   cadet-3902-1
     *
     * index：
     *
     *   daily-cadet/easy-3902
     *
     * 返回：
     *
     *   daily-cadet/easy-3902
     *
     *
     * 这样实际保存的数据是唯一 source of truth。
     */
    function resolveSavedMission(
        selection
    ) {
        let index;


        try {
            index =
                readPackageIndex();
        }

        catch (e) {
            log(
                `index read error: ` +
                e.message
            );

            return null;
        }


        const expectedRank =
            selection.rank
                .toLowerCase();

        const expectedDifficulty =
            selection.difficulty
                .toLowerCase();

        const expectedDailyId =
            String(
                selection.dailyId
            );


        for (
            const missionId of index
        ) {
            /**
             * 当前实际 Daily missionId 格式：
             *
             *   daily-cadet/easy-3902
             *   daily-commander/normal-3902
             *
             * rank 不限制具体名字。
             */
            const match =
                /^daily-([^/]+)\/(easy|normal|hard)-(\d+)$/i
                    .exec(
                        missionId
                    );


            if (!match) {
                continue;
            }


            const rank =
                match[1]
                    .toLowerCase();

            const difficulty =
                match[2]
                    .toLowerCase();

            const dailyId =
                match[3];


            if (
                rank ===
                    expectedRank &&
                difficulty ===
                    expectedDifficulty &&
                dailyId ===
                    expectedDailyId
            ) {
                /**
                 * 返回 index 中真实保存的 missionId。
                 */
                return missionId;
            }
        }


        return null;
    }


    // ========================================================================
    // Read p2 control
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
    // Read LoginResponse
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
    // Parse task selector
    // ========================================================================

    const selection =
        parseMissionSelector(
            control
        );


    /**
     * 既不是 record，
     * 也不是：
     *
     *   rank-id-slot
     *
     * 那就什么都不做。
     */
    if (!selection) {
        log(
            `invalid control: "${control}"`
        );


        notify(
            "未执行",
            control || "p2 无效"
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
    // RECORD implementation
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


                if (
                    result.ok
                ) {
                    saved++;


                    log(
                        `saved ` +
                        stage.missionId
                    );
                }

                else {
                    log(
                        `save failed ` +
                        stage.missionId
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
         * Record 模式只保存。
         * 不修改当前 LoginResponse。
         */
        finishUnmodified();
    }



    // ========================================================================
    // REPLAY implementation
    // ========================================================================

    function runReplay(
        responseBody,
        selection
    ) {
        // --------------------------------------------------------------------
        // 1. 从 index 中寻找实际保存的 missionId
        // --------------------------------------------------------------------

        const missionId =
            resolveSavedMission(
                selection
            );


        if (!missionId) {
            log(
                `not found: ` +
                selection.selector
            );


            notify(
                "任务不存在",
                selection.selector
            );


            finishUnmodified();

            return;
        }


        log(
            `resolved ` +
            `${selection.selector}` +
            ` -> ` +
            `${missionId}`
        );


        // --------------------------------------------------------------------
        // 2. 读取 Package
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
         * 理论上 index 里找到以后应该一定存在，
         * 但还是保留这个检查，防止 index / KV 不一致。
         */
        if (!pkg) {
            log(
                `package missing: ` +
                missionId
            );


            notify(
                "任务不存在",
                selection.selector
            );


            finishUnmodified();

            return;
        }


        // --------------------------------------------------------------------
        // 3. Inject
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
        // 4. Rebuild HTTP headers
        // --------------------------------------------------------------------

        const headers = {};


        if (
            $response.headers
        ) {
            for (
                const key in
                $response.headers
            ) {
                const lower =
                    key.toLowerCase();


                /**
                 * 新 body 长度可能发生变化。
                 *
                 * 因此：
                 *
                 *   删除旧 Content-Length
                 *   删除旧 Content-Encoding
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


        headers[
            "Content-Length"
        ] =
            String(
                result.body.length
            );


        // --------------------------------------------------------------------
        // 5. Log
        // --------------------------------------------------------------------

        log(
            "REPLAY OK"
        );


        log(
            `${result.sourceMissionId}` +
            ` -> ` +
            `${result.targetMissionId}`
        );


        log(
            `body ` +
            `${result.oldSize}` +
            ` -> ` +
            `${result.newSize}`
        );


        // --------------------------------------------------------------------
        // 6. Notification
        // --------------------------------------------------------------------

        notify(
            "任务已载入",
            selection.selector
        );


        // --------------------------------------------------------------------
        // 7. Return modified LoginResponse
        // --------------------------------------------------------------------

        $done({
            body:
                result.body,

            headers:
                headers
        });
    }

})();