# Calmnova Code Design V1 — Latest QA

2026-09-07。最新判定：**passed with known limitations**（最终验收结论：**PASS WITH KNOWN LIMITATIONS**）。

本记录取代早先将 Terminal 计入阻塞项的判定。Terminal requires separate PTY/session capability work；本轮不以 Terminal 为 blocker。

完整结论、已知限制、测试与截图见 [最终验收报告](docs/design-v1/final-acceptance.md)；[本轮截图图集](docs/design-v1/final-screenshots/index.html)。未 commit、未 push。

- Diff 根因是整文件伪补丁，已改为真实 Git hunks；另修复 header-like 内容误分类与 1400 行截断影响统计。实际返回的 32 个文件全部与 Git numstat 一致。
- 核心界面、窄窗、125/150/200% 原生缩放与主要键盘路径已操作复核；21 项主截图均为本轮证据。
- 05 为真正执行中的工具补拍；21 为明确标注的 Provider 测试状态。未造假连接或 Terminal。
- 设计源为用户提供的整板及 A/B/C 局部；已生成组合对照并查看关键布局、状态、菜单、设置和 responsive 图。源小窗逻辑尺寸未知，不作像素级一致声明。
- 已知限制：有界 Diff 预览、失败检查时间缺失、短答案时活动块稍重、旧设置控件与英文说明、未做完整 VoiceOver/对比度认证。
- 相关套件 102 项通过；Provider 展示断言补充 14 项通过；lint/typecheck/build/branding/diff check 通过。首次本地测试服务器被沙箱阻止，权限通过后重试成功，保留原始日志。
