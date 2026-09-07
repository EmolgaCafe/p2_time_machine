# Phoenix 2 Stage Tool

## Goal

保存 Phoenix 2 每日任务，并允许以后重新注入到当天 Daily 的第一个 slot。

当前只处理 Daily，不处理 Community。

---

## Verified

DailyStage 可独立替换。

一个可移植关卡目前只需要：

* field 2
* field 3
* field 14

已验证：

* Normal → Easy 成功
* 只替换 field 2 / 3 / 14 成功
* 目标其它 metadata 保留成功
* variable-length protobuf rebuild 成功
* 不需要 padding
* 不依赖固定长度

---

## Raw Package

格式：

```json
{
  "format": "p2stage-raw-v1",
  "missionId": "daily-commander/normal-3901",
  "field2": "...",
  "field3": "...",
  "field14": "..."
}
```

三个 field 使用 binary-safe encoding 保存。

`missionId` 仅用于识别来源。

---

## Project Files

```text
main.js
daily.js
package.js
injector.js
PROJECT_NOTES.md
```

### main.js

脚本入口。

负责选择当前功能：

* extract
* inject
* 后续 parse

### daily.js

负责：

* 找出 LoginResponse 中所有 Daily
* 提取指定 Daily
* protobuf DailyStage 相关读取

不处理 Community。

### package.js

负责：

* 创建 raw package
* package encode / decode
* import / export

### injector.js

负责：

* 加载一个 StagePackage
* 固定写入当前 Daily 第一个 slot
* 替换 field 2 / 3 / 14
* 重建 protobuf 长度
* 返回修改后的 response

不提供 target 选择。

---

## Roadmap

### Step 1

实现 Daily extractor：

输入 LoginResponse。

输出当天所有 Daily missionId：

```text
daily-commander/easy-3901
daily-commander/normal-3901
daily-commander/hard-3901
```

并能分别导出 raw package。

### Step 2

实现 raw package import / export。

实现：

```text
raw package
→
当前 Daily 第一个 slot
```

### Step 3

建立本地历史关卡保存方式。

### Step 4

解析 field 3 Lua。

目标：

```text
Lua
→
结构化 JSON
```

### Step 5

实现：

```text
JSON
→
Lua
```

允许修改和重建关卡。

---

## Current Stable Baseline

当前 no-padding injector 为稳定基线。

任何后续重构都必须保证：

```text
Normal
→
当前 Daily 第一个 slot
```

仍然能够正常运行，并且：

* 关卡内容正确
* title 正确
* protobuf 可正常解析
* 不需要 padding
