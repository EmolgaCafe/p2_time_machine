/**
 * Phoenix 2 Daily Stage Injector - Experiment 2
 *
 * 实验目标：
 *   Easy 保留自己的所有 metadata，
 *   只把：
 *
 *     field 2 = stage ID
 *     field 3 = Lua stage script
 *
 *   替换成 Normal 的内容。
 *
 * 其余字段：
 *   field 1  保留原 Easy
 *   field 4+ 保留原 Easy
 *
 * 为了暂时不修改外层 protobuf length，
 * 如果 Normal Lua 较短，则在 Lua 末尾补空格，
 * 保证整个 Easy DailyStage payload 长度完全不变。
 */

(function () {

    const PREFIX = "[P2-Field23-Test]";

    function log(msg) {
        console.log(`${PREFIX} ${msg}`);
    }

    function finishOriginal(msg) {
        log(`❌ ${msg}`);
        $done({});
    }

    // ============================================================
    // Binary helpers
    // ============================================================

    function cloneBody(body) {

        if (body instanceof Uint8Array) {
            const out = new Uint8Array(body.byteLength);
            out.set(body);
            return out;
        }

        if (body instanceof ArrayBuffer) {
            return new Uint8Array(body.slice(0));
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

            const src =
                new Uint8Array(
                    body.buffer,
                    offset,
                    length
                );

            const out =
                new Uint8Array(
                    src.length
                );

            out.set(src);

            return out;
        }

        return null;
    }


    function asciiBytes(str) {

        const out =
            new Uint8Array(
                str.length
            );

        for (
            let i = 0;
            i < str.length;
            i++
        ) {
            out[i] =
                str.charCodeAt(i);
        }

        return out;
    }


    function asciiString(bytes) {

        let s = "";

        for (
            let i = 0;
            i < bytes.length;
            i++
        ) {
            s +=
                String.fromCharCode(
                    bytes[i]
                );
        }

        return s;
    }


    function findBytes(
        buf,
        needle,
        from
    ) {

        from = from || 0;

        outer:
        for (
            let i = from;
            i <=
                buf.length -
                needle.length;
            i++
        ) {

            for (
                let j = 0;
                j < needle.length;
                j++
            ) {

                if (
                    buf[i + j] !==
                    needle[j]
                ) {
                    continue outer;
                }
            }

            return i;
        }

        return -1;
    }


    function sliceCopy(
        buf,
        start,
        end
    ) {

        const out =
            new Uint8Array(
                end - start
            );

        out.set(
            buf.subarray(
                start,
                end
            )
        );

        return out;
    }


    function concat(parts) {

        let length = 0;

        for (const p of parts) {
            length += p.length;
        }

        const out =
            new Uint8Array(
                length
            );

        let offset = 0;

        for (const p of parts) {

            out.set(
                p,
                offset
            );

            offset += p.length;
        }

        return out;
    }


    // ============================================================
    // Protobuf varint
    // ============================================================

    function readVarint(
        buf,
        pos,
        limit
    ) {

        if (
            limit === undefined
        ) {
            limit = buf.length;
        }

        let value = 0;
        let shift = 0;

        while (
            pos < limit &&
            shift <= 49
        ) {

            const b =
                buf[pos++];

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


    function encodeVarint(value) {

        const bytes = [];

        do {

            let b =
                value % 128;

            value =
                Math.floor(
                    value / 128
                );

            if (
                value > 0
            ) {
                b |= 0x80;
            }

            bytes.push(b);

        } while (
            value > 0
        );

        return new Uint8Array(
            bytes
        );
    }


    // ============================================================
    // Generic protobuf parser
    // ============================================================

    function parseFields(message) {

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
                    "bad protobuf tag"
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
                tag,
                fieldNo,
                wire,
                dataStart: null,
                dataEnd: null
            };


            if (wire === 0) {

                const v =
                    readVarint(
                        message,
                        pos
                    );

                if (!v) {
                    throw new Error(
                        "bad varint field"
                    );
                }

                pos =
                    v.next;

            }

            else if (
                wire === 1
            ) {

                pos += 8;

            }

            else if (
                wire === 2
            ) {

                const lenInfo =
                    readVarint(
                        message,
                        pos
                    );

                if (!lenInfo) {
                    throw new Error(
                        "bad length field"
                    );
                }

                pos =
                    lenInfo.next;

                field.length =
                    lenInfo.value;

                field.dataStart =
                    pos;

                field.dataEnd =
                    pos +
                    field.length;

                pos =
                    field.dataEnd;

            }

            else if (
                wire === 5
            ) {

                pos += 4;

            }

            else {

                throw new Error(
                    `unsupported wire ${wire}`
                );
            }


            if (
                pos >
                message.length
            ) {
                throw new Error(
                    "field exceeds payload"
                );
            }

            field.end =
                pos;

            fields.push(
                field
            );
        }

        return fields;
    }


    function getField(
        message,
        fields,
        fieldNo
    ) {

        for (
            const f of fields
        ) {

            if (
                f.fieldNo ===
                    fieldNo &&
                f.wire === 2
            ) {

                return {
                    field: f,

                    data:
                        message.subarray(
                            f.dataStart,
                            f.dataEnd
                        )
                };
            }
        }

        return null;
    }


    // ============================================================
    // DailyStage locator
    // ============================================================

    function locateDailyStage(
        buf,
        identifier
    ) {

        const idBytes =
            asciiBytes(
                identifier
            );

        let from = 0;

        const candidates = [];

        while (true) {

            const idPos =
                findBytes(
                    buf,
                    idBytes,
                    from
                );

            if (
                idPos < 0
            ) {
                break;
            }

            from =
                idPos + 1;


            // --------------------------------------------
            // 找 field 1 的 0A + length
            // --------------------------------------------

            let payloadStart =
                -1;

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
                    buf[p] !==
                    0x0a
                ) {
                    continue;
                }

                const lenInfo =
                    readVarint(
                        buf,
                        p + 1,
                        idPos
                    );

                if (
                    !lenInfo
                ) {
                    continue;
                }

                if (
                    lenInfo.next ===
                        idPos &&
                    lenInfo.value ===
                        idBytes.length
                ) {

                    payloadStart =
                        p;

                    break;
                }
            }


            if (
                payloadStart < 0
            ) {
                continue;
            }


            // --------------------------------------------
            // 找包住整个 DailyStage 的 parent length
            // --------------------------------------------

            let payloadLength =
                -1;

            let outerStart =
                -1;

            for (
                let p =
                    Math.max(
                        0,
                        payloadStart - 8
                    );
                p <
                    payloadStart;
                p++
            ) {

                const tagInfo =
                    readVarint(
                        buf,
                        p,
                        payloadStart
                    );

                if (
                    !tagInfo
                ) {
                    continue;
                }

                if (
                    (
                        tagInfo.value &
                        7
                    ) !== 2
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
                    !lenInfo
                ) {
                    continue;
                }

                if (
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

                outerStart =
                    p;

                payloadLength =
                    lenInfo.value;
            }


            if (
                outerStart < 0
            ) {
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


            // --------------------------------------------
            // 验证它确实是大型 Stage record
            // --------------------------------------------

            try {

                const fields =
                    parseFields(
                        payload
                    );

                const f1 =
                    getField(
                        payload,
                        fields,
                        1
                    );

                const f2 =
                    getField(
                        payload,
                        fields,
                        2
                    );

                const f3 =
                    getField(
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
                    asciiString(
                        f1.data
                    );

                const stageText =
                    asciiString(
                        f2.data
                    );


                if (
                    idText !==
                    identifier
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


                if (
                    f3.data.length <
                    10000
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
                    payloadStart,
                    payloadEnd,
                    payloadLength,
                    stage:
                        stageText,
                    luaLength:
                        f3.data.length
                });

            } catch (e) {

            }
        }


        if (
            candidates.length === 0
        ) {
            return null;
        }


        candidates.sort(
            (a, b) =>
                b.luaLength -
                a.luaLength
        );


        return candidates[0];
    }


    // ============================================================
    // Experiment:
    //
    // 保留 Easy record
    //
    // 只修改：
    //
    // field 2 = Normal field2
    // field 3 = Normal field3
    //
    // field 1 / field 4+ 全部 Easy 原样保留。
    // ============================================================

    function replaceField2And3(
        easyPayload,
        normalPayload
    ) {

        const easyFields =
            parseFields(
                easyPayload
            );

        const normalFields =
            parseFields(
                normalPayload
            );


        const normalF2 =
            getField(
                normalPayload,
                normalFields,
                2
            );

        const normalF3 =
            getField(
                normalPayload,
                normalFields,
                3
            );


        if (
            !normalF2 ||
            !normalF3
        ) {
            throw new Error(
                "Normal missing field2/field3"
            );
        }


        // --------------------------------------------
        // 先计算除 field3 外最终 record 长度
        // --------------------------------------------

        let fixedLength = 0;

        let easyF3Count = 0;


        for (
            const f of easyFields
        ) {

            // field2 替换成 Normal field2
            if (
                f.fieldNo === 2 &&
                f.wire === 2
            ) {

                fixedLength +=
                    encodeVarint(
                        f.tag
                    ).length;

                fixedLength +=
                    encodeVarint(
                        normalF2.data.length
                    ).length;

                fixedLength +=
                    normalF2.data.length;
            }

            // field3 稍后单独计算
            else if (
                f.fieldNo === 3 &&
                f.wire === 2
            ) {

                easyF3Count++;

            }

            // 其它全部保留 Easy 原始 bytes
            else {

                fixedLength +=
                    f.end -
                    f.start;
            }
        }


        if (
            easyF3Count !== 1
        ) {
            throw new Error(
                `Easy field3 count=${easyF3Count}`
            );
        }


        const targetLength =
            easyPayload.length;


        const script =
            normalF3.data;


        const field3Tag =
            encodeVarint(
                normalF3.field.tag
            );


        // --------------------------------------------
        // 算 padding
        // --------------------------------------------

        let pad =
            Math.max(
                0,

                targetLength -
                    fixedLength -
                    field3Tag.length -
                    encodeVarint(
                        script.length
                    ).length -
                    script.length
            );


        // varint 长度可能变化，迭代稳定
        for (
            let i = 0;
            i < 8;
            i++
        ) {

            const lenBytes =
                encodeVarint(
                    script.length +
                    pad
                ).length;

            const newPad =
                targetLength -
                fixedLength -
                field3Tag.length -
                lenBytes -
                script.length;


            if (
                newPad === pad
            ) {
                break;
            }

            pad =
                newPad;
        }


        if (
            pad < 0
        ) {

            throw new Error(
                `Normal field2+3 比 Easy 可用空间大 ${-pad} bytes`
            );
        }


        const spaces =
            new Uint8Array(
                pad
            );

        spaces.fill(
            0x20
        );


        const parts = [];


        for (
            const f of easyFields
        ) {

            // ========================================
            // field2 -> Normal
            // ========================================

            if (
                f.fieldNo === 2 &&
                f.wire === 2
            ) {

                parts.push(
                    encodeVarint(
                        f.tag
                    )
                );

                parts.push(
                    encodeVarint(
                        normalF2.data.length
                    )
                );

                parts.push(
                    normalF2.data
                );
            }

            // ========================================
            // field3 -> Normal Lua + padding
            // ========================================

            else if (
                f.fieldNo === 3 &&
                f.wire === 2
            ) {

                const newLuaLength =
                    script.length +
                    pad;


                parts.push(
                    encodeVarint(
                        f.tag
                    )
                );


                parts.push(
                    encodeVarint(
                        newLuaLength
                    )
                );


                parts.push(
                    script
                );


                if (
                    pad > 0
                ) {
                    parts.push(
                        spaces
                    );
                }
            }

            // ========================================
            // 所有其它 field 继续使用 Easy
            // ========================================

            else {

                parts.push(
                    sliceCopy(
                        easyPayload,
                        f.start,
                        f.end
                    )
                );
            }
        }


        const rebuilt =
            concat(
                parts
            );


        if (
            rebuilt.length !==
            easyPayload.length
        ) {

            throw new Error(
                `length mismatch ${rebuilt.length} != ${easyPayload.length}`
            );
        }


        return {
            rebuilt,
            pad
        };
    }


    // ============================================================
    // MAIN
    // ============================================================

    const body =
        $response.body;


    if (!body) {

        finishOriginal(
            "没有 response body"
        );

        return;
    }


    const view =
        cloneBody(
            body
        );


    if (!view) {

        finishOriginal(
            "response body 不是 Uint8Array"
        );

        return;
    }


    log(
        `response size = ${view.length}`
    );


    // ============================================================
    // 自动读取：
    //
    // daily-commander/easy-XXXX
    // ============================================================

    const prefix =
        "daily-commander/easy-";


    const prefixPos =
        findBytes(
            view,
            asciiBytes(
                prefix
            ),
            0
        );


    if (
        prefixPos < 0
    ) {

        finishOriginal(
            "没有找到 Commander Easy"
        );

        return;
    }


    let p =
        prefixPos +
        prefix.length;


    let number = "";


    while (
        p < view.length &&
        view[p] >= 48 &&
        view[p] <= 57
    ) {

        number +=
            String.fromCharCode(
                view[p]
            );

        p++;
    }


    if (!number) {

        finishOriginal(
            "读取 Daily 编号失败"
        );

        return;
    }


    const easyId =
        `daily-commander/easy-${number}`;


    const normalId =
        `daily-commander/normal-${number}`;


    log(
        `Daily = ${number}`
    );


    // ============================================================
    // 找两个大型 stage record
    // ============================================================

    const easy =
        locateDailyStage(
            view,
            easyId
        );


    const normal =
        locateDailyStage(
            view,
            normalId
        );


    if (!easy) {

        finishOriginal(
            "找不到 Easy Stage record"
        );

        return;
    }


    if (!normal) {

        finishOriginal(
            "找不到 Normal Stage record"
        );

        return;
    }


    log(
        `Easy: ${easy.stage}, ${easy.payloadLength} bytes`
    );


    log(
        `Normal: ${normal.stage}, ${normal.payloadLength} bytes`
    );


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


    // ============================================================
    // 只替换 field2 + field3
    // ============================================================

    let patch;


    try {

        patch =
            replaceField2And3(
                easyPayload,
                normalPayload
            );

    } catch (e) {

        finishOriginal(
            `构造失败: ${e.message}`
        );

        return;
    }


    view.set(
        patch.rebuilt,
        easy.payloadStart
    );


    // ============================================================
    // 校验
    // ============================================================

    try {

        const newEasy =
            view.subarray(
                easy.payloadStart,
                easy.payloadEnd
            );


        const fields =
            parseFields(
                newEasy
            );


        const f1 =
            getField(
                newEasy,
                fields,
                1
            );


        const f2 =
            getField(
                newEasy,
                fields,
                2
            );


        if (
            asciiString(
                f1.data
            ) !== easyId
        ) {

            throw new Error(
                "Easy field1 被意外修改"
            );
        }


        if (
            asciiString(
                f2.data
            ) !== normal.stage
        ) {

            throw new Error(
                "field2 未成功替换"
            );
        }


        log(
            "✅ Experiment 2 注入成功"
        );


        log(
            `Easy ID 保持: ${easyId}`
        );


        log(
            `Stage: ${easy.stage} -> ${normal.stage}`
        );


        log(
            `只替换 field2 + field3`
        );


        log(
            `field4+ 继续使用原 Easy`
        );


        log(
            `Lua padding = ${patch.pad} bytes`
        );


        log(
            `总 response 长度仍为 ${view.length}`
        );

    } catch (e) {

        finishOriginal(
            `校验失败: ${e.message}`
        );

        return;
    }


    // ============================================================
    // Headers
    // ============================================================

    const oldHeaders =
        $response.headers || {};


    const newHeaders = {};


    for (
        const key in oldHeaders
    ) {

        const lower =
            key.toLowerCase();


        if (
            lower !==
                "content-encoding" &&
            lower !==
                "content-length"
        ) {

            newHeaders[key] =
                oldHeaders[key];
        }
    }


    newHeaders[
        "Content-Length"
    ] =
        String(
            view.length
        );


    // ============================================================
    // 返回修改后的本地响应
    // ============================================================

    $done({
        body: view,
        headers: newHeaders
    });

})();