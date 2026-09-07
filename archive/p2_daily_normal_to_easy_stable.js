/**
 * Phoenix 2 Daily Stage Injector - Experiment 1
 *
 * 目标：
 * 将当天 Commander Normal DailyStage 完整复制到 Easy 槽位，
 * 验证 DailyStage 是否可以独立替换。
 *
 * 仅修改本地收到的 response：
 * - 不发起额外网络请求
 * - 不上传任何数据
 * - 不修改 request
 * - 不修改 Normal / Hard 原始记录
 * - 保持 Easy record 长度不变
 */

(function () {
    const PREFIX = "[P2-DailyHack]";

    function log(msg) {
        console.log(`${PREFIX} ${msg}`);
    }

    function fail(msg) {
        log(`❌ ${msg}`);
        $done({});
    }

    // ============================================================
    // Binary helpers
    // ============================================================

    function cloneBodyAsUint8Array(body) {
        if (body instanceof Uint8Array) {
            const out = new Uint8Array(body.byteLength);
            out.set(body);
            return out;
        }

        if (body instanceof ArrayBuffer) {
            return new Uint8Array(body.slice(0));
        }

        if (body && body.buffer instanceof ArrayBuffer) {
            const offset = body.byteOffset || 0;
            const length =
                body.byteLength ||
                (body.buffer.byteLength - offset);

            const src = new Uint8Array(
                body.buffer,
                offset,
                length
            );

            const out = new Uint8Array(src.length);
            out.set(src);
            return out;
        }

        return null;
    }

    function asciiBytes(str) {
        const out = new Uint8Array(str.length);

        for (let i = 0; i < str.length; i++) {
            const c = str.charCodeAt(i);

            if (c > 0x7f) {
                throw new Error("Non-ASCII string");
            }

            out[i] = c;
        }

        return out;
    }

    function asciiString(bytes) {
        let s = "";

        for (let i = 0; i < bytes.length; i++) {
            s += String.fromCharCode(bytes[i]);
        }

        return s;
    }

    function findBytes(buf, needle, from) {
        from = from || 0;

        outer:
        for (
            let i = from;
            i <= buf.length - needle.length;
            i++
        ) {
            for (let j = 0; j < needle.length; j++) {
                if (buf[i + j] !== needle[j]) {
                    continue outer;
                }
            }

            return i;
        }

        return -1;
    }

    function sliceCopy(buf, start, end) {
        const out = new Uint8Array(end - start);
        out.set(buf.subarray(start, end));
        return out;
    }

    function concat(parts) {
        let total = 0;

        for (const p of parts) {
            total += p.length;
        }

        const out = new Uint8Array(total);

        let offset = 0;

        for (const p of parts) {
            out.set(p, offset);
            offset += p.length;
        }

        return out;
    }

    // ============================================================
    // Protobuf varint
    // ============================================================

    function readVarint(buf, pos, limit) {
        limit =
            limit === undefined
                ? buf.length
                : limit;

        let value = 0;
        let shift = 0;
        const start = pos;

        while (
            pos < limit &&
            shift <= 49
        ) {
            const b = buf[pos++];

            value +=
                (b & 0x7f) *
                Math.pow(2, shift);

            if ((b & 0x80) === 0) {
                return {
                    value,
                    next: pos,
                    size: pos - start
                };
            }

            shift += 7;
        }

        return null;
    }

    function encodeVarint(value) {
        if (
            !Number.isSafeInteger(value) ||
            value < 0
        ) {
            throw new Error(
                `Invalid varint: ${value}`
            );
        }

        const arr = [];

        do {
            let b = value % 128;

            value =
                Math.floor(value / 128);

            if (value > 0) {
                b |= 0x80;
            }

            arr.push(b);

        } while (value > 0);

        return new Uint8Array(arr);
    }

    // ============================================================
    // Generic protobuf field parser
    // ============================================================

    function parseFields(message) {
        const fields = [];

        let pos = 0;

        while (pos < message.length) {
            const start = pos;

            const tagInfo =
                readVarint(message, pos);

            if (!tagInfo) {
                throw new Error(
                    `Bad protobuf tag at ${pos}`
                );
            }

            const tag = tagInfo.value;
            const fieldNo =
                Math.floor(tag / 8);

            const wire = tag & 7;

            pos = tagInfo.next;

            const field = {
                start,
                tag,
                fieldNo,
                wire,
                dataStart: null,
                dataEnd: null,
                end: null
            };

            if (wire === 0) {

                const v =
                    readVarint(message, pos);

                if (!v) {
                    throw new Error(
                        `Bad varint field ${fieldNo}`
                    );
                }

                pos = v.next;

            } else if (wire === 1) {

                pos += 8;

            } else if (wire === 2) {

                const lenInfo =
                    readVarint(message, pos);

                if (!lenInfo) {
                    throw new Error(
                        `Bad length field ${fieldNo}`
                    );
                }

                pos = lenInfo.next;

                field.length =
                    lenInfo.value;

                field.dataStart =
                    pos;

                field.dataEnd =
                    pos + field.length;

                pos =
                    field.dataEnd;

            } else if (wire === 5) {

                pos += 4;

            } else {

                throw new Error(
                    `Unsupported wire type ${wire}`
                );
            }

            if (pos > message.length) {
                throw new Error(
                    `Field ${fieldNo} exceeds record`
                );
            }

            field.end = pos;

            fields.push(field);
        }

        return fields;
    }

    function getLengthDelimitedField(
        message,
        fields,
        fieldNo
    ) {
        for (const f of fields) {

            if (
                f.fieldNo === fieldNo &&
                f.wire === 2
            ) {
                return message.subarray(
                    f.dataStart,
                    f.dataEnd
                );
            }
        }

        return null;
    }

    // ============================================================
    // DailyStage locator
    //
    // 注意：
    // 同一个 daily identifier 在 Login 包里会出现不止一次。
    //
    // 真正需要的是：
    //
    // field1 = daily-commander/...
    // field2 = stage.xxxxx
    // field3 = 大段 Lua
    //
    // 不是前面的 ~200 byte 索引记录。
    // ============================================================

    function locateDailyRecord(
        buf,
        identifier
    ) {
        const idBytes =
            asciiBytes(identifier);

        let searchFrom = 0;

        const candidates = [];

        while (
            searchFrom <=
            buf.length - idBytes.length
        ) {
            const idIndex =
                findBytes(
                    buf,
                    idBytes,
                    searchFrom
                );

            if (idIndex < 0) {
                break;
            }

            searchFrom =
                idIndex + 1;

            // --------------------------------
            // 找 inner message field1 开头
            //
            // field 1 string:
            //
            // 0A <length> "daily-..."
            // --------------------------------

            let payloadStart = -1;

            for (
                let tagPos =
                    Math.max(
                        0,
                        idIndex - 6
                    );
                tagPos < idIndex;
                tagPos++
            ) {
                if (
                    buf[tagPos] !== 0x0a
                ) {
                    continue;
                }

                const lenInfo =
                    readVarint(
                        buf,
                        tagPos + 1,
                        idIndex
                    );

                if (!lenInfo) {
                    continue;
                }

                if (
                    lenInfo.next === idIndex &&
                    lenInfo.value ===
                        idBytes.length
                ) {
                    payloadStart =
                        tagPos;

                    break;
                }
            }

            if (payloadStart < 0) {
                continue;
            }

            // --------------------------------
            // 找包住整个 DailyStage 的
            // outer length-delimited wrapper
            // --------------------------------

            let outerTagPos = -1;
            let payloadLength = -1;

            for (
                let tagPos =
                    Math.max(
                        0,
                        payloadStart - 8
                    );
                tagPos < payloadStart;
                tagPos++
            ) {
                const tagInfo =
                    readVarint(
                        buf,
                        tagPos,
                        payloadStart
                    );

                if (
                    !tagInfo ||
                    (tagInfo.value & 7) !== 2
                ) {
                    continue;
                }

                const lenInfo =
                    readVarint(
                        buf,
                        tagInfo.next,
                        payloadStart
                    );

                if (
                    !lenInfo ||
                    lenInfo.next !==
                        payloadStart
                ) {
                    continue;
                }

                if (
                    payloadStart +
                        lenInfo.value >
                    buf.length
                ) {
                    continue;
                }

                outerTagPos =
                    tagPos;

                payloadLength =
                    lenInfo.value;
            }

            if (outerTagPos < 0) {
                continue;
            }

            const payloadEnd =
                payloadStart +
                payloadLength;

            const payload =
                buf.subarray(
                    payloadStart,
                    payloadEnd
                );

            // --------------------------------
            // 排除同名的小型 metadata record
            // --------------------------------

            try {
                const fields =
                    parseFields(payload);

                const f1 =
                    getLengthDelimitedField(
                        payload,
                        fields,
                        1
                    );

                const f2 =
                    getLengthDelimitedField(
                        payload,
                        fields,
                        2
                    );

                const f3 =
                    getLengthDelimitedField(
                        payload,
                        fields,
                        3
                    );

                if (
                    !f1 ||
                    !f2 ||
                    !f3
                ) {
                    continue;
                }

                const idText =
                    asciiString(f1);

                const stageText =
                    asciiString(f2);

                if (
                    idText !== identifier
                ) {
                    continue;
                }

                if (
                    stageText.indexOf(
                        "stage."
                    ) !== 0
                ) {
                    continue;
                }

                // 真正 Lua 都是几十 KB。
                if (f3.length < 10000) {
                    continue;
                }

                // 再确认是 generator Lua。
                const marker1 =
                    findBytes(
                        f3,
                        asciiBytes(
                            "local function load_enemy"
                        ),
                        0
                    );

                const marker2 =
                    findBytes(
                        f3,
                        asciiBytes(
                            "load_stage({"
                        ),
                        0
                    );

                if (
                    marker1 < 0 ||
                    marker2 < 0
                ) {
                    continue;
                }

                candidates.push({
                    identifier,
                    idIndex,
                    outerTagPos,
                    payloadStart,
                    payloadLength,
                    payloadEnd,
                    stageText,
                    scriptLength:
                        f3.length
                });

            } catch (e) {
                // 不是目标 record，
                // 继续搜索下一个 occurrence。
            }
        }

        if (
            candidates.length === 0
        ) {
            return null;
        }

        // 正常只有一个。
        // 如果未来重复，取 Lua 最大的。
        candidates.sort(
            (a, b) =>
                b.scriptLength -
                a.scriptLength
        );

        return candidates[0];
    }

    // ============================================================
    // Normal payload -> Easy payload
    // ============================================================

    function rebuildNormalAsEasy(
        normalPayload,
        easyIdentifier,
        targetLength
    ) {
        const fields =
            parseFields(
                normalPayload
            );

        const easyIdBytes =
            asciiBytes(
                easyIdentifier
            );

        let field1Count = 0;
        let field3Count = 0;
        let field3 = null;

        let fixedLength = 0;

        // --------------------------------
        // 计算除了 Lua(field3) 之外的长度
        // --------------------------------

        for (const f of fields) {

            if (
                f.fieldNo === 1 &&
                f.wire === 2
            ) {
                field1Count++;

                fixedLength +=
                    encodeVarint(
                        f.tag
                    ).length;

                fixedLength +=
                    encodeVarint(
                        easyIdBytes.length
                    ).length;

                fixedLength +=
                    easyIdBytes.length;

            } else if (
                f.fieldNo === 3 &&
                f.wire === 2
            ) {

                field3Count++;
                field3 = f;

            } else {

                fixedLength +=
                    f.end - f.start;
            }
        }

        if (field1Count !== 1) {
            throw new Error(
                `field1 count=${field1Count}`
            );
        }

        if (
            field3Count !== 1 ||
            !field3
        ) {
            throw new Error(
                `field3 count=${field3Count}`
            );
        }

        const script =
            normalPayload.subarray(
                field3.dataStart,
                field3.dataEnd
            );

        const field3TagLen =
            encodeVarint(
                field3.tag
            ).length;

        // --------------------------------
        // 自动计算 Lua trailing padding
        //
        // 目标：
        //
        // rebuilt.length
        // ==
        // 原 Easy payload.length
        // --------------------------------

        let pad =
            Math.max(
                0,
                targetLength -
                    fixedLength -
                    field3TagLen -
                    script.length -
                    encodeVarint(
                        script.length
                    ).length
            );

        // protobuf length varint 自身长度
        // 理论上也可能因 padding 改变，
        // 迭代几次达到稳定值。
        for (
            let i = 0;
            i < 8;
            i++
        ) {
            const lengthVarintLen =
                encodeVarint(
                    script.length + pad
                ).length;

            const nextPad =
                targetLength -
                fixedLength -
                field3TagLen -
                lengthVarintLen -
                script.length;

            if (nextPad === pad) {
                break;
            }

            pad = nextPad;
        }

        if (pad < 0) {
            throw new Error(
                "Normal record 比 Easy 槽位更大，" +
                `超出 ${-pad} bytes`
            );
        }

        const spaces =
            new Uint8Array(pad);

        // ASCII space
        spaces.fill(0x20);

        const parts = [];

        for (const f of fields) {

            // --------------------------------
            // field 1:
            // normal -> easy
            // --------------------------------

            if (
                f.fieldNo === 1 &&
                f.wire === 2
            ) {
                parts.push(
                    encodeVarint(
                        f.tag
                    )
                );

                parts.push(
                    encodeVarint(
                        easyIdBytes.length
                    )
                );

                parts.push(
                    easyIdBytes
                );

            }

            // --------------------------------
            // field 3:
            // 原 Normal Lua + trailing spaces
            // --------------------------------

            else if (
                f.fieldNo === 3 &&
                f.wire === 2
            ) {
                const newScriptLength =
                    script.length +
                    pad;

                parts.push(
                    encodeVarint(
                        f.tag
                    )
                );

                parts.push(
                    encodeVarint(
                        newScriptLength
                    )
                );

                parts.push(script);

                if (pad > 0) {
                    parts.push(spaces);
                }

            }

            // --------------------------------
            // 其它 Normal metadata
            // 原封不动
            // --------------------------------

            else {
                parts.push(
                    sliceCopy(
                        normalPayload,
                        f.start,
                        f.end
                    )
                );
            }
        }

        const rebuilt =
            concat(parts);

        if (
            rebuilt.length !==
            targetLength
        ) {
            throw new Error(
                `Length mismatch: ` +
                `${rebuilt.length} != ` +
                `${targetLength}`
            );
        }

        return {
            rebuilt,
            pad
        };
    }

    function extractAsciiField(
        message,
        fieldNo
    ) {
        const fields =
            parseFields(message);

        const data =
            getLengthDelimitedField(
                message,
                fields,
                fieldNo
            );

        return data
            ? asciiString(data)
            : "<missing>";
    }

    // ============================================================
    // MAIN
    // ============================================================

    const body =
        $response.body;

    if (!body) {
        fail(
            "未获取到响应体"
        );
        return;
    }

    const view =
        cloneBodyAsUint8Array(
            body
        );

    if (!view) {
        fail(
            "响应体不是二进制数据；" +
            "请设置 binary-body-mode=true"
        );
        return;
    }

    log(
        `启动，response size = ` +
        `${view.length} bytes`
    );

    // ============================================================
    // 自动找：
    //
    // daily-commander/easy-XXXX
    //
    // 然后用同一个 XXXX 构造 Normal ID。
    // ============================================================

    const easyPrefix =
        "daily-commander/easy-";

    const easyPrefixBytes =
        asciiBytes(
            easyPrefix
        );

    const easyPrefixPos =
        findBytes(
            view,
            easyPrefixBytes,
            0
        );

    if (easyPrefixPos < 0) {
        fail(
            "没有找到 " +
            "daily-commander/easy-*"
        );
        return;
    }

    let p =
        easyPrefixPos +
        easyPrefix.length;

    let number = "";

    while (
        p < view.length &&
        view[p] >= 0x30 &&
        view[p] <= 0x39
    ) {
        number +=
            String.fromCharCode(
                view[p]
            );

        p++;
    }

    if (!number) {
        fail(
            "未解析到 Daily 编号"
        );
        return;
    }

    const easyId =
        `daily-commander/easy-${number}`;

    const normalId =
        `daily-commander/normal-${number}`;

    log(
        `检测到任务编号 ${number}`
    );

    log(
        `目标槽位: ${easyId}`
    );

    log(
        `来源任务: ${normalId}`
    );

    // ============================================================
    // 找真正的大型 DailyStage record
    // ============================================================

    const easy =
        locateDailyRecord(
            view,
            easyId
        );

    const normal =
        locateDailyRecord(
            view,
            normalId
        );

    if (!easy) {
        fail(
            `找不到 Easy DailyStage`
        );
        return;
    }

    if (!normal) {
        fail(
            `找不到 Normal DailyStage`
        );
        return;
    }

    // 避免异常 overlap
    if (
        easy.payloadEnd >
            normal.outerTagPos &&
        normal.payloadEnd >
            easy.outerTagPos
    ) {
        fail(
            "Easy/Normal record 异常重叠"
        );
        return;
    }

    const easyPayload =
        view.subarray(
            easy.payloadStart,
            easy.payloadEnd
        );

    const normalPayload =
        view.subarray(
            normal.payloadStart,
            normal.payloadEnd
        );

    let easyStageBefore;
    let normalStage;

    try {
        easyStageBefore =
            extractAsciiField(
                easyPayload,
                2
            );

        normalStage =
            extractAsciiField(
                normalPayload,
                2
            );

    } catch (e) {
        fail(
            `protobuf 解析失败: ` +
            e.message
        );
        return;
    }

    log(
        `Easy  record: ` +
        `${easy.payloadLength} bytes, ` +
        `stage=${easyStageBefore}`
    );

    log(
        `Normal record: ` +
        `${normal.payloadLength} bytes, ` +
        `stage=${normalStage}`
    );

    // ============================================================
    // 构造新的 Easy payload
    // ============================================================

    let patch;

    try {
        patch =
            rebuildNormalAsEasy(
                normalPayload,
                easyId,
                easy.payloadLength
            );

    } catch (e) {
        fail(
            `构造替换记录失败: ` +
            e.message
        );
        return;
    }

    // ============================================================
    // 真正修改：
    //
    // 只覆盖原 Easy payload 区域。
    //
    // 外层 protobuf length 不碰。
    // ============================================================

    view.set(
        patch.rebuilt,
        easy.payloadStart
    );

    // ============================================================
    // Sanity check
    // ============================================================

    try {
        const patchedPayload =
            view.subarray(
                easy.payloadStart,
                easy.payloadEnd
            );

        const patchedId =
            extractAsciiField(
                patchedPayload,
                1
            );

        const patchedStage =
            extractAsciiField(
                patchedPayload,
                2
            );

        if (
            patchedId !==
            easyId
        ) {
            fail(
                `field1 校验失败: ` +
                patchedId
            );
            return;
        }

        if (
            patchedStage !==
            normalStage
        ) {
            fail(
                `stage 校验失败: ` +
                patchedStage
            );
            return;
        }

        log("✅ 注入完成");

        log(
            `   ${easyStageBefore}` +
            ` -> ${patchedStage}`
        );

        log(
            `   Lua 尾部填充 ` +
            `${patch.pad} bytes 空格`
        );

        log(
            `   response 总长度保持 ` +
            `${view.length} bytes`
        );

    } catch (e) {
        fail(
            `最终校验失败: ` +
            e.message
        );
        return;
    }

    // ============================================================
    // Headers
    // ============================================================

    const rawHeaders =
        $response.headers || {};

    const safeHeaders = {};

    for (const key in rawHeaders) {

        const lower =
            key.toLowerCase();

        if (
            lower !==
                "content-encoding" &&
            lower !==
                "content-length"
        ) {
            safeHeaders[key] =
                rawHeaders[key];
        }
    }

    safeHeaders[
        "Content-Length"
    ] = String(
        view.length
    );

    // ============================================================
    // 返回本地修改后的响应
    // ============================================================

    $done({
        body: view,
        headers: safeHeaders
    });

})();