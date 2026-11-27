# 售前智问分身（PreSales Copilot）

基于设计文档 V2.0 构建的完整售前沟通分身系统：**macOS 原生客户端（SwiftUI + AVAudioEngine + Sherpa-ONNX int8 SenseVoice）** + **云端 Agent 服务（Next.js + Mastra + DeepSeek API + LibSQL）**。

## 核心架构与特性

- **音频 100% 本地转写，零音频外传**：macOS 端通过 `AVAudioEngine` 采集 16kHz 单声道音频，经本地 `VADChunker` + `Sherpa-ONNX (int8 SenseVoice)` 完成中文流式转写，网络层仅传输纯文本分片。
- **云端 Mastra 编排引擎**：基于 `@mastra/core` Workflows & Agents + `@mastra/libsql` 构建完整状态图流水线：
  1. 文本分片乱序重排与空洞暂存（`sequence-manager.ts`）
  2. 分层上下文注入：近期对话 + 滚动摘要 + 向量语义召回 + 关键槽位（`vector-recall.ts`）
  3. 六维客户回答分析（跑偏/抽象/完整/矛盾/情绪/痛点清晰度）与阶段目标评估
  4. 策略路由：挂载 **7 大沟通原则 + 9 大 Skill 规则库 + S0–S5 严格有序状态机（禁止跳步）**
  5. 多候选问题生成（1 条高亮主问题 + 2–4 条备选问题 + 风险提示标签）
  6. Mastra `.dountil()` 自校验闭环（校验越阶段、重复提问、风险规则）
  7. 分组 Checkpoint 持久化与跨会话续接
  8. 会话结束自动生成结构化纪要（痛点清单、五项边界、待确认项、行动建议，支持复制与导出 Markdown/PDF）
- **实时双向通信**：自定义 Next.js + WebSocket (`/ws`) 网关 + HTTP 断线补传 REST API，支持涉密场景一键切换纯本地离线模式与手动编辑修正转写文本。

## 目录结构

```text
presales-copilot/
├── cloud/                  # Next.js 16 + Mastra 云端 Agent 服务与分栏 Web 联调台
│   ├── server.ts           # Next.js + WebSocket (/ws) 一体化服务入口
│   ├── src/lib/            # 领域模型、7原则/9Skill/S0-S5状态机、LibSQL存储、乱序重排、向量召回
│   ├── src/mastra/         # Mastra 实例、4 个专用 Agent、2 个编排 Workflow
│   ├── src/gateway/        # WebSocket 连接管理与分组房间广播
│   ├── src/app/            # REST API Routes & 分栏式实时控制台 UI
│   └── tests/              # 单元测试与端到端 API/WS 集成测试
├── macos/                  # macOS 14+ (Apple Silicon 优先) 原生客户端
│   ├── Package.swift       # Swift Package 定义
│   ├── project.yml         # XcodeGen 工程配置
│   ├── scripts/            # 下载 int8 SenseVoice 模型与 sherpa-onnx.xcframework 脚本
│   ├── Sources/CSherpaOnnx/# Sherpa-ONNX C API 桥接层
│   ├── Sources/PreSalesCore/# AVAudioEngine、VAD、Sherpa 引擎、离线待传队列、WS/HTTP 同步客户端
│   ├── Sources/PreSalesCopilotApp/ # SwiftUI 分栏界面、顶部工具栏、问题卡片、底部状态栏、纪要导出
│   └── Tests/PreSalesCoreTests/    # XCTest 单元测试
└── docs/protocol.md        # Mac ↔ Cloud WebSocket & HTTP 通信协议规范
```

## 快速启动

### 1. 云端服务（Next.js + Mastra）

```bash
cd cloud
cp .env.example .env
# 可选：在 .env 中填写 DEEPSEEK_API_KEY；留空则自动启用内置 Mastra 规则增强引擎（适合离线联调与测试）
npm install
npm run dev
```

访问 `http://localhost:3000` 打开云端分栏控制台（WebSocket 端点：`ws://localhost:3000/ws`）。

### 2. 运行自动化测试与类型/构建校验

```bash
cd cloud
npm run typecheck
npm test
npm run build
```

### 3. macOS 原生客户端（需在 macOS 14+ / Xcode 15.4+ 环境下构建）

```bash
cd macos
# 1) 下载 int8 SenseVoice 模型（约 150MB，存放在本机 Application Support）
./scripts/download-sensevoice-model.sh
# 2) 下载 sherpa-onnx macOS 通用框架（Apple Silicon arm64 + x86_64）
./scripts/setup-sherpa-onnx.sh
# 3) 运行单元测试或用 XcodeGen 生成 Xcode 工程
swift test
xcodegen generate && open PreSalesCopilot.xcodeproj
```
