(() => {
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __esm = (fn, res, err) => function __init() {
    if (err) throw err[0];
    try {
      return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
    } catch (e) {
      throw err = [e], e;
    }
  };
  var __commonJS = (cb, mod) => function __require() {
    try {
      return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
    } catch (e) {
      throw mod = 0, e;
    }
  };

  // src/daily.js
  function asUint8Array(body) {
    if (body instanceof Uint8Array) {
      return body;
    }
    if (body instanceof ArrayBuffer) {
      return new Uint8Array(body);
    }
    if (body && body.buffer instanceof ArrayBuffer) {
      const offset = body.byteOffset || 0;
      const length = body.byteLength || body.buffer.byteLength - offset;
      return new Uint8Array(
        body.buffer,
        offset,
        length
      );
    }
    return null;
  }
  function asciiBytes(text) {
    const out = new Uint8Array(
      text.length
    );
    for (let i = 0; i < text.length; i++) {
      const c = text.charCodeAt(i);
      if (c > 127) {
        throw new Error(
          "asciiBytes received non-ASCII text"
        );
      }
      out[i] = c;
    }
    return out;
  }
  function asciiString(bytes) {
    let out = "";
    for (let i = 0; i < bytes.length; i++) {
      out += String.fromCharCode(
        bytes[i]
      );
    }
    return out;
  }
  function findBytes(buffer, needle, from = 0) {
    outer:
      for (let i = from; i <= buffer.length - needle.length; i++) {
        for (let j = 0; j < needle.length; j++) {
          if (buffer[i + j] !== needle[j]) {
            continue outer;
          }
        }
        return i;
      }
    return -1;
  }
  function readVarint(buffer, pos, limit = buffer.length) {
    let value = 0;
    let shift = 0;
    while (pos < limit && shift <= 49) {
      const b = buffer[pos++];
      value += (b & 127) * Math.pow(
        2,
        shift
      );
      if ((b & 128) === 0) {
        return {
          value,
          next: pos
        };
      }
      shift += 7;
    }
    return null;
  }
  function parseFields(message) {
    const fields = [];
    let pos = 0;
    while (pos < message.length) {
      const start = pos;
      const tagInfo = readVarint(
        message,
        pos
      );
      if (!tagInfo) {
        throw new Error(
          `bad protobuf tag @ ${pos}`
        );
      }
      const tag = tagInfo.value;
      const fieldNo = Math.floor(
        tag / 8
      );
      const wire = tag & 7;
      pos = tagInfo.next;
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
        const valueInfo = readVarint(
          message,
          pos
        );
        if (!valueInfo) {
          throw new Error(
            `bad varint field ${fieldNo}`
          );
        }
        field.value = valueInfo.value;
        pos = valueInfo.next;
      } else if (wire === 1) {
        pos += 8;
      } else if (wire === 2) {
        const lengthInfo = readVarint(
          message,
          pos
        );
        if (!lengthInfo) {
          throw new Error(
            `bad length field ${fieldNo}`
          );
        }
        pos = lengthInfo.next;
        field.length = lengthInfo.value;
        field.dataStart = pos;
        field.dataEnd = pos + field.length;
        pos = field.dataEnd;
      } else if (wire === 5) {
        pos += 4;
      } else {
        throw new Error(
          `unsupported protobuf wire type ${wire}`
        );
      }
      if (pos > message.length) {
        throw new Error(
          `field ${fieldNo} exceeds message boundary`
        );
      }
      field.end = pos;
      fields.push(field);
    }
    return fields;
  }
  function getLengthField(message, fields, fieldNo) {
    for (const field of fields) {
      if (field.fieldNo === fieldNo && field.wire === 2) {
        return {
          field,
          data: message.subarray(
            field.dataStart,
            field.dataEnd
          ),
          raw: message.subarray(
            field.start,
            field.end
          )
        };
      }
    }
    return null;
  }
  function locateDailyStage(buffer, missionId) {
    const idBytes = asciiBytes(
      missionId
    );
    let searchFrom = 0;
    const candidates = [];
    while (true) {
      const idPos = findBytes(
        buffer,
        idBytes,
        searchFrom
      );
      if (idPos < 0) {
        break;
      }
      searchFrom = idPos + 1;
      let payloadStart = -1;
      for (let p = Math.max(
        0,
        idPos - 6
      ); p < idPos; p++) {
        if (buffer[p] !== 10) {
          continue;
        }
        const lengthInfo = readVarint(
          buffer,
          p + 1,
          idPos
        );
        if (lengthInfo && lengthInfo.next === idPos && lengthInfo.value === idBytes.length) {
          payloadStart = p;
          break;
        }
      }
      if (payloadStart < 0) {
        continue;
      }
      let outerStart = -1;
      let outerTag = -1;
      let payloadLength = -1;
      for (let p = Math.max(
        0,
        payloadStart - 8
      ); p < payloadStart; p++) {
        const tagInfo = readVarint(
          buffer,
          p,
          payloadStart
        );
        if (!tagInfo || (tagInfo.value & 7) !== 2) {
          continue;
        }
        const lengthInfo = readVarint(
          buffer,
          tagInfo.next,
          payloadStart
        );
        if (!lengthInfo || lengthInfo.next !== payloadStart) {
          continue;
        }
        if (payloadStart + lengthInfo.value > buffer.length) {
          continue;
        }
        outerStart = p;
        outerTag = tagInfo.value;
        payloadLength = lengthInfo.value;
      }
      if (outerStart < 0) {
        continue;
      }
      const payloadEnd = payloadStart + payloadLength;
      const payload = buffer.subarray(
        payloadStart,
        payloadEnd
      );
      try {
        const fields = parseFields(payload);
        const f1 = getLengthField(
          payload,
          fields,
          1
        );
        const f2 = getLengthField(
          payload,
          fields,
          2
        );
        const f3 = getLengthField(
          payload,
          fields,
          3
        );
        const f14 = getLengthField(
          payload,
          fields,
          14
        );
        if (!f1 || !f2 || !f3 || !f14) {
          continue;
        }
        if (asciiString(
          f1.data
        ) !== missionId) {
          continue;
        }
        const stageId = asciiString(
          f2.data
        );
        if (!stageId.startsWith(
          "stage."
        )) {
          continue;
        }
        if (f3.data.length < MIN_LUA_SIZE) {
          continue;
        }
        if (findBytes(
          f3.data,
          asciiBytes(
            "load_stage({"
          ),
          0
        ) < 0) {
          continue;
        }
        candidates.push({
          missionId,
          outerStart,
          outerTag,
          outerEnd: payloadEnd,
          payloadStart,
          payloadEnd,
          payloadLength,
          stageId,
          luaLength: f3.data.length,
          field2: f2.data,
          field3: f3.data,
          field14: f14.data
        });
      } catch (e) {
      }
    }
    if (candidates.length === 0) {
      return null;
    }
    candidates.sort(
      (a, b) => b.luaLength - a.luaLength
    );
    return candidates[0];
  }
  function discoverDailyMissionIds(buffer) {
    const prefix = asciiBytes(
      "daily-"
    );
    const seen = {};
    let from = 0;
    while (true) {
      const start = findBytes(
        buffer,
        prefix,
        from
      );
      if (start < 0) {
        break;
      }
      from = start + prefix.length;
      let end = start;
      while (end < buffer.length) {
        const c = buffer[end];
        const digit = c >= 48 && c <= 57;
        const upper = c >= 65 && c <= 90;
        const lower = c >= 97 && c <= 122;
        const punctuation = c === 45 || // -
        c === 95 || // _
        c === 47 || // /
        c === 43 || // +
        c === 46;
        if (!(digit || upper || lower || punctuation)) {
          break;
        }
        end++;
      }
      if (end > start) {
        const missionId = asciiString(
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
  function extractAllDailyStages(buffer) {
    const ids = discoverDailyMissionIds(
      buffer
    );
    const stages = [];
    for (const missionId of ids) {
      const stage = locateDailyStage(
        buffer,
        missionId
      );
      if (stage) {
        stages.push(stage);
      }
    }
    stages.sort(
      (a, b) => a.missionId.localeCompare(
        b.missionId
      )
    );
    return stages;
  }
  var MIN_LUA_SIZE;
  var init_daily = __esm({
    "src/daily.js"() {
      MIN_LUA_SIZE = 1e4;
    }
  });

  // src/package.js
  function bytesToBase64(bytes) {
    let out = "";
    let i = 0;
    while (i + 2 < bytes.length) {
      const n = bytes[i] << 16 | bytes[i + 1] << 8 | bytes[i + 2];
      out += BASE64_TABLE[n >>> 18 & 63];
      out += BASE64_TABLE[n >>> 12 & 63];
      out += BASE64_TABLE[n >>> 6 & 63];
      out += BASE64_TABLE[n & 63];
      i += 3;
    }
    const remain = bytes.length - i;
    if (remain === 1) {
      const n = bytes[i] << 16;
      out += BASE64_TABLE[n >>> 18 & 63];
      out += BASE64_TABLE[n >>> 12 & 63];
      out += "==";
    } else if (remain === 2) {
      const n = bytes[i] << 16 | bytes[i + 1] << 8;
      out += BASE64_TABLE[n >>> 18 & 63];
      out += BASE64_TABLE[n >>> 12 & 63];
      out += BASE64_TABLE[n >>> 6 & 63];
      out += "=";
    }
    return out;
  }
  function createRawPackage(stage) {
    return {
      format: PACKAGE_FORMAT,
      missionId: stage.missionId,
      field2: bytesToBase64(
        stage.field2
      ),
      field3: bytesToBase64(
        stage.field3
      ),
      field14: bytesToBase64(
        stage.field14
      )
    };
  }
  function validateRawPackage(pkg) {
    if (!pkg || typeof pkg !== "object") {
      throw new Error(
        "package is not an object"
      );
    }
    if (pkg.format !== PACKAGE_FORMAT) {
      throw new Error(
        `unsupported package format: ${pkg.format}`
      );
    }
    if (typeof pkg.missionId !== "string" || !pkg.missionId.startsWith(
      "daily-"
    )) {
      throw new Error(
        "invalid missionId"
      );
    }
    for (const name of [
      "field2",
      "field3",
      "field14"
    ]) {
      if (typeof pkg[name] !== "string") {
        throw new Error(
          `missing ${name}`
        );
      }
    }
    return true;
  }
  function storageKeyForMission(missionId) {
    return STORAGE_PREFIX + missionId;
  }
  function readPackageIndex() {
    const raw = $persistentStore.read(
      INDEX_KEY
    );
    if (!raw) {
      return [];
    }
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(
        parsed
      ) ? parsed : [];
    } catch (e) {
      return [];
    }
  }
  function writePackageIndex(index) {
    return $persistentStore.write(
      JSON.stringify(index),
      INDEX_KEY
    );
  }
  function saveRawPackage(pkg) {
    validateRawPackage(pkg);
    const key = storageKeyForMission(
      pkg.missionId
    );
    const text = JSON.stringify(pkg);
    const ok = $persistentStore.write(
      text,
      key
    );
    if (!ok) {
      return {
        ok: false,
        key
      };
    }
    const index = readPackageIndex();
    const set = {};
    for (const missionId of index) {
      set[missionId] = true;
    }
    set[pkg.missionId] = true;
    const newIndex = Object.keys(set).sort();
    writePackageIndex(
      newIndex
    );
    return {
      ok: true,
      key,
      jsonLength: text.length
    };
  }
  var PACKAGE_FORMAT, STORAGE_PREFIX, INDEX_KEY, BASE64_TABLE;
  var init_package = __esm({
    "src/package.js"() {
      PACKAGE_FORMAT = "p2stage-raw-v1";
      STORAGE_PREFIX = "p2stage.raw.";
      INDEX_KEY = "p2stage.raw.index";
      BASE64_TABLE = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    }
  });

  // main.js
  var require_main = __commonJS({
    "main.js"() {
      init_daily();
      init_package();
      (function() {
        "use strict";
        const TAG = "[P2-StageTool]";
        function log(message) {
          console.log(
            `${TAG} ${message}`
          );
        }
        function stop(message) {
          log(
            `\u274C ${message}`
          );
          $done({});
        }
        const body = $response.body;
        if (!body) {
          stop(
            "\u6CA1\u6709\u83B7\u53D6\u5230 /login response body"
          );
          return;
        }
        const buffer = asUint8Array(body);
        if (!buffer) {
          stop(
            "response body \u4E0D\u662F\u4E8C\u8FDB\u5236\u6570\u636E\uFF1B\u8BF7\u542F\u7528 binary-body-mode=true"
          );
          return;
        }
        log(
          `\u626B\u63CF LoginResponse: ${buffer.length} bytes`
        );
        let stages;
        try {
          stages = extractAllDailyStages(
            buffer
          );
        } catch (e) {
          stop(
            `Daily \u63D0\u53D6\u5931\u8D25: ` + e.message
          );
          return;
        }
        if (stages.length === 0) {
          stop(
            "\u6CA1\u6709\u53D1\u73B0\u771F\u6B63\u7684 DailyStage"
          );
          return;
        }
        const saved = [];
        const failed = [];
        for (const stage of stages) {
          try {
            const pkg = createRawPackage(
              stage
            );
            const result = saveRawPackage(pkg);
            if (!result.ok) {
              failed.push(
                stage.missionId
              );
              log(
                `\u274C \u4FDD\u5B58\u5931\u8D25: ` + stage.missionId
              );
              continue;
            }
            saved.push({
              missionId: stage.missionId,
              luaBytes: stage.field3.length,
              packageChars: result.jsonLength
            });
            log(
              `\u2705 ${stage.missionId} | Lua ${stage.field3.length} B | package ${result.jsonLength} chars`
            );
          } catch (e) {
            failed.push(
              stage.missionId
            );
            log(
              `\u274C ${stage.missionId}: ` + e.message
            );
          }
        }
        if (saved.length > 0) {
          const names = saved.map(
            (item) => item.missionId
          ).join("\n");
          $notification.post(
            "Phoenix 2 Stage Tool",
            `\u5DF2\u4FDD\u5B58 ${saved.length} \u4E2A DailyStage`,
            names
          );
        }
        if (failed.length > 0) {
          log(
            `\u26A0\uFE0F ${failed.length} \u4E2A DailyStage \u4FDD\u5B58\u5931\u8D25`
          );
        }
        $done({});
      })();
    }
  });
  require_main();
})();
