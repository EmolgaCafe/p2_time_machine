/**
 * Phoenix 2 Stage Tool
 * daily.js
 *
 * 职责：
 *   - 最小 protobuf 二进制工具
 *   - 从 /backend/login 响应发现所有 DailyStage
 *   - 提取 DailyStage 中已经验证可移植的字段
 *
 * 当前只处理 Daily，不处理 Community。
 *
 * 已验证的可移植字段：
 *   field 2  = stage ID
 *   field 3  = generated Lua stage
 *   field 14 = title/display metadata
 *
 * 本文件不负责：
 *   - persistentStore
 *   - Package JSON
 *   - 注入
 *   - Lua 语义解析
 */

export const MIN_LUA_SIZE = 10000;


// ============================================================================
// Binary helpers
// ============================================================================

export function asUint8Array(body) {
    if (body instanceof Uint8Array) {
        return body;
    }

    if (body instanceof ArrayBuffer) {
        return new Uint8Array(body);
    }

    if (
        body &&
        body.buffer instanceof ArrayBuffer
    ) {
        const offset =
            body.byteOffset || 0;

        const length =
            body.byteLength ||
            (
                body.buffer.byteLength -
                offset
            );

        return new Uint8Array(
            body.buffer,
            offset,
            length
        );
    }

    return null;
}


export function cloneUint8Array(bytes) {
    const out =
        new Uint8Array(
            bytes.length
        );

    out.set(bytes);

    return out;
}


export function asciiBytes(text) {
    const out =
        new Uint8Array(
            text.length
        );

    for (
        let i = 0;
        i < text.length;
        i++
    ) {
        const c =
            text.charCodeAt(i);

        if (c > 0x7f) {
            throw new Error(
                "asciiBytes received non-ASCII text"
            );
        }

        out[i] = c;
    }

    return out;
}


export function asciiString(bytes) {
    let out = "";

    for (
        let i = 0;
        i < bytes.length;
        i++
    ) {
        out +=
            String.fromCharCode(
                bytes[i]
            );
    }

    return out;
}


export function findBytes(
    buffer,
    needle,
    from = 0
) {
    outer:
    for (
        let i = from;
        i <=
            buffer.length -
            needle.length;
        i++
    ) {
        for (
            let j = 0;
            j < needle.length;
            j++
        ) {
            if (
                buffer[i + j] !==
                needle[j]
            ) {
                continue outer;
            }
        }

        return i;
    }

    return -1;
}


export function copySlice(
    buffer,
    start,
    end
) {
    const out =
        new Uint8Array(
            end - start
        );

    out.set(
        buffer.subarray(
            start,
            end
        )
    );

    return out;
}


export function concatBytes(parts) {
    let total = 0;

    for (const part of parts) {
        total += part.length;
    }

    const out =
        new Uint8Array(total);

    let offset = 0;

    for (const part of parts) {
        out.set(
            part,
            offset
        );

        offset +=
            part.length;
    }

    return out;
}


// ============================================================================
// Minimal protobuf helpers
// ============================================================================

/**
 * 读取 protobuf varint。
 *
 * 当前 LoginResponse 中涉及的长度都远低于 JS safe integer 上限，
 * 因此这里使用 Number 即可。
 */
export function readVarint(
    buffer,
    pos,
    limit = buffer.length
) {
    let value = 0;
    let shift = 0;

    while (
        pos < limit &&
        shift <= 49
    ) {
        const b =
            buffer[pos++];

        value +=
            (b & 0x7f) *
            Math.pow(
                2,
                shift
            );

        if (
            (b & 0x80) === 0
        ) {
            return {
                value,
                next: pos
            };
        }

        shift += 7;
    }

    return null;
}


export function encodeVarint(value) {
    if (
        !Number.isSafeInteger(value) ||
        value < 0
    ) {
        throw new Error(
            `invalid varint value: ${value}`
        );
    }

    const out = [];

    do {
        let b =
            value % 128;

        value =
            Math.floor(
                value / 128
            );

        if (value > 0) {
            b |= 0x80;
        }

        out.push(b);

    } while (
        value > 0
    );

    return new Uint8Array(out);
}


