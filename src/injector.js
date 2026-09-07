/**
 * Phoenix 2 Stage Tool
 * injector.js
 *
 * 职责：
 *   将一个 p2stage-raw-v1 Package 固定写入
 *   当前 LoginResponse 中 Daily 的第一个 slot（当前即 easy）。
 *
 * 已验证 baseline：
 *
 *   Normal -> Easy
 *
 * 仅迁移：
 *   field 2
 *   field 3
 *   field 14
 *
 * 保留：
 *   target field 1
 *   target 其它全部 metadata
 *
 * 已实测：
 *   - 不需要 padding
 *   - source 可以比 target 长或短
 *   - 自动重建 DailyStage wrapper length
 *   - 自动重建顶层 Daily collection length
 *   - HTTP body 长度可以变化
 *
 * 本文件不负责：
 *   - 从 persistentStore 选择 Package
 *   - Package JSON decode
 *   - UI
 */

import {
    parseFields,
    getLengthField,
    encodeVarint,
    copySlice,
    concatBytes,
    findFirstDailySlot,
    findTopLevelContainer,
    locateDailyStage
} from "./daily.js";

import {
    decodeRawPackage
} from "./package.js";


// ============================================================================
// Build target DailyStage payload
// ============================================================================

/**
 * 在 target DailyStage 中：
 *
 *   field 2  <- Package
 *   field 3  <- Package
 *   field 14 <- Package
 *
 * 其它 field 原样保留 target。
 *
 * 注意：
 * 不做 padding。
 */
function buildInjectedPayload(
    targetPayload,
    rawPackage
) {
    const targetFields =
        parseFields(
            targetPayload
        );


    let count2 = 0;
    let count3 = 0;
    let count14 = 0;


    const parts = [];


    for (
        const field of
        targetFields
    ) {
        if (
            field.fieldNo === 2 &&
            field.wire === 2
        ) {
            count2++;

            parts.push(
                encodeVarint(
                    field.tag
                )
            );

            parts.push(
                encodeVarint(
                    rawPackage
                        .field2
                        .length
                )
            );

            parts.push(
                rawPackage.field2
            );
        }


        else if (
            field.fieldNo === 3 &&
            field.wire === 2
        ) {
            count3++;

            parts.push(
                encodeVarint(
                    field.tag
                )
            );

            parts.push(
                encodeVarint(
                    rawPackage
                        .field3
                        .length
                )
            );

            parts.push(
                rawPackage.field3
            );
        }


        else if (
            field.fieldNo === 14 &&
            field.wire === 2
        ) {
            count14++;

            parts.push(
                encodeVarint(
                    field.tag
                )
            );

            parts.push(
                encodeVarint(
                    rawPackage
                        .field14
                        .length
                )
            );

            parts.push(
                rawPackage.field14
            );
        }


        else {
            parts.push(
                copySlice(
                    targetPayload,
                    field.start,
                    field.end
                )
            );
        }
    }


    if (
        count2 !== 1 ||
        count3 !== 1 ||
        count14 !== 1
    ) {
        throw new Error(
            `unexpected target structure: ` +
            `f2=${count2}, ` +
            `f3=${count3}, ` +
            `f14=${count14}`
        );
    }


    return concatBytes(parts);
}


// ============================================================================
// Injector
// ============================================================================

/**
 * 固定注入当前 Daily 第一个 slot。
 *
 * 输入：
 *
 *   responseBody: Uint8Array
 *   pkg:          p2stage-raw-v1 JSON object
 *
 * 返回：
 *
 * {
 *   body: Uint8Array,
 *   targetMissionId,
 *   sourceMissionId,
 *   oldSize,
 *   newSize
 * }
 */
export function injectToFirstDailySlot(
    responseBody,
    pkg
) {
    const rawPackage =
        decodeRawPackage(pkg);


    // ------------------------------------------------------------------------
    // 1. 找当前 Daily 第一个 slot
    // ------------------------------------------------------------------------

    const target =
        findFirstDailySlot(
            responseBody
        );


    if (!target) {
        throw new Error(
            "current Daily first slot not found"
        );
    }


    const targetPayload =
        responseBody.subarray(
            target.payloadStart,
            target.payloadEnd
        );


    // ------------------------------------------------------------------------
    // 2. 构造新的变长 DailyStage payload
    // ------------------------------------------------------------------------

    const newTargetPayload =
        buildInjectedPayload(
            targetPayload,
            rawPackage
        );


    // ------------------------------------------------------------------------
    // 3. 重建 repeated DailyStage wrapper
    //
    // <tag>
    // <new payload length>
    // <new payload>
    // ------------------------------------------------------------------------

    const newTargetWrapper =
        concatBytes([
            encodeVarint(
                target.outerTag
            ),

            encodeVarint(
                newTargetPayload.length
            ),

            newTargetPayload
        ]);


    // ------------------------------------------------------------------------
    // 4. 找包含 DailyStage 的顶层 collection
    // ------------------------------------------------------------------------

    const container =
        findTopLevelContainer(
            responseBody,
            target.outerStart,
            target.outerEnd
        );


    if (!container) {
        throw new Error(
            "top-level Daily container not found"
        );
    }


    const oldContainerPayload =
        responseBody.subarray(
            container.dataStart,
            container.dataEnd
        );


    const relativeStart =
        target.outerStart -
        container.dataStart;


    const relativeEnd =
        target.outerEnd -
        container.dataStart;


    if (
        relativeStart < 0 ||
        relativeEnd >
            oldContainerPayload.length ||
        relativeStart >=
            relativeEnd
    ) {
        throw new Error(
            "invalid target wrapper boundary"
        );
    }


    // ------------------------------------------------------------------------
    // 5. 替换 container 内部的 target wrapper
    // ------------------------------------------------------------------------

    const newContainerPayload =
        concatBytes([
            copySlice(
                oldContainerPayload,
                0,
                relativeStart
            ),

            newTargetWrapper,

            copySlice(
                oldContainerPayload,
                relativeEnd,
                oldContainerPayload.length
            )
        ]);


    // ------------------------------------------------------------------------
    // 6. 重建顶层 container field
    // ------------------------------------------------------------------------

    const newContainerField =
        concatBytes([
            encodeVarint(
                container.tag
            ),

            encodeVarint(
                newContainerPayload.length
            ),

            newContainerPayload
        ]);


    // ------------------------------------------------------------------------
    // 7. 重建整个 HTTP response body
    // ------------------------------------------------------------------------

    const finalBody =
        concatBytes([
            copySlice(
                responseBody,
                0,
                container.start
            ),

            newContainerField,

            copySlice(
                responseBody,
                container.end,
                responseBody.length
            )
        ]);


    // ------------------------------------------------------------------------
    // 8. Sanity check
    //
    // 重建后 target missionId 应仍然存在。
    // ------------------------------------------------------------------------

    const rebuiltTarget =
        locateDailyStage(
            finalBody,
            target.missionId
        );


    if (!rebuiltTarget) {
        throw new Error(
            "sanity check failed: rebuilt target not found"
        );
    }


    return {
        body:
            finalBody,

        targetMissionId:
            target.missionId,

        sourceMissionId:
            rawPackage.missionId,

        oldSize:
            responseBody.length,

        newSize:
            finalBody.length,

        oldTargetPayloadSize:
            target.payloadLength,

        newTargetPayloadSize:
            newTargetPayload.length
    };
}