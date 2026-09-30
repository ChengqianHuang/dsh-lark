# Agent Note: Owned chat turns and explicit local access

Status: implemented

## Problem

A chat message can run tools against a local workspace and return their output to a group. An ambiguous sender policy exposes local capabilities, while selecting the last answer from an agent-wide idle interval can send an unrelated producer's answer to that group. Remote commands also need to interrupt work that cannot finish without local approval.

## Decision

The bridge requires a sender allowlist or an explicit allow-all choice. Group acceptance verifies the exact bot mention. All accepted chats share the configured workspace; separate hosts provide isolation. The selected or host-default agent preset supplies the tools, and the host's permission policy remains authoritative.

Each chat has a bounded queue and a single session binding. The submitted dsh user-message ID identifies the owned turn in the durable log. Reply extraction stops at that turn's end, and cancellation or failure supersedes partial text. Immediate control commands can inspect, cancel, clear, or reset bridge work without waiting behind it.

Plugin disposal owns asynchronous cleanup. It stops admission, cancels work, awaits session release, and requests event-consumer unsubscribe with stdin EOF. Deduplication is bounded in memory and survives only consumer restarts within the same plugin instance.

## Alternatives considered

**Unrestricted default access.** App visibility and chat membership can include people who are not trusted to use local tools. A required sender policy makes that trust choice explicit.

**Agent-wide idle plus the last answer.** The same agent can receive work from other producers. Message-ID correlation preserves the reply's owner even when those producers interleave turns.

**Queued control commands.** A command behind a task waiting for approval cannot stop that task. Control commands bypass ordinary work while retaining the same access checks.

**Force-killing the consumer.** The CLI may need to unregister a server-side subscription. Graceful closure preserves that cleanup at the cost of waiting for an unresponsive child.

## Consequences

The bridge provides accountable task/reply matching and limits pending work. It remains a trusted-user integration: chat separation does not isolate files, group replies are group-visible, and delivery is not exactly once. Restarting the plugin loses pending work and chat bindings. Live tenant permissions and network delivery require a separate authorized smoke test beyond the synthetic regression suite.
