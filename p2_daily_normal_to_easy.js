/**
 * Phoenix 2 Daily Stage Injector - Experiment 3
 *
 * 实验目标：
 *   Easy 保留自身绝大多数 metadata，
 *   只从 Normal 复制：
 *
 *     field 2  = stage ID
 *     field 3  = Lua stage
 *     field 7  = difficulty/category-like metadata
 *     field 12 = title/template-like metadata
 *
 * 其它：
 *     field 1   = Easy
 *     field 4-6 = Easy
 *     field 8+  = Easy
 *     field 14  = Easy
 *     field 19  = Easy
 *
 * 仍使用 Lua trailing spaces 保持 Easy payload 长度不变。
 */

(function () {

    const PREFIX = "[P2-Field23712-Test]";

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
                new Uint8Array(src.length);

            out.set(src);

            return out;
        }

        return null;
    }


    function asciiBytes(str) {

        const out =
            new Uint8Array(str.length);

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

        let total = 0;

        for (
            const p of parts
        ) {
            total += p.length;
        }

        const out =
            new Uint8Array(total);

        let offset = 0;

        for (
            const p of parts
        ) {
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
            limit =
                buf.length;
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
    // Protobuf parser
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
                dataEnd: null,
                end: null
            };


            if (
                wire === 0
            ) {

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

                field.value =
                    v.value;

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


    function getLengthField(
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


    function getVarintField(
        fields,
        fieldNo
    ) {

        for (
            const f of fields
        ) {

            if (
                f.fieldNo ===
                    fieldNo &&
                f.wire === 0
            ) {

                return f;
            }
        }

        return null;
    }


    // ============================================================
    // Locate real DailyStage
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


            let outerStart =
                -1;

            let payloadLength =
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
                    !tagInfo ||
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


            try {

                const fields =
                    parseFields(
                        payload
                    );


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


                if (
                    !f1 ||
                    !f2 ||
                    !f3
                ) {
                    continue;
                }


                if (
                    asciiString(
                        f1.data
                    ) !==
                    identifier
                ) {
                    continue;
                }


                const stage =
                    asciiString(
                        f2.data
                    );


                if (
                    stage.indexOf(
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
                    stage,
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
    // Build:
    //
    // Easy
    //
    // +
    //
    // Normal field 2
    // Normal field 3
    // Normal field 7
    // Normal field 12
    // ============================================================

    function buildPatch(
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
            getLengthField(
                normalPayload,
                normalFields,
                2
            );


        const normalF3 =
            getLengthField(
                normalPayload,
                normalFields,
                3
            );


        const normalF7 =
            getVarintField(
                normalFields,
                7
            );


        const normalF12 =
            getVarintField(
                normalFields,
                12
            );


        if (
            !normalF2 ||
            !normalF3 ||
            !normalF7 ||
            !normalF12
        ) {
            throw new Error(
                "Normal missing required fields"
            );
        }


        // ========================================================
        // 预构造 Normal field7
        // ========================================================

        const field7Bytes =
            concat([
                encodeVarint(
                    normalF7.tag
                ),

                encodeVarint(
                    normalF7.value
                )
            ]);


        // ========================================================
        // 预构造 Normal field12
        // ========================================================

        const field12Bytes =
            concat([
                encodeVarint(
                    normalF12.tag
                ),

                encodeVarint(
                    normalF12.value
                )
            ]);


        // ========================================================
        // 计算除 field3 外长度
        // ========================================================

        let fixedLength = 0;

        let foundF2 = 0;
        let foundF3 = 0;
        let foundF7 = 0;
        let foundF12 = 0;


        for (
            const f of easyFields
        ) {

            if (
                f.fieldNo === 2 &&
                f.wire === 2
            ) {

                foundF2++;

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

            else if (
                f.fieldNo === 3 &&
                f.wire === 2
            ) {

                foundF3++;
            }

            else if (
                f.fieldNo === 7 &&
                f.wire === 0
            ) {

                foundF7++;

                fixedLength +=
                    field7Bytes.length;
            }

            else if (
                f.fieldNo === 12 &&
                f.wire === 0
            ) {

                foundF12++;

                fixedLength +=
                    field12Bytes.length;
            }

            else {

                fixedLength +=
                    f.end -
                    f.start;
            }
        }


        if (
            foundF2 !== 1 ||
            foundF3 !== 1 ||
            foundF7 !== 1 ||
            foundF12 !== 1
        ) {

            throw new Error(
                "unexpected Easy field structure"
            );
        }


        const script =
            normalF3.data;


        const field3Tag =
            encodeVarint(
                normalF3.field.tag
            );


        const targetLength =
            easyPayload.length;


        // ========================================================
        // Padding
        // ========================================================

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


        for (
            let i = 0;
            i < 8;
            i++
        ) {

            const newLenBytes =
                encodeVarint(
                    script.length +
                    pad
                ).length;


            const newPad =
                targetLength -
                fixedLength -
                field3Tag.length -
                newLenBytes -
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
                `payload too large by ${-pad} bytes`
            );
        }


        const spaces =
            new Uint8Array(
                pad
            );


        spaces.fill(
            0x20
        );


        // ========================================================
        // Rebuild
        // ========================================================

        const parts = [];


        for (
            const f of easyFields
        ) {

            // -------------------------
            // field2 <- Normal
            // -------------------------

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

            // -------------------------
            // field3 <- Normal
            // -------------------------

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

            // -------------------------
            // field7 <- Normal
            // -------------------------

            else if (
                f.fieldNo === 7 &&
                f.wire === 0
            ) {

                parts.push(
                    field7Bytes
                );
            }

            // -------------------------
            // field12 <- Normal
            // -------------------------

            else if (
                f.fieldNo === 12 &&
                f.wire === 0
            ) {

                parts.push(
                    field12Bytes
                );
            }

            // -------------------------
            // everything else <- Easy
            // -------------------------

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
            targetLength
        ) {

            throw new Error(
                `length mismatch: ${rebuilt.length} != ${targetLength}`
            );
        }


        return {
            rebuilt,
            pad,
            normalF7:
                normalF7.value,
            normalF12:
                normalF12.value
        };
    }


    // ============================================================
    // MAIN
    // ============================================================

    const body =
        $response.body;


    if (!body) {

        fail(
            "missing body"
        );

        return;
    }


    const view =
        cloneBody(
            body
        );


    if (!view) {

        fail(
            "body is not binary"
        );

        return;
    }


    // ============================================================
    // Find Commander daily number
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

        fail(
            "Commander Easy not found"
        );

        return;
    }


    let pos =
        prefixPos +
        prefix.length;


    let number = "";


    while (
        pos < view.length &&
        view[pos] >= 48 &&
        view[pos] <= 57
    ) {

        number +=
            String.fromCharCode(
                view[pos]
            );

        pos++;
    }


    if (!number) {

        fail(
            "daily number parse failed"
        );

        return;
    }


    const easyId =
        `daily-commander/easy-${number}`;


    const normalId =
        `daily-commander/normal-${number}`;


    log(
        `Daily ${number}`
    );


    // ============================================================
    // Locate stages
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

        fail(
            "Easy DailyStage not found"
        );

        return;
    }


    if (!normal) {

        fail(
            "Normal DailyStage not found"
        );

        return;
    }


    log(
        `Easy   ${easy.stage}`
    );


    log(
        `Normal ${normal.stage}`
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


    let patch;


    try {

        patch =
            buildPatch(
                easyPayload,
                normalPayload
            );

    } catch (e) {

        fail(
            e.message
        );

        return;
    }


    view.set(
        patch.rebuilt,
        easy.payloadStart
    );


    log(
        "✅ Patch success"
    );


    log(
        "Copied fields: 2, 3, 7, 12"
    );


    log(
        `field7  -> ${patch.normalF7}`
    );


    log(
        `field12 -> ${patch.normalF12}`
    );


    log(
        `Lua padding = ${patch.pad}`
    );


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


    $done({
        body: view,
        headers: newHeaders
    });

})();