/**
 * 解析一个 protobuf message 的一级字段边界。
 *
 * 当前只需要支持：
 *   wire 0 = varint
 *   wire 1 = fixed64
 *   wire 2 = length-delimited
 *   wire 5 = fixed32
 */
export function parseFields(message) {
    const fields = [];

    let pos = 0;

    while (
        pos < message.length
    ) {
        const start = pos;

        const tagInfo =
            readVarint(
                message,
                pos
            );

        if (!tagInfo) {
            throw new Error(
                `bad protobuf tag @ ${pos}`
            );
        }

        const tag =
            tagInfo.value;

        const fieldNo =
            Math.floor(
                tag / 8
            );

        const wire =
            tag & 7;

        pos =
            tagInfo.next;

        const field = {
            start,
            end: null,

            tag,
            fieldNo,
            wire,

            dataStart: null,
            dataEnd: null,

            length: null,
            value: null
        };


        if (wire === 0) {
            const valueInfo =
                readVarint(
                    message,
                    pos
                );

            if (!valueInfo) {
                throw new Error(
                    `bad varint field ${fieldNo}`
                );
            }

            field.value =
                valueInfo.value;

            pos =
                valueInfo.next;
        }

        else if (wire === 1) {
            pos += 8;
        }

        else if (wire === 2) {
            const lengthInfo =
                readVarint(
                    message,
                    pos
                );

            if (!lengthInfo) {
                throw new Error(
                    `bad length field ${fieldNo}`
                );
            }

            pos =
                lengthInfo.next;

            field.length =
                lengthInfo.value;

            field.dataStart =
                pos;

            field.dataEnd =
                pos +
                field.length;

            pos =
                field.dataEnd;
        }

        else if (wire === 5) {
            pos += 4;
        }

        else {
            throw new Error(
                `unsupported protobuf wire type ${wire}`
            );
        }


        if (
            pos >
            message.length
        ) {
            throw new Error(
                `field ${fieldNo} exceeds message boundary`
            );
        }

        field.end = pos;

        fields.push(field);
    }

    return fields;
}


export function getLengthField(
    message,
    fields,
    fieldNo
) {
    for (const field of fields) {
        if (
            field.fieldNo === fieldNo &&
            field.wire === 2
        ) {
            return {
                field,

                data:
                    message.subarray(
                        field.dataStart,
                        field.dataEnd
                    ),

                raw:
                    message.subarray(
                        field.start,
                        field.end
                    )
            };
        }
    }

    return null;
}


// ============================================================================
// DailyStage discovery
// ============================================================================

/**
 * LoginResponse 中同一个 missionId 会出现不止一次。
 *
 * 例如：
 *   daily-commander/easy-3901
 *
 * 既可能出现在小型 metadata/index record 中，
 * 也会出现在真正包含几十 KB Lua 的 DailyStage 中。
 *
 * 所以这里不能只靠字符串定位。
 *
 * 一个真正 DailyStage 当前要求：
 *
 *   field 1  == missionId
 *   field 2  == "stage.*"
 *   field 3  > MIN_LUA_SIZE
 *   field 3  包含 "load_stage({"
 *   field 14 存在
 */
