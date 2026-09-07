/**
 * Phoenix 2 Daily Stage Injector - No Padding Experiment
 *
 * 目标：
 *   Easy 保留自身全部 metadata，只从 Normal 复制：
 *
 *     field 2  = stage ID
 *     field 3  = Lua stage
 *     field 14 = title/display metadata
 *
 * 与上一版不同：
 *   - 不做任何 padding
 *   - Easy DailyStage 可以自然变长/变短
 *   - 自动重建 DailyStage wrapper 长度
 *   - 自动重建顶层 daily collection 长度
 *   - 自动更新 HTTP Content-Length
 */

(function () {

    const PREFIX = "[P2-NoPadding]";

    function log(s) {
        console.log(`${PREFIX} ${s}`);
    }

    function fail(s) {
        log(`❌ ${s}`);
        $done({});
    }


    // ============================================================
    // Binary helpers
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


    function asciiBytes(s) {

        const out =
            new Uint8Array(
                s.length
            );


        for (
            let i = 0;
            i < s.length;
            i++
        ) {

            out[i] =
                s.charCodeAt(i);
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

        from =
            from || 0;


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


    function copySlice(
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

        if (
            !Number.isSafeInteger(value) ||
            value < 0
        ) {

            throw new Error(
                `bad varint ${value}`
            );
        }


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
    // Generic protobuf parser
    // ============================================================

    function parseFields(msg) {

        const fields = [];

        let pos = 0;


        while (
            pos < msg.length
        ) {

            const start =
                pos;


            const tagInfo =
                readVarint(
                    msg,
                    pos
                );


            if (!tagInfo) {

                throw new Error(
                    `bad tag @${pos}`
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
                        msg,
                        pos
                    );


                if (!v) {

                    throw new Error(
                        `bad varint field ${fieldNo}`
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
                        msg,
                        pos
                    );


                if (!lenInfo) {

                    throw new Error(
                        `bad length field ${fieldNo}`
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
                msg.length
            ) {

                throw new Error(
                    `field ${fieldNo} overflow`
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
        msg,
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
                        msg.subarray(
                            f.start,
                            f.end
                        ),

                    data:
                        f.wire === 2
                            ?
                            msg.subarray(
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


            // ----------------------------------------------------
            // Find DailyStage payload start
            //
            // field 1:
            // 0A <length> "daily-..."
            // ----------------------------------------------------

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
                    lenInfo &&
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


            // ----------------------------------------------------
            // Find repeated DailyStage wrapper
            // ----------------------------------------------------

            let outerStart =
                -1;


            let outerTag =
                -1;


            let payloadLength =
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


                outerTag =
                    tagInfo.value;


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

                    outerStart,

                    outerTag,

                    payloadStart,

                    payloadEnd,

                    outerEnd:
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
    // Build new Easy payload
    //
    // NO PADDING
    //
    // Easy:
    //   field 1  <- Easy
    //   field 2  <- Normal
    //   field 3  <- Normal
    //   field 14 <- Normal
    //   all other fields <- Easy
    // ============================================================

    function buildEasyPayload(
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
                "Normal missing field2/3/14"
            );
        }


        let countF2 = 0;
        let countF3 = 0;
        let countF14 = 0;


        const parts = [];


        for (
            const f of easyFields
        ) {

            // ----------------------------------------------------
            // field 2 <- Normal stage ID
            // ----------------------------------------------------

            if (
                f.fieldNo === 2 &&
                f.wire === 2
            ) {

                countF2++;


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
            // field 3 <- Normal Lua
            // ----------------------------------------------------

            else if (
                f.fieldNo === 3 &&
                f.wire === 2
            ) {

                countF3++;


                parts.push(
                    encodeVarint(
                        f.tag
                    )
                );


                parts.push(
                    encodeVarint(
                        normalF3.data.length
                    )
                );


                parts.push(
                    normalF3.data
                );
            }


            // ----------------------------------------------------
            // field 14 <- Normal title metadata
            // ----------------------------------------------------

            else if (
                f.fieldNo === 14 &&
                f.wire === 2
            ) {

                countF14++;


                parts.push(
                    encodeVarint(
                        f.tag
                    )
                );


                parts.push(
                    encodeVarint(
                        normalF14.data.length
                    )
                );


                parts.push(
                    normalF14.data
                );
            }


            // ----------------------------------------------------
            // Everything else stays Easy
            // ----------------------------------------------------

            else {

                parts.push(
                    copySlice(
                        easyPayload,
                        f.start,
                        f.end
                    )
                );
            }
        }


        if (
            countF2 !== 1 ||
            countF3 !== 1 ||
            countF14 !== 1
        ) {

            throw new Error(
                `unexpected Easy fields: ` +
                `f2=${countF2}, ` +
                `f3=${countF3}, ` +
                `f14=${countF14}`
            );
        }


        return concat(
            parts
        );
    }


    // ============================================================
    // Parse top-level protobuf
    //
    // Find the length-delimited root field that contains
    // Easy + Normal DailyStage records.
    // ============================================================

    function findTopLevelContainer(
        buf,
        childStart,
        childEnd
    ) {

        let pos = 0;


        while (
            pos < buf.length
        ) {

            const start =
                pos;


            const tagInfo =
                readVarint(
                    buf,
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


            let dataStart =
                null;


            let dataEnd =
                null;


            if (
                wire === 0
            ) {

                const v =
                    readVarint(
                        buf,
                        pos
                    );


                if (!v) {

                    throw new Error(
                        "bad root varint"
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
                        buf,
                        pos
                    );


                if (!lenInfo) {

                    throw new Error(
                        "bad root length"
                    );
                }


                dataStart =
                    lenInfo.next;


                dataEnd =
                    dataStart +
                    lenInfo.value;


                pos =
                    dataEnd;
            }


            else if (
                wire === 5
            ) {

                pos += 4;
            }


            else {

                throw new Error(
                    `unsupported root wire ${wire}`
                );
            }


            if (
                pos >
                buf.length
            ) {

                throw new Error(
                    "root field overflow"
                );
            }


            // Does this top-level field contain our DailyStages?
            if (
                wire === 2 &&
                dataStart <=
                    childStart &&
                dataEnd >=
                    childEnd
            ) {

                return {

                    start,

                    tag,

                    dataStart,

                    dataEnd,

                    end:
                        pos
                };
            }
        }


        return null;
    }


    // ============================================================
    // MAIN
    // ============================================================

    const view =
        cloneBody(
            $response.body
        );


    if (!view) {

        fail(
            "binary response body unavailable; " +
            "use binary-body-mode=true"
        );

        return;
    }


    // ============================================================
    // Auto detect daily number
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
            "daily number parse failed"
        );

        return;
    }


    const easyId =
        `daily-commander/easy-${number}`;


    const normalId =
        `daily-commander/normal-${number}`;


    // ============================================================
    // Locate Easy + Normal
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


    if (
        !easy ||
        !normal
    ) {

        fail(
            "Easy/Normal real DailyStage not found"
        );

        return;
    }


    log(
        `Daily ${number}`
    );


    log(
        `Easy   ${easy.stage}, ` +
        `payload=${easy.payloadLength}`
    );


    log(
        `Normal ${normal.stage}, ` +
        `payload=${normal.payloadLength}`
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
    // Build new variable-length Easy payload
    // ============================================================

    let newEasyPayload;


    try {

        newEasyPayload =
            buildEasyPayload(
                easyPayload,
                normalPayload
            );

    }

    catch (e) {

        fail(
            `build Easy failed: ${e.message}`
        );

        return;
    }


    // ============================================================
    // Rebuild repeated DailyStage wrapper
    //
    // <tag>
    // <NEW LENGTH>
    // <new payload>
    // ============================================================

    const newEasyWrapper =
        concat([

            encodeVarint(
                easy.outerTag
            ),

            encodeVarint(
                newEasyPayload.length
            ),

            newEasyPayload
        ]);


    // ============================================================
    // Locate top-level daily collection
    // ============================================================

    let container;


    try {

        container =
            findTopLevelContainer(
                view,
                easy.outerStart,
                normal.outerEnd
            );

    }

    catch (e) {

        fail(
            `root parse failed: ${e.message}`
        );

        return;
    }


    if (!container) {

        fail(
            "top-level Daily collection not found"
        );

        return;
    }


    const oldContainerPayload =
        view.subarray(
            container.dataStart,
            container.dataEnd
        );


    const relativeEasyStart =
        easy.outerStart -
        container.dataStart;


    const relativeEasyEnd =
        easy.outerEnd -
        container.dataStart;


    if (
        relativeEasyStart < 0 ||
        relativeEasyEnd >
            oldContainerPayload.length ||
        relativeEasyStart >=
            relativeEasyEnd
    ) {

        fail(
            "Easy wrapper boundary invalid"
        );

        return;
    }


    // ============================================================
    // Rebuild Daily collection
    //
    // before Easy
    // +
    // new Easy wrapper
    // +
    // after Easy
    // ============================================================

    const newContainerPayload =
        concat([

            copySlice(
                oldContainerPayload,
                0,
                relativeEasyStart
            ),

            newEasyWrapper,

            copySlice(
                oldContainerPayload,
                relativeEasyEnd,
                oldContainerPayload.length
            )
        ]);


    // ============================================================
    // Rebuild top-level collection field
    // ============================================================

    const newContainerField =
        concat([

            encodeVarint(
                container.tag
            ),

            encodeVarint(
                newContainerPayload.length
            ),

            newContainerPayload
        ]);


    // ============================================================
    // Rebuild entire HTTP body
    // ============================================================

    const finalBody =
        concat([

            copySlice(
                view,
                0,
                container.start
            ),

            newContainerField,

            copySlice(
                view,
                container.end,
                view.length
            )
        ]);


    // ============================================================
    // Sanity check
    // ============================================================

    const patchedEasy =
        locateDailyStage(
            finalBody,
            easyId
        );


    if (!patchedEasy) {

        fail(
            "sanity: rebuilt Easy not found"
        );

        return;
    }


    if (
        patchedEasy.stage !==
        normal.stage
    ) {

        fail(
            `sanity stage mismatch: ` +
            `${patchedEasy.stage} != ` +
            `${normal.stage}`
        );

        return;
    }


    log(
        "✅ no-padding rebuild success"
    );


    log(
        "copied fields: 2 + 3 + 14 only"
    );


    log(
        `Easy payload: ` +
        `${easy.payloadLength} -> ` +
        `${newEasyPayload.length}`
    );


    log(
        `Daily collection: ` +
        `${oldContainerPayload.length} -> ` +
        `${newContainerPayload.length}`
    );


    log(
        `HTTP body: ` +
        `${view.length} -> ` +
        `${finalBody.length}`
    );


    log(
        `delta = ` +
        `${finalBody.length - view.length} bytes`
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
            finalBody.length
        );


    // ============================================================
    // Return modified response
    // ============================================================

    $done({

        body:
            finalBody,

        headers:
            headers
    });

})();