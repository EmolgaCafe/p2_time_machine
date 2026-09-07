/**
 * Phoenix 2 Stage Tool
 * package.js
 *
 * 职责：
 *   - 定义 p2stage-raw-v1
 *   - Uint8Array <-> Base64
 *   - 创建 / 验证 Package
 *   - Loon persistentStore 保存 / 读取 / 索引
 *
 * raw-v1 是“无损低层格式”。
 *
 * 当前格式：
 *
 * {
 *   "format": "p2stage-raw-v1",
 *   "missionId": "daily-commander/normal-3901",
 *   "field2":  "<base64>",
 *   "field3":  "<base64>",
 *   "field14": "<base64>"
 * }
 *
 * missionId 仅用于识别来源。
 *
 * 真正注入所需：
 *   field2
 *   field3
 *   field14
 */

export const PACKAGE_FORMAT =
    "p2stage-raw-v1";

export const STORAGE_PREFIX =
    "p2stage.raw.";

export const INDEX_KEY =
    "p2stage.raw.index";


// ============================================================================
// Base64
// ============================================================================

const BASE64_TABLE =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";


export function bytesToBase64(bytes) {
    let out = "";
    let i = 0;


    while (
        i + 2 <
        bytes.length
    ) {
        const n =
            (bytes[i] << 16) |
            (bytes[i + 1] << 8) |
            bytes[i + 2];

        out +=
            BASE64_TABLE[
                (n >>> 18) & 63
            ];

        out +=
            BASE64_TABLE[
                (n >>> 12) & 63
            ];

        out +=
            BASE64_TABLE[
                (n >>> 6) & 63
            ];

        out +=
            BASE64_TABLE[
                n & 63
            ];

        i += 3;
    }


    const remain =
        bytes.length - i;


    if (remain === 1) {
        const n =
            bytes[i] << 16;

        out +=
            BASE64_TABLE[
                (n >>> 18) & 63
            ];

        out +=
            BASE64_TABLE[
                (n >>> 12) & 63
            ];

        out += "==";
    }

    else if (remain === 2) {
        const n =
            (bytes[i] << 16) |
            (bytes[i + 1] << 8);

        out +=
            BASE64_TABLE[
                (n >>> 18) & 63
            ];

        out +=
            BASE64_TABLE[
                (n >>> 12) & 63
            ];

        out +=
            BASE64_TABLE[
                (n >>> 6) & 63
            ];

        out += "=";
    }


    return out;
}


export function base64ToBytes(text) {
    const clean =
        text.replace(
            /\s+/g,
            ""
        );

    if (
        clean.length % 4 !== 0
    ) {
        throw new Error(
            "invalid base64 length"
        );
    }


    const reverse = {};

    for (
        let i = 0;
        i <
            BASE64_TABLE.length;
        i++
    ) {
        reverse[
            BASE64_TABLE[i]
        ] = i;
    }


    const bytes = [];


    for (
        let i = 0;
        i < clean.length;
        i += 4
    ) {
        const c1 =
            clean[i];

        const c2 =
            clean[i + 1];

        const c3 =
            clean[i + 2];

        const c4 =
            clean[i + 3];


        const v1 =
            reverse[c1];

        const v2 =
            reverse[c2];

        const v3 =
            c3 === "="
                ? 0
                : reverse[c3];

        const v4 =
            c4 === "="
                ? 0
                : reverse[c4];


        if (
            v1 === undefined ||
            v2 === undefined ||
            (
                c3 !== "=" &&
                v3 === undefined
            ) ||
            (
                c4 !== "=" &&
                v4 === undefined
            )
        ) {
            throw new Error(
                "invalid base64 character"
            );
        }


        const n =
            (v1 << 18) |
            (v2 << 12) |
            (v3 << 6) |
            v4;


        bytes.push(
            (n >>> 16) &
            0xff
        );


        if (c3 !== "=") {
            bytes.push(
                (n >>> 8) &
                0xff
            );
        }


        if (c4 !== "=") {
            bytes.push(
                n &
                0xff
            );
        }
    }


    return new Uint8Array(
        bytes
    );
}


// ============================================================================
// Package
// ============================================================================

export function createRawPackage(
    stage
) {
    return {
        format:
            PACKAGE_FORMAT,

        missionId:
            stage.missionId,

        field2:
            bytesToBase64(
                stage.field2
            ),

        field3:
            bytesToBase64(
                stage.field3
            ),

        field14:
            bytesToBase64(
                stage.field14
            )
    };
}


export function validateRawPackage(
    pkg
) {
    if (
        !pkg ||
        typeof pkg !==
            "object"
    ) {
        throw new Error(
            "package is not an object"
        );
    }


    if (
        pkg.format !==
        PACKAGE_FORMAT
    ) {
        throw new Error(
            `unsupported package format: ${pkg.format}`
        );
    }


    if (
        typeof pkg.missionId !==
            "string" ||
        !pkg.missionId.startsWith(
            "daily-"
        )
    ) {
        throw new Error(
            "invalid missionId"
        );
    }


    for (
        const name of [
            "field2",
            "field3",
            "field14"
        ]
    ) {
        if (
            typeof pkg[name] !==
            "string"
        ) {
            throw new Error(
                `missing ${name}`
            );
        }
    }


    return true;
}


/**
 * 转成 Injector 使用的 raw bytes。
 */
export function decodeRawPackage(
    pkg
) {
    validateRawPackage(pkg);

    return {
        missionId:
            pkg.missionId,

        field2:
            base64ToBytes(
                pkg.field2
            ),

        field3:
            base64ToBytes(
                pkg.field3
            ),

        field14:
            base64ToBytes(
                pkg.field14
            )
    };
}


// ============================================================================
// PersistentStore
// ============================================================================

export function storageKeyForMission(
    missionId
) {
    return (
        STORAGE_PREFIX +
        missionId
    );
}


export function readPackageIndex() {
    const raw =
        $persistentStore.read(
            INDEX_KEY
        );


    if (!raw) {
        return [];
    }


    try {
        const parsed =
            JSON.parse(raw);

        return Array.isArray(
            parsed
        )
            ? parsed
            : [];
    }

    catch (e) {
        return [];
    }
}


export function writePackageIndex(
    index
) {
    return $persistentStore.write(
        JSON.stringify(index),
        INDEX_KEY
    );
}


/**
 * 同 missionId 再次保存时直接覆盖。
 */
export function saveRawPackage(
    pkg
) {
    validateRawPackage(pkg);

    const key =
        storageKeyForMission(
            pkg.missionId
        );

    const text =
        JSON.stringify(pkg);


    const ok =
        $persistentStore.write(
            text,
            key
        );


    if (!ok) {
        return {
            ok: false,
            key
        };
    }


    const index =
        readPackageIndex();

    const set = {};

    for (
        const missionId of index
    ) {
        set[missionId] = true;
    }

    set[pkg.missionId] = true;


    const newIndex =
        Object.keys(set)
            .sort();


    writePackageIndex(
        newIndex
    );


    return {
        ok: true,
        key,
        jsonLength:
            text.length
    };
}


export function loadRawPackage(
    missionId
) {
    const text =
        $persistentStore.read(
            storageKeyForMission(
                missionId
            )
        );


    if (!text) {
        return null;
    }


    const pkg =
        JSON.parse(text);


    validateRawPackage(pkg);

    return pkg;
}


/**
 * 导入外部 JSON 字符串。
 *
 * 后面 clipboard/file import 都可以最终调用这里。
 */
export function importRawPackageText(
    text
) {
    const pkg =
        JSON.parse(text);

    validateRawPackage(pkg);

    return saveRawPackage(pkg);
}