export function locateDailyStage(
    buffer,
    missionId
) {
    const idBytes =
        asciiBytes(
            missionId
        );

    let searchFrom = 0;

    const candidates = [];


    while (true) {
        const idPos =
            findBytes(
                buffer,
                idBytes,
                searchFrom
            );

        if (idPos < 0) {
            break;
        }

        searchFrom =
            idPos + 1;


        // --------------------------------------------------------------------
        // 找 DailyStage payload 起点。
        //
        // field 1:
        //
        //   0A <length> "daily-..."
        // --------------------------------------------------------------------

        let payloadStart = -1;

        for (
            let p =
                Math.max(
                    0,
                    idPos - 6
                );

            p < idPos;

            p++
        ) {
            if (
                buffer[p] !==
                0x0a
            ) {
                continue;
            }

            const lengthInfo =
                readVarint(
                    buffer,
                    p + 1,
                    idPos
                );

            if (
                lengthInfo &&
                lengthInfo.next ===
                    idPos &&
                lengthInfo.value ===
                    idBytes.length
            ) {
                payloadStart = p;
                break;
            }
        }


        if (payloadStart < 0) {
            continue;
        }


        // --------------------------------------------------------------------
        // 找包住整个 DailyStage 的 repeated-message wrapper。
        // --------------------------------------------------------------------

        let outerStart = -1;
        let outerTag = -1;
        let payloadLength = -1;


        for (
            let p =
                Math.max(
                    0,
                    payloadStart - 8
                );

            p < payloadStart;

            p++
        ) {
            const tagInfo =
                readVarint(
                    buffer,
                    p,
                    payloadStart
                );

            if (
                !tagInfo ||
                (
                    tagInfo.value &
                    7
                ) !== 2
            ) {
                continue;
            }

            const lengthInfo =
                readVarint(
                    buffer,
                    tagInfo.next,
                    payloadStart
                );

            if (
                !lengthInfo ||
                lengthInfo.next !==
                    payloadStart
            ) {
                continue;
            }

            if (
                payloadStart +
                    lengthInfo.value >
                buffer.length
            ) {
                continue;
            }

            outerStart = p;
            outerTag =
                tagInfo.value;

            payloadLength =
                lengthInfo.value;
        }


        if (outerStart < 0) {
            continue;
        }


        const payloadEnd =
            payloadStart +
            payloadLength;

        const payload =
            buffer.subarray(
                payloadStart,
                payloadEnd
            );


        try {
            const fields =
                parseFields(payload);

            const f1 =
                getLengthField(
                    payload,
                    fields,
                    1
                );

            const f2 =
                getLengthField(
                    payload,
                    fields,
                    2
                );

            const f3 =
                getLengthField(
                    payload,
                    fields,
                    3
                );

            const f14 =
                getLengthField(
                    payload,
                    fields,
                    14
                );


            if (
                !f1 ||
                !f2 ||
                !f3 ||
                !f14
            ) {
                continue;
            }


            if (
                asciiString(
                    f1.data
                ) !==
                missionId
            ) {
                continue;
            }


            const stageId =
                asciiString(
                    f2.data
                );


            if (
                !stageId.startsWith(
                    "stage."
                )
            ) {
                continue;
            }


            if (
                f3.data.length <
                MIN_LUA_SIZE
            ) {
                continue;
            }


            if (
                findBytes(
                    f3.data,
                    asciiBytes(
                        "load_stage({"
                    ),
                    0
                ) < 0
            ) {
                continue;
            }


            candidates.push({
                missionId,

                outerStart,
                outerTag,
                outerEnd:
                    payloadEnd,

                payloadStart,
                payloadEnd,
                payloadLength,

                stageId,
                luaLength:
                    f3.data.length,

                field2:
                    f2.data,

                field3:
                    f3.data,

                field14:
                    f14.data
            });
        }

        catch (e) {
            // 同名字符串不属于真正 DailyStage。
        }
    }


    if (
        candidates.length === 0
    ) {
        return null;
    }


    // 理论上应该只有一个真正 DailyStage。
    // 如果以后协议中出现重复版本，则优先选择 Lua 最大的那个。
    candidates.sort(
        (a, b) =>
            b.luaLength -
            a.luaLength
    );

    return candidates[0];
}


/**
 * 先扫描 response 中所有 daily-* 字符串作为候选 missionId。
 *
 * 这些候选随后还会经过 locateDailyStage() 严格验证，
 * 所以不会把普通 metadata 字符串误当成真正关卡。
 */
