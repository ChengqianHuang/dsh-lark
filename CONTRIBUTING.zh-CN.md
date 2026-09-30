# 参与贡献

[English](CONTRIBUTING.md) | 简体中文

欢迎提交可复现的缺陷、入门指南改进、针对性测试，以及聊天控制或投递方面的改进。提出大型功能前，请先说明用户问题和一个可观察的结果。

## 本地开发

使用 Node.js `^22.19.0 || >=24.0.0` 和 [package.json](package.json) 中记录的 pnpm 版本。依赖固定到支持的 dsh 版本，可在 harness 仓库之外开发本项目。

```sh
pnpm install --frozen-lockfile
pnpm check
```

`pnpm check` 执行类型检查、测试、构建以及包和导入检查。测试使用合成飞书事件和模拟子进程，不需要应用凭据或真实聊天账号。真实租户冒烟验证是独立步骤，发送消息前必须获得明确授权。

试用本地修改时，运行 `pnpm build`，按[快速开始](README.zh-CN.md#use-this-package)链接插件目录，并重启宿主。手动测试请使用专用机器人和工作区。

## 准备改动

每个 pull request 聚焦一个用户可见结果。修复缺陷时添加能暴露问题的回归用例；修改异步代码时覆盖取消与清理。测试使用事件同步，并等待每个测试创建的子进程和会话完成退出。

同步更新受影响的中英文文档。在用户依赖的位置说明配置默认值和资源归属。重要设计决策记录到 `.agents/notes/implemented/<kind>/`，包含问题、决定、考虑过的替代方案与后果。构建产物和凭据不要提交到 Git。

提交 pull request 前运行 `pnpm check` 和 `git diff --check`。描述中说明最终行为、实际运行过的检查，以及尚未验证的真实环境行为。不要仅凭模拟测试就宣称租户集成通过。

## 报告缺陷或建议功能

使用 [issue 表单](https://github.com/ChengqianHuang/dsh-lark/issues/new/choose)。缺陷请提供版本和最小脱敏配置；功能建议请说明聊天流程和期望结果。涉及安全的信息请通过 [SECURITY.md](SECURITY.zh-CN.md) 中的渠道报告。

## 本地打包

```sh
pnpm pack
```

压缩包包含构建后的插件和 profile patch，可用 `dsh plugin --profile web add /absolute/path/to/dsh-lark-<version>.tgz` 安装。发布版本或软件包需维护者批准；仓库的检查工作流不会发布。
