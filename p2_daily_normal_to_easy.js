/**
 * Phoenix 2 Daily Stage Injector
 * Experiment: field 2 + 3 + 14
 *
 * Easy 保留所有原 metadata，
 * 仅从 Normal 复制：
 *
 *   field 2  = stage ID
 *   field 3  = Lua stage
 *   field 14 = 待验证 metadata
 *
 * field 7 / field 12 不再复制。
 */

(function () {

    const PREFIX = "[P2-F2F3F14]";

    function log(s) {
        console.log(`${PREFIX} ${s}`);
    }

    function fail(s) {
        log(`❌ ${s}`);
        $done({});
    }


    // ============================================================
    // Binary
    // ============================================================

    function cloneBody(body) {

        if (body instanceof Uint8Array) {

            const out =
                new Uint8Array(
                    body.byteLength
                );

            out.set(body);

            return out;
        }


        if (body instanceof ArrayBuffer) {

            return new Uint8Array(
                body.slice(0)
            );
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

        let total = 0;


        for (
            const p of parts
        ) {

            total +=
                p.length;
        }


        const out =
            new Uint8Array(
                total
            );


        let offset = 0;


        for (
            const p of parts
        ) {

            out.set(
                p,
                offset
            );


            offset +=
                p.length;
        }


        return out;
    }


    // ============================================================
    // Varint
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

        const arr = [];


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


            arr.push(b);


        } while (
            value > 0
        );


        return new Uint8Array(
            arr
        );
    }


    // ============================================================
    // Protobuf
    // ============================================================

    function parseFields(message) {

        const fields = [];

        let pos = 0;


        while (
            pos < message.length
        ) {

            const start =
                pos;


            const tagInfo =
                readVarint(
                    message,
                    pos
                );


            if (!tagInfo) {

                throw new Error(
                    `bad tag @ ${pos}`
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


            const f = {

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
                        "bad varint"
                    );
                }


                f.value =
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
                        "bad length"
                    );
                }


                pos =
                    lenInfo.next;


                f.length =
                    lenInfo.value;


                f.dataStart =
                    pos;


                f.dataEnd =
                    pos +
                    f.length;


                pos =
                    f.dataEnd;
            }


            else if (
                wire === 5
            ) {

                pos += 4;
            }


            else {

                throw new Error(
                    `wire ${wire}`
                );
            }


            if (
                pos >
                message.length
            ) {

                throw new Error(
                    "field overflow"
                );
            }


            f.end =
                pos;


            fields.push(f);
        }


        return fields;
    }


    function getField(
        message,
        fields,
        fieldNo,
        wire
    ) {

        for (
            const f of fields
        ) {

            if (
                f.fieldNo === fieldNo &&
                (
                    wire === undefined ||
                    f.wire === wire
                )
            ) {

                return {

                    field: f,

                    raw:
                        message.subarray(
                            f.start,
                            f.end
                        ),

                    data:
                        f.wire === 2
                            ?
                            message.subarray(
                                f.dataStart,
                                f.dataEnd
                            )
                            :
                            null
                };
            }
        }


        return null;
    }


    // ============================================================
    // Locate actual DailyStage
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


            // field1:
            //
            // 0A length "daily..."
            //
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
                    buf[p] !== 0x0a
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


            // 找 outer wrapper
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

                p < payloadStart;

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
                    getField(
                        payload,
                        fields,
                        1,
                        2
                    );


                const f2 =
                    getField(
                        payload,
                        fields,
                        2,
                        2
                    );


                const f3 =
                    getField(
                        payload,
                        fields,
                        3,
                        2
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
                    ) !== identifier
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


                // 真正的 stage Lua
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
    // Build patched Easy
    //
    // Easy:
    //   field 1  <- Easy
    //   field 2  <- Normal
    //   field 3  <- Normal
    //   field 14 <- Normal
    //   everything else <- Easy
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
            getField(
                normalPayload,
                normalFields,
                2,
                2
            );


        const normalF3 =
            getField(
                normalPayload,
                normalFields,
                3,
                2
            );


        const normalF14 =
            getField(
                normalPayload,
                normalFields,
                14,
                2
            );


        if (
            !normalF2 ||
            !normalF3 ||
            !normalF14
        ) {

            throw new Error(
                "Normal missing f2/f3/f14"
            );
        }


        let fixedLength = 0;


        let countF2 = 0;
        let countF3 = 0;
        let countF14 = 0;


        // ========================================================
        // Calculate final length excluding field3
        // ========================================================

        for (
            const f of easyFields
        ) {

            if (
                f.fieldNo === 2 &&
                f.wire === 2
            ) {

                countF2++;


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

                countF3++;
            }


            else if (
                f.fieldNo === 14 &&
                f.wire === 2
            ) {

                countF14++;


                // 直接复制整个 Normal field14
                fixedLength +=
                    normalF14.raw.length;
            }


            else {

                fixedLength +=
                    f.end -
                    f.start;
            }
        }


        if (
            countF2 !== 1 ||
            countF3 !== 1 ||
            countF14 !== 1
        ) {

            throw new Error(
                `unexpected fields: ` +
                `f2=${countF2}, ` +
                `f3=${countF3}, ` +
                `f14=${countF14}`
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

            const lenVarint =
                encodeVarint(
                    script.length +
                    pad
                ).length;


            const nextPad =
                targetLength -

                fixedLength -

                field3Tag.length -

                lenVarint -

                script.length;


            if (
                nextPad === pad
            ) {

                break;
            }


            pad =
                nextPad;
        }


        if (
            pad < 0
        ) {

            throw new Error(
                `payload too large by ${-pad}`
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

            // ----------------------------------------------------
            // field 2 <- Normal
            // ----------------------------------------------------

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


            // ----------------------------------------------------
            // field 3 <- Normal
            // ----------------------------------------------------

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


            // ----------------------------------------------------
            // field 14 <- Normal
            // ----------------------------------------------------

            else if (
                f.fieldNo === 14 &&
                f.wire === 2
            ) {

                parts.push(
                    normalF14.raw
                );
            }


            // ----------------------------------------------------
            // everything else <- Easy
            // ----------------------------------------------------

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
                `length mismatch ` +
                `${rebuilt.length} != ` +
                `${targetLength}`
            );
        }


        return {

            rebuilt,
            pad,

            f14:
                Array.from(
                    normalF14.data
                )
                .map(
                    x =>
                        x
                        .toString(16)
                        .padStart(
                            2,
                            "0"
                        )
                )
                .join(" ")
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

        fail(
            "Daily number not found"
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
            "Easy stage not found"
        );

        return;
    }


    if (!normal) {

        fail(
            "Normal stage not found"
        );

        return;
    }


    log(
        `Easy   = ${easy.stage}`
    );


    log(
        `Normal = ${normal.stage}`
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

    }

    catch (e) {

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
        "✅ patch success"
    );


    log(
        "copied fields: 2 + 3 + 14"
    );


    log(
        `Normal field14 = ${patch.f14}`
    );


    log(
        `Lua padding = ${patch.pad}`
    );


    // ============================================================
    // Headers
    // ============================================================

    const oldHeaders =
        $response.headers || {};


    const headers = {};


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

            headers[key] =
                oldHeaders[key];
        }
    }


    headers[
        "Content-Length"
    ] =
        String(
            view.length
        );


    $done({
        body: view,
        headers
    });

})();