export function discoverDailyMissionIds(
    buffer
) {
    const prefix =
        asciiBytes(
            "daily-"
        );

    const seen = {};

    let from = 0;


    while (true) {
        const start =
            findBytes(
                buffer,
                prefix,
                from
            );

        if (start < 0) {
            break;
        }

        from =
            start +
            prefix.length;

        let end = start;


        // 当前已观察到的 Daily ID：
        //
        // daily-commander/easy-3901
        //
        // 允许：
        // A-Z a-z 0-9 - _ / + .
        while (
            end <
            buffer.length
        ) {
            const c =
                buffer[end];

            const digit =
                c >= 48 &&
                c <= 57;

            const upper =
                c >= 65 &&
                c <= 90;

            const lower =
                c >= 97 &&
                c <= 122;

            const punctuation =
                c === 45 ||  // -
                c === 95 ||  // _
                c === 47 ||  // /
                c === 43 ||  // +
                c === 46;    // .


            if (
                !(
                    digit ||
                    upper ||
                    lower ||
                    punctuation
                )
            ) {
                break;
            }

            end++;
        }


        if (end > start) {
            const missionId =
                asciiString(
                    buffer.subarray(
                        start,
                        end
                    )
                );

            seen[missionId] = true;
        }
    }


    return Object.keys(seen);
}


/**
 * 一次找出当前 LoginResponse 中所有真正 DailyStage。
 *
 * 返回：
 *
 * [
 *   {
 *     missionId,
 *     field2,
 *     field3,
 *     field14,
 *     ...
 *   }
 * ]
 */
export function extractAllDailyStages(
    buffer
) {
    const ids =
        discoverDailyMissionIds(
            buffer
        );

    const stages = [];


    for (const missionId of ids) {
        const stage =
            locateDailyStage(
                buffer,
                missionId
            );

        if (stage) {
            stages.push(stage);
        }
    }


    // 仅为了日志和持久化索引稳定。
    stages.sort(
        (a, b) =>
            a.missionId.localeCompare(
                b.missionId
            )
    );

    return stages;
}


/**
 * 当前默认注入目标：
 * Daily 的第一个 slot。
 *
 * 目前观察到就是 difficulty = easy。
 *
 * 为避免引入额外 rank / number 数据结构，
 * 这里直接从已发现 Daily 中选择 missionId 包含 "/easy-" 的记录。
 */
export function findFirstDailySlot(
    buffer
) {
    const stages =
        extractAllDailyStages(
            buffer
        );

    for (const stage of stages) {
        if (
            stage.missionId.includes(
                "/easy-"
            )
        ) {
            return stage;
        }
    }

    return null;
}


// ============================================================================
// Top-level protobuf container
// ============================================================================

/**
 * 找到包含某个 DailyStage wrapper 的顶层 length-delimited protobuf field。
 *
 * 当前已经实测：
 * DailyStage 集合位于 LoginResponse 的一个顶层 length-delimited field 中。
 *
 * Injector 改变 DailyStage 长度后，需要同步重建这一层长度。
 */
export function findTopLevelContainer(
    buffer,
    childStart,
    childEnd
) {
    let pos = 0;


    while (
        pos < buffer.length
    ) {
        const start = pos;

        const tagInfo =
            readVarint(
                buffer,
                pos
            );

        if (!tagInfo) {
            throw new Error(
                `bad root tag @${pos}`
            );
        }


        const tag =
            tagInfo.value;

        const wire =
            tag & 7;

        pos =
            tagInfo.next;


        let dataStart = null;
        let dataEnd = null;


        if (wire === 0) {
            const valueInfo =
                readVarint(
                    buffer,
                    pos
                );

            if (!valueInfo) {
                throw new Error(
                    "bad root varint"
                );
            }

            pos =
                valueInfo.next;
        }

        else if (wire === 1) {
            pos += 8;
        }

        else if (wire === 2) {
            const lengthInfo =
                readVarint(
                    buffer,
                    pos
                );

            if (!lengthInfo) {
                throw new Error(
                    "bad root length"
                );
            }

            dataStart =
                lengthInfo.next;

            dataEnd =
                dataStart +
                lengthInfo.value;

            pos =
                dataEnd;
        }

        else if (wire === 5) {
            pos += 4;
        }

        else {
            throw new Error(
                `unsupported root wire ${wire}`
            );
        }


        if (
            pos >
            buffer.length
        ) {
            throw new Error(
                "root field exceeds response"
            );
        }


        if (
            wire === 2 &&
            dataStart <=
                childStart &&
            dataEnd >=
                childEnd
        ) {
            return {
                start,
                end: pos,

                tag,

                dataStart,
                dataEnd
            };
        }
    }


    return null;
}