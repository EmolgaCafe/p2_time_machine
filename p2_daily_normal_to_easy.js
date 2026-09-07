/**
 * Phoenix 2 Daily Minimal Stage Swap
 *
 * 功能：
 *   将当天 Commander Normal 的：
 *     field 2 = stage id
 *     field 3 = Lua stage script
 *
 *   替换到 Easy DailyStage 中。
 *
 * 保留：
 *   Easy 的 field 1（daily id）
 *   Easy 的 field 4+ 所有 metadata
 *
 * 特点：
 *   - 不做长度对齐
 *   - 不做 Lua padding
 *   - 自动重建 protobuf length
 *   - 仅修改本地 /login response
 *   - 不发送额外请求
 */

(function () {
    const PREFIX = "[P2-MinSwap]";

    function log(msg) {
        console.log(`${PREFIX} ${msg}`);
    }

    function finish(body) {
        const headers = {};
        const raw = $response.headers || {};

        for (const k in raw) {
            const lower = k.toLowerCase();

            if (
                lower !== "content-length" &&
                lower !== "content-encoding"
            ) {
                headers[k] = raw[k];
            }
        }

        headers["Content-Length"] = String(body.length);

        $done({
            body,
            headers
        });
    }

    function fail(msg) {
        log(`❌ ${msg}`);
        $done({});
    }

    // ============================================================
    // Basic binary helpers
    // ============================================================

    function toBytes(body) {
        if (body instanceof Uint8Array) {
            const out = new Uint8Array(body.length);
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
                body.buffer.byteLength - offset;

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
            out[i] = str.charCodeAt(i);
        }

        return out;
    }

    function asciiString(buf) {
        let s = "";

        for (let i = 0; i < buf.length; i++) {
            s += String.fromCharCode(buf[i]);
        }

        return s;
    }

    function findBytes(buf, needle, start = 0) {
        outer:
        for (
            let i = start;
            i <= buf.length - needle.length;
            i++
        ) {
            for (
                let j = 0;
                j < needle.length;
                j++
            ) {
                if (buf[i + j] !== needle[j]) {
                    continue outer;
                }
            }

            return i;
        }

        return -1;
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

    function copySlice(buf, start, end) {
        const out = new Uint8Array(end - start);
        out.set(buf.subarray(start, end));
        return out;
    }

    // ============================================================
    // Varint
    // ============================================================

    function readVarint(buf, pos, limit = buf.length) {
        let value = 0;
        let shift = 0;

        while (pos < limit && shift <= 49) {
            const b = buf[pos++];

            value +=
                (b & 0x7f) *
                Math.pow(2, shift);

            if ((b & 0x80) === 0) {
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
        const out = [];

        do {
            let b = value % 128;

            value =
                Math.floor(value / 128);

            if (value > 0) {
                b |= 0x80;
            }

            out.push(b);

        } while (value > 0);

        return new Uint8Array(out);
    }

    // ============================================================
    // Protobuf parser
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
                    `bad tag @${pos}`
                );
            }

            const tag = tagInfo.value;
            const fieldNo =
                Math.floor(tag / 8);

            const wire =
                tag & 7;

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
                        `bad varint field ${fieldNo}`
                    );
                }

                pos = v.next;

            } else if (wire === 1) {

                pos += 8;

            } else if (wire === 2) {

                const len =
                    readVarint(message, pos);

                if (!len) {
                    throw new Error(
                        `bad len field ${fieldNo}`
                    );
                }

                pos = len.next;

                field.dataStart =
                    pos;

                field.dataEnd =
                    pos + len.value;

                pos =
                    field.dataEnd;

            } else if (wire === 5) {

                pos += 4;

            } else {

                throw new Error(
                    `unsupported wire=${wire}`
                );
            }

            if (pos > message.length) {
                throw new Error(
                    `field ${fieldNo} overflow`
                );
            }

            field.end = pos;

            fields.push(field);
        }

        return fields;
    }

    function getLDField(
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
    // Find real DailyStage record
    // ============================================================

    function locateDailyRecord(
        buf,
        identifier
    ) {
        const idBytes =
            asciiBytes(identifier);

        let searchFrom = 0;

        while (true) {
            const idPos =
                findBytes(
                    buf,
                    idBytes,
                    searchFrom
                );

            if (idPos < 0) {
                return null;
            }

            searchFrom =
                idPos + 1;

            // --------------------------------
            // field 1 should be:
            //
            // 0A <len> "daily-..."
            // --------------------------------

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
                if (buf[p] !== 0x0a) {
                    continue;
                }

                const len =
                    readVarint(
                        buf,
                        p + 1,
                        idPos
                    );

                if (
                    len &&
                    len.next === idPos &&
                    len.value === idBytes.length
                ) {
                    payloadStart = p;
                    break;
                }
            }

            if (payloadStart < 0) {
                continue;
            }

            // --------------------------------
            // Find outer wrapper:
            //
            // <tag> <message length> <DailyStage>
            // --------------------------------

            let outerStart = -1;
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
                const tag =
                    readVarint(
                        buf,
                        p,
                        payloadStart
                    );

                if (
                    !tag ||
                    (tag.value & 7) !== 2
                ) {
                    continue;
                }

                const len =
                    readVarint(
                        buf,
                        tag.next,
                        payloadStart
                    );

                if (
                    !len ||
                    len.next !==
                        payloadStart
                ) {
                    continue;
                }

                if (
                    payloadStart +
                        len.value >
                    buf.length
                ) {
                    continue;
                }

                outerStart = p;
                payloadLength =
                    len.value;
            }

            if (outerStart < 0) {
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
            // Ensure this is actual stage record
            // --------------------------------

            try {
                const fields =
                    parseFields(payload);

                const f1 =
                    getLDField(
                        payload,
                        fields,
                        1
                    );

                const f2 =
                    getLDField(
                        payload,
                        fields,
                        2
                    );

                const f3 =
                    getLDField(
                        payload,
                        fields,
                        3
                    );

                if (!f1 || !f2 || !f3) {
                    continue;
                }

                if (
                    asciiString(f1) !==
                    identifier
                ) {
                    continue;
                }

                const stage =
                    asciiString(f2);

                if (
                    !stage.startsWith(
                        "stage."
                    )
                ) {
                    continue;
                }

                if (f3.length < 10000) {
                    continue;
                }

                if (
                    findBytes(
                        f3,
                        asciiBytes(
                            "load_stage({"
                        )
                    ) < 0
                ) {
                    continue;
                }

                return {
                    identifier,
                    outerStart,
                    payloadStart,
                    payloadEnd,
                    payloadLength,
                    payload,
                    fields,
                    stage,
                    lua: f3
                };

            } catch (e) {
                continue;
            }
        }
    }

    // ============================================================
    // Rebuild protobuf message
    //
    // Replace only selected fields
    // ============================================================

    function rebuildMessage(
        message,
        fields,
        replacements
    ) {
        const parts = [];

        for (const f of fields) {
            if (
                f.wire === 2 &&
                replacements[f.fieldNo]
            ) {
                const data =
                    replacements[
                        f.fieldNo
                    ];

                parts.push(
                    encodeVarint(f.tag)
                );

                parts.push(
                    encodeVarint(
                        data.length
                    )
                );

                parts.push(data);

            } else {

                parts.push(
                    copySlice(
                        message,
                        f.start,
                        f.end
                    )
                );
            }
        }

        return concat(parts);
    }

    // ============================================================
    // Replace one length-delimited protobuf field
    // in an arbitrary parent message
    // ============================================================

    function replaceChildRecord(
        parent,
        childOuterStart,
        childPayloadStart,
        childPayloadEnd,
        newChildPayload
    ) {
        // outer tag
        const tag =
            readVarint(
                parent,
                childOuterStart
            );

        if (!tag) {
            throw new Error(
                "bad child outer tag"
            );
        }

        const oldLen =
            readVarint(
                parent,
                tag.next
            );

        if (
            !oldLen ||
            oldLen.next !==
                childPayloadStart
        ) {
            throw new Error(
                "bad child length"
            );
        }

        const before =
            parent.subarray(
                0,
                childOuterStart
            );

        const after =
            parent.subarray(
                childPayloadEnd
            );

        return concat([
            before,

            encodeVarint(
                tag.value
            ),

            encodeVarint(
                newChildPayload.length
            ),

            newChildPayload,

            after
        ]);
    }

    // ============================================================
    // MAIN
    // ============================================================

    const view =
        toBytes(
            $response.body
        );

    if (!view) {
        fail(
            "No binary response body. " +
            "Enable binary-body-mode=true"
        );
        return;
    }

    log(
        `response = ${view.length} bytes`
    );

    // ============================================================
    // Discover current daily number
    // ============================================================

    const prefix =
        "daily-commander/easy-";

    const prefixPos =
        findBytes(
            view,
            asciiBytes(prefix)
        );

    if (prefixPos < 0) {
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
        view[pos] >= 0x30 &&
        view[pos] <= 0x39
    ) {
        number +=
            String.fromCharCode(
                view[pos]
            );

        pos++;
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

    // ============================================================
    // Locate Easy + Normal
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
            "Real Easy DailyStage not found"
        );
        return;
    }

    if (!normal) {
        fail(
            "Real Normal DailyStage not found"
        );
        return;
    }

    log(
        `Easy: ${easy.stage} ` +
        `lua=${easy.lua.length}`
    );

    log(
        `Normal: ${normal.stage} ` +
        `lua=${normal.lua.length}`
    );

    // ============================================================
    // Build new Easy:
    //
    // field1 = original Easy
    // field2 = Normal stage id
    // field3 = Normal Lua
    // field4+ = original Easy
    // ============================================================

    const normalStageBytes =
        asciiBytes(
            normal.stage
        );

    const newEasyPayload =
        rebuildMessage(
            easy.payload,
            easy.fields,
            {
                2: normalStageBytes,
                3: normal.lua
            }
        );

    log(
        `New Easy payload: ` +
        `${easy.payload.length} -> ` +
        `${newEasyPayload.length}`
    );

    // ============================================================
    // Now rebuild containing protobuf structure
    //
    // Locate common parent containing Easy + Normal
    // ============================================================

    // We know the DailyStage records live inside a large
    // length-delimited container.
    //
    // Search backward from Easy for a parent whose payload
    // encloses both Easy and Normal.

    function findParentContainer(
        buf,
        childStartA,
        childEndB
    ) {
        const searchStart =
            Math.max(
                0,
                childStartA - 16
            );

        for (
            let p = searchStart;
            p >= 0;
            p--
        ) {
            const tag =
                readVarint(
                    buf,
                    p
                );

            if (
                !tag ||
                (tag.value & 7) !== 2
            ) {
                continue;
            }

            const len =
                readVarint(
                    buf,
                    tag.next
                );

            if (!len) {
                continue;
            }

            const payloadStart =
                len.next;

            const payloadEnd =
                payloadStart +
                len.value;

            if (
                payloadStart <=
                    childStartA &&
                payloadEnd >=
                    childEndB &&
                payloadEnd <=
                    buf.length
            ) {
                return {
                    outerStart: p,
                    payloadStart,
                    payloadEnd,
                    tag: tag.value
                };
            }
        }

        return null;
    }

    const parent =
        findParentContainer(
            view,
            easy.outerStart,
            normal.payloadEnd
        );

    if (!parent) {
        fail(
            "Daily parent container not found"
        );
        return;
    }

    const parentPayload =
        view.subarray(
            parent.payloadStart,
            parent.payloadEnd
        );

    // Convert global offsets -> parent-local offsets
    const localOuterStart =
        easy.outerStart -
        parent.payloadStart;

    const localPayloadStart =
        easy.payloadStart -
        parent.payloadStart;

    const localPayloadEnd =
        easy.payloadEnd -
        parent.payloadStart;

    let newParentPayload;

    try {
        newParentPayload =
            replaceChildRecord(
                parentPayload,
                localOuterStart,
                localPayloadStart,
                localPayloadEnd,
                newEasyPayload
            );
    } catch (e) {
        fail(
            `Parent rebuild failed: ${e.message}`
        );
        return;
    }

    // ============================================================
    // Rebuild root response
    // ============================================================

    const rootBefore =
        view.subarray(
            0,
            parent.outerStart
        );

    const rootAfter =
        view.subarray(
            parent.payloadEnd
        );

    const newResponse =
        concat([
            rootBefore,

            encodeVarint(
                parent.tag
            ),

            encodeVarint(
                newParentPayload.length
            ),

            newParentPayload,

            rootAfter
        ]);

    // ============================================================
    // Final checks
    // ============================================================

    log(
        `✅ Stage swapped`
    );

    log(
        `   ${easy.stage}`
    );

    log(
        `   -> ${normal.stage}`
    );

    log(
        `response size: ` +
        `${view.length} -> ` +
        `${newResponse.length}`
    );

    finish(
        newResponse
    );

})();