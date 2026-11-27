# PreSales Copilot — macOS Client ↔ Cloud Agent Wire Protocol (V1)

> 核心约束：原始音频 100% 在 Mac 本地经 Sherpa-ONNX (int8 SenseVoice) 转录，**严禁任何音频字节离开本机**。网络层仅传输纯文本分片、控制信令与问题卡片。

## 1. WebSocket 长连接 (`ws(s)://<host>/ws`)

连接参数（可选）：`?groupId=<groupId>&clientId=<clientId>`

### 1.1 Client → Cloud 消息

| `type` | 说明 | Payload 示例 |
|---|---|---|
| `subscribe` | 订阅/切换客户分组，云端立即下发该分组快照（阶段、历史字幕、最新问题卡片） | `{ "type": "subscribe", "groupId": "grp_xxx", "sessionId": "ses_xxx" }` |
| `segment` | 实时上行单条转写文本分片（含全局单调递增序号 `seq`） | `{ "type": "segment", "groupId": "grp_xxx", "sessionId": "ses_xxx", "segmentId": "seg_001", "seq": 1, "text": "...", "startedAt": 1730000000000, "endedAt": 1730000003200, "isFinal": true }` |
| `segment_batch` | 断线恢复后批量补传待传队列 | `{ "type": "segment_batch", "groupId": "grp_xxx", "segments": [ ... ] }` |
| `segment_edit` | 手动修正本地识别错误的文本并触发云端重算 | `{ "type": "segment_edit", "groupId": "grp_xxx", "segmentId": "seg_001", "text": "修正后文本" }` |
| `session_control` | 录音会话状态变更（start / pause / resume / end） | `{ "type": "session_control", "groupId": "grp_xxx", "sessionId": "ses_xxx", "action": "pause" }` |
| `ping` | 心跳保活 | `{ "type": "ping", "ts": 1730000000000 }` |

### 1.2 Cloud → Client 消息

| `type` | 说明 | Payload 关键字段 |
|---|---|---|
| `snapshot` | 订阅/重连后恢复该分组完整上下文与断点状态 | `group`, `checkpoint`, `segments`, `latestCard`, `bufferedSeqs` |
| `segment_ack` | 确认已接收/重排/暂存的分片序号 | `groupId`, `acceptedSeqs`, `bufferedSeqs`, `nextExpectedSeq`, `duplicateSeqs` |
| `question_card` | Mastra Agent 生成并通过自校验的问题卡片 | `card`: `{ id, groupId, stage, primaryQuestion, alternativeQuestions[2..4], riskTags, matchedSkills, analysis, validation, createdAt, latencyMs }` |
| `stage_updated` | S0-S5 阶段状态推进通知（严格不跳步） | `groupId`, `previousStage`, `currentStage`, `checkpoint` |
| `session_summary` | 结束会话后下发结构化纪要 | `summary`: `{ minutes, painPoints, confirmedBoundaries, unconfirmedItems, nextActions, markdown }` |
| `error` | 错误通知 | `code`, `message`, `recoverable` |
| `pong` | 心跳响应 | `ts` |

## 2. HTTP REST API（分组管理、断线补传与导出）

- `GET /api/health` — 健康检查（含 Mastra 与 DeepSeek 模式状态）
- `GET /api/skills` — 获取完整 7 大原则、9 大 Skill 与 S0-S5 状态机配置
- `GET /api/groups` — 客户分组列表
- `POST /api/groups` — 新建客户分组 `{ name, customerCompany, industry, notes }`
- `GET /api/groups/:groupId` — 获取分组详情、Checkpoint 状态快照、有序转写记录、最新问题卡片、最新纪要
- `PATCH /api/groups/:groupId` — 更新分组信息/客户画像
- `DELETE /api/groups/:groupId` — 删除分组
- `GET /api/groups/:groupId/segments` — 分页/全量获取有序文本分片
- `POST /api/groups/:groupId/segments` — HTTP 补传单条或批量文本分片（`{ segments: [...], triggerAnalyze?: boolean }`）
- `PATCH /api/groups/:groupId/segments` — 手动修正某条转写分片并可选重触发分析（`{ segmentId, text, reanalyze?: boolean }`）
- `POST /api/groups/:groupId/analyze` — 显式触发 Mastra 工作流生成问题卡片
- `POST /api/groups/:groupId/sessions` — 录音会话生命周期（`start` / `pause` / `resume` / `end`）
- `GET /api/groups/:groupId/summary` — 获取历史沟通纪要（支持 `?format=markdown` 导出）
- `POST /api/groups/:groupId/summary` — 触发 Mastra Summary Workflow 生成结构化纪要
