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
  function copySlice(buffer, start, end) {
    const out = new Uint8Array(
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
  function concatBytes(parts) {
    let total = 0;
    for (const part of parts) {
      total += part.length;
    }
    const out = new Uint8Array(total);
    let offset = 0;
    for (const part of parts) {
      out.set(
        part,
        offset
      );
      offset += part.length;
    }
    return out;
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
  function encodeVarint(value) {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new Error(
        `invalid varint value: ${value}`
      );
    }
    const out = [];
    do {
      let b = value % 128;
      value = Math.floor(
        value / 128
      );
      if (value > 0) {
        b |= 128;
      }
      out.push(b);
    } while (value > 0);
    return new Uint8Array(out);
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
  function findFirstDailySlot(buffer) {
    const stages = extractAllDailyStages(
      buffer
    );
    for (const stage of stages) {
      if (stage.missionId.includes(
        "/easy-"
      )) {
        return stage;
      }
    }
    return null;
  }
  function findTopLevelContainer(buffer, childStart, childEnd) {
    let pos = 0;
    while (pos < buffer.length) {
      const start = pos;
      const tagInfo = readVarint(
        buffer,
        pos
      );
      if (!tagInfo) {
        throw new Error(
          `bad root tag @${pos}`
        );
      }
      const tag = tagInfo.value;
      const wire = tag & 7;
      pos = tagInfo.next;
      let dataStart = null;
      let dataEnd = null;
      if (wire === 0) {
        const valueInfo = readVarint(
          buffer,
          pos
        );
        if (!valueInfo) {
          throw new Error(
            "bad root varint"
          );
        }
        pos = valueInfo.next;
      } else if (wire === 1) {
        pos += 8;
      } else if (wire === 2) {
        const lengthInfo = readVarint(
          buffer,
          pos
        );
        if (!lengthInfo) {
          throw new Error(
            "bad root length"
          );
        }
        dataStart = lengthInfo.next;
        dataEnd = dataStart + lengthInfo.value;
        pos = dataEnd;
      } else if (wire === 5) {
        pos += 4;
      } else {
        throw new Error(
          `unsupported root wire ${wire}`
        );
      }
      if (pos > buffer.length) {
        throw new Error(
          "root field exceeds response"
        );
      }
      if (wire === 2 && dataStart <= childStart && dataEnd >= childEnd) {
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
  function base64ToBytes(text) {
    const clean = text.replace(
      /\s+/g,
      ""
    );
    if (clean.length % 4 !== 0) {
      throw new Error(
        "invalid base64 length"
      );
    }
    const reverse = {};
    for (let i = 0; i < BASE64_TABLE.length; i++) {
      reverse[BASE64_TABLE[i]] = i;
    }
    const bytes = [];
    for (let i = 0; i < clean.length; i += 4) {
      const c1 = clean[i];
      const c2 = clean[i + 1];
      const c3 = clean[i + 2];
      const c4 = clean[i + 3];
      const v1 = reverse[c1];
      const v2 = reverse[c2];
      const v3 = c3 === "=" ? 0 : reverse[c3];
      const v4 = c4 === "=" ? 0 : reverse[c4];
      if (v1 === void 0 || v2 === void 0 || c3 !== "=" && v3 === void 0 || c4 !== "=" && v4 === void 0) {
        throw new Error(
          "invalid base64 character"
        );
      }
      const n = v1 << 18 | v2 << 12 | v3 << 6 | v4;
      bytes.push(
        n >>> 16 & 255
      );
      if (c3 !== "=") {
        bytes.push(
          n >>> 8 & 255
        );
      }
      if (c4 !== "=") {
        bytes.push(
          n & 255
        );
      }
    }
    return new Uint8Array(
      bytes
    );
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
  function decodeRawPackage(pkg) {
    validateRawPackage(pkg);
    return {
      missionId: pkg.missionId,
      field2: base64ToBytes(
        pkg.field2
      ),
      field3: base64ToBytes(
        pkg.field3
      ),
      field14: base64ToBytes(
        pkg.field14
      )
    };
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
  function loadRawPackage(missionId) {
    const text = $persistentStore.read(
      storageKeyForMission(
        missionId
      )
    );
    if (!text) {
      return null;
    }
    const pkg = JSON.parse(text);
    validateRawPackage(pkg);
    return pkg;
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

  // src/injector.js
  function buildInjectedPayload(targetPayload, rawPackage) {
    const targetFields = parseFields(
      targetPayload
    );
    let count2 = 0;
    let count3 = 0;
    let count14 = 0;
    const parts = [];
    for (const field of targetFields) {
      if (field.fieldNo === 2 && field.wire === 2) {
        count2++;
        parts.push(
          encodeVarint(
            field.tag
          )
        );
        parts.push(
          encodeVarint(
            rawPackage.field2.length
          )
        );
        parts.push(
          rawPackage.field2
        );
      } else if (field.fieldNo === 3 && field.wire === 2) {
        count3++;
        parts.push(
          encodeVarint(
            field.tag
          )
        );
        parts.push(
          encodeVarint(
            rawPackage.field3.length
          )
        );
        parts.push(
          rawPackage.field3
        );
      } else if (field.fieldNo === 14 && field.wire === 2) {
        count14++;
        parts.push(
          encodeVarint(
            field.tag
          )
        );
        parts.push(
          encodeVarint(
            rawPackage.field14.length
          )
        );
        parts.push(
          rawPackage.field14
        );
      } else {
        parts.push(
          copySlice(
            targetPayload,
            field.start,
            field.end
          )
        );
      }
    }
    if (count2 !== 1 || count3 !== 1 || count14 !== 1) {
      throw new Error(
        `unexpected target structure: f2=${count2}, f3=${count3}, f14=${count14}`
      );
    }
    return concatBytes(parts);
  }
  function injectToFirstDailySlot(responseBody, pkg) {
    const rawPackage = decodeRawPackage(pkg);
    const target = findFirstDailySlot(
      responseBody
    );
    if (!target) {
      throw new Error(
        "current Daily first slot not found"
      );
    }
    const targetPayload = responseBody.subarray(
      target.payloadStart,
      target.payloadEnd
    );
    const newTargetPayload = buildInjectedPayload(
      targetPayload,
      rawPackage
    );
    const newTargetWrapper = concatBytes([
      encodeVarint(
        target.outerTag
      ),
      encodeVarint(
        newTargetPayload.length
      ),
      newTargetPayload
    ]);
    const container = findTopLevelContainer(
      responseBody,
      target.outerStart,
      target.outerEnd
    );
    if (!container) {
      throw new Error(
        "top-level Daily container not found"
      );
    }
    const oldContainerPayload = responseBody.subarray(
      container.dataStart,
      container.dataEnd
    );
    const relativeStart = target.outerStart - container.dataStart;
    const relativeEnd = target.outerEnd - container.dataStart;
    if (relativeStart < 0 || relativeEnd > oldContainerPayload.length || relativeStart >= relativeEnd) {
      throw new Error(
        "invalid target wrapper boundary"
      );
    }
    const newContainerPayload = concatBytes([
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
    const newContainerField = concatBytes([
      encodeVarint(
        container.tag
      ),
      encodeVarint(
        newContainerPayload.length
      ),
      newContainerPayload
    ]);
    const finalBody = concatBytes([
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
    const rebuiltTarget = locateDailyStage(
      finalBody,
      target.missionId
    );
    if (!rebuiltTarget) {
      throw new Error(
        "sanity check failed: rebuilt target not found"
      );
    }
    return {
      body: finalBody,
      targetMissionId: target.missionId,
      sourceMissionId: rawPackage.missionId,
      oldSize: responseBody.length,
      newSize: finalBody.length,
      oldTargetPayloadSize: target.payloadLength,
      newTargetPayloadSize: newTargetPayload.length
    };
  }
  var init_injector = __esm({
    "src/injector.js"() {
      init_daily();
      init_package();
    }
  });

  // main.js
  var require_main = __commonJS({
    "main.js"() {
      init_daily();
      init_package();
      init_injector();
      var CONTROL_KEY = "p2";
      var RECORD_COMMAND = "record";
      var TAG = "[P2-StageTool]";
      (function() {
        "use strict";
        function log(message) {
          console.log(
            `${TAG} ${message}`
          );
        }
        function notify(subtitle, body = "") {
          $notification.post(
            "Phoenix 2 Stage Tool",
            subtitle,
            body
          );
        }
        function finishUnmodified() {
          $done({});
        }
        let control = $persistentStore.read(
          CONTROL_KEY
        );
        if (typeof control === "string") {
          control = control.trim();
        } else {
          control = "";
        }
        if (!control) {
          log(
            "IDLE: p2 \u4E3A\u7A7A"
          );
          notify(
            "\u7A7A\u95F2\u72B6\u6001",
            "p2 \u4E3A\u7A7A\uFF0C\u672C\u6B21\u4E0D\u8BB0\u5F55\u3001\u4E0D\u6CE8\u5165"
          );
          finishUnmodified();
          return;
        }
        if (!$response || !$response.body) {
          log(
            "\u274C \u6CA1\u6709\u83B7\u53D6\u5230 response body"
          );
          notify(
            "\u6267\u884C\u5931\u8D25",
            "\u6CA1\u6709\u83B7\u53D6\u5230 LoginResponse"
          );
          finishUnmodified();
          return;
        }
        const buffer = asUint8Array(
          $response.body
        );
        if (!buffer) {
          log(
            "\u274C response body \u4E0D\u662F\u4E8C\u8FDB\u5236\u6570\u636E"
          );
          notify(
            "\u6267\u884C\u5931\u8D25",
            "\u8BF7\u786E\u8BA4 binary-body-mode=true"
          );
          finishUnmodified();
          return;
        }
        log(
          `control="${control}", LoginResponse=${buffer.length} B`
        );
        if (control.toLowerCase() === RECORD_COMMAND) {
          runRecord(
            buffer
          );
          return;
        }
        runReplay(
          buffer,
          control
        );
        function runRecord(responseBody) {
          log(
            "MODE=RECORD"
          );
          let stages;
          try {
            stages = extractAllDailyStages(
              responseBody
            );
          } catch (e) {
            log(
              `\u274C Daily \u63D0\u53D6\u5931\u8D25: ` + e.message
            );
            notify(
              "\u8BB0\u5F55\u5931\u8D25",
              e.message
            );
            finishUnmodified();
            return;
          }
          if (stages.length === 0) {
            log(
              "\u274C \u6CA1\u6709\u53D1\u73B0 DailyStage"
            );
            notify(
              "\u8BB0\u5F55\u5931\u8D25",
              "LoginResponse \u4E2D\u6CA1\u6709\u627E\u5230 DailyStage"
            );
            finishUnmodified();
            return;
          }
          const saved = [];
          const failed = [];
          for (const stage of stages) {
            try {
              const pkg = createRawPackage(
                stage
              );
              const result = saveRawPackage(
                pkg
              );
              if (!result.ok) {
                failed.push(
                  stage.missionId
                );
                log(
                  `\u274C \u4FDD\u5B58\u5931\u8D25: ` + stage.missionId
                );
                continue;
              }
              saved.push(
                stage.missionId
              );
              log(
                `\u2705 RECORD ${stage.missionId} | Lua ${stage.field3.length} B`
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
            let body = saved.join("\n");
            if (failed.length > 0) {
              body += `

\u5931\u8D25 ${failed.length} \u4E2A`;
            }
            notify(
              `RECORD\uFF1A\u5DF2\u4FDD\u5B58 ${saved.length} \u4E2A Daily`,
              body
            );
          } else {
            notify(
              "RECORD\uFF1A\u6CA1\u6709\u4FDD\u5B58\u6210\u529F",
              `\u5931\u8D25 ${failed.length} \u4E2A\u4EFB\u52A1`
            );
          }
          finishUnmodified();
        }
        function runReplay(responseBody, missionId) {
          log(
            `MODE=REPLAY: ${missionId}`
          );
          let pkg;
          try {
            pkg = loadRawPackage(
              missionId
            );
          } catch (e) {
            log(
              `\u274C Package \u8BFB\u53D6\u5F02\u5E38: ` + e.message
            );
            notify(
              "\u4EFB\u52A1\u8BFB\u53D6\u5931\u8D25",
              `${missionId}
${e.message}`
            );
            finishUnmodified();
            return;
          }
          if (!pkg) {
            log(
              `\u26A0\uFE0F \u672A\u627E\u5230\u5386\u53F2\u4EFB\u52A1: ` + missionId
            );
            notify(
              "\u672A\u627E\u5230\u5386\u53F2\u4EFB\u52A1",
              `${missionId}
\u672C\u6B21\u4E0D\u4FEE\u6539 Daily`
            );
            finishUnmodified();
            return;
          }
          log(
            `\u2705 \u627E\u5230 Package: ` + pkg.missionId
          );
          let result;
          try {
            result = injectToFirstDailySlot(
              responseBody,
              pkg
            );
          } catch (e) {
            log(
              `\u274C \u6CE8\u5165\u5931\u8D25: ` + e.message
            );
            notify(
              "\u6CE8\u5165\u5931\u8D25",
              `${missionId}
${e.message}`
            );
            finishUnmodified();
            return;
          }
          const headers = {};
          if ($response.headers) {
            for (const key in $response.headers) {
              const lower = key.toLowerCase();
              if (lower === "content-length" || lower === "content-encoding") {
                continue;
              }
              headers[key] = $response.headers[key];
            }
          }
          headers["Content-Length"] = String(
            result.body.length
          );
          log(
            `\u2705 REPLAY SUCCESS`
          );
          log(
            `source: ` + result.sourceMissionId
          );
          log(
            `target: ` + result.targetMissionId
          );
          log(
            `DailyStage: ${result.oldTargetPayloadSize} -> ${result.newTargetPayloadSize}`
          );
          log(
            `HTTP body: ${result.oldSize} -> ${result.newSize}`
          );
          notify(
            "REPLAY\uFF1A\u6CE8\u5165\u6210\u529F",
            `${result.sourceMissionId}
\u2193
${result.targetMissionId}`
          );
          $done({
            body: result.body,
            headers
          });
        }
      })();
    }
  });
  require_main();
})();
