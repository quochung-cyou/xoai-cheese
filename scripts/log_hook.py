#!/usr/bin/env python3
"""
Shared AI hook logger — works with Claude Code, Gemini CLI, Codex, Cursor, Copilot.
Reads JSON from stdin, normalizes to common format, appends to .ai-log/session.jsonl
"""
import json
import os
import sys
import subprocess
from datetime import datetime, timezone, timedelta
from pathlib import Path

VN_TZ = timezone(timedelta(hours=7))


def git(cmd):
    try:
        return subprocess.check_output(cmd, shell=True, text=True, stderr=subprocess.DEVNULL).strip()
    except Exception:
        return ""


# Giới hạn phía client; server còn cắt lại (tool_response 4000, tool_input 16KB).
RESPONSE_LIMIT = 4000
SUMMARY_LIMIT = 4000
ERROR_LIMIT = 2000
INPUT_FIELD_LIMIT = 4000


def text(value, limit: int) -> str:
    """Stringify a hook value (dict/list -> JSON) and cut it to `limit` chars."""
    if value is None:
        return ""
    if not isinstance(value, str):
        value = json.dumps(value, ensure_ascii=False)
    return value[:limit]


def shrink(value):
    """Cut long leaf strings (e.g. a whole file in Write/Edit input), keep the shape."""
    if isinstance(value, str):
        return value if len(value) <= INPUT_FIELD_LIMIT else value[:INPUT_FIELD_LIMIT] + "...[truncated]"
    if isinstance(value, dict):
        return {k: shrink(v) for k, v in value.items()}
    if isinstance(value, list):
        return [shrink(v) for v in value]
    return value


def tool_call(name, tool_input, response, error=None, tool_use_id=None, duration_ms=None) -> dict:
    """Common shape for one tool call, whatever the AI tool calls its fields."""
    if tool_input is not None and not isinstance(tool_input, dict):
        tool_input = {"value": tool_input}
    out = {
        "tool_name": name or "",
        "tool_input": shrink(tool_input) if tool_input else None,
        "tool_response": text(response, RESPONSE_LIMIT),
        "tool_error": text(error, ERROR_LIMIT),
    }
    if tool_use_id:
        out["tool_use_id"] = tool_use_id
    if duration_ms is not None:
        out["duration_ms"] = duration_ms
    return out


def detect_tool(data: dict) -> str:
    """Detect which AI tool sent this hook event.

    Priority:
      1. --tool=NAME CLI argument (cross-platform: works in cmd.exe, PowerShell, bash)
      2. AI_TOOL_NAME env var (legacy, bash-only when set inline)
      3. Heuristics from payload shape
    """
    for arg in sys.argv[1:]:
        if arg.startswith("--tool="):
            return arg.split("=", 1)[1].lower()
    tool_env = os.environ.get("AI_TOOL_NAME", "").lower()
    if tool_env:
        return tool_env
    # Heuristics
    if "transcript_path" in data:
        return "codex"
    if data.get("hook_event_name", "").startswith(("Before", "After", "Session", "Pre", "Notification")):
        return "gemini"
    if data.get("hook_event_name", "")[0:1].islower():
        # camelCase event names → Cursor or Copilot
        if "workspace_roots" in data:
            return "cursor"
        if "toolName" in data:
            return "copilot"
    if "hook_event_name" in data:
        return "claude"
    return "unknown"


def normalize(data: dict, tool: str) -> dict | None:
    """Normalize tool-specific payload to common log entry."""
    event = data.get("hook_event_name") or data.get("event", "")
    ts = datetime.now(VN_TZ).isoformat()

    # Resolve repo from git origin. When cwd is not a git working tree (or
    # origin isn't set), skip the event entirely — these entries can't be
    # tied back to a team on the server and would just clutter the pending
    # queue forever.
    origin = git("git remote get-url origin")
    if not origin:
        return None
    repo = origin.rstrip("/").split("/")[-1]
    if repo.endswith(".git"):
        repo = repo[:-4]

    base = {
        "ts": ts,
        "tool": tool,
        "event": event,
        "session_id": (
            data.get("session_id") or
            data.get("conversation_id") or
            data.get("generation_id") or ""
        ),
        "model": data.get("model", ""),
        "repo": repo,
        "branch": git("git rev-parse --abbrev-ref HEAD"),
        "commit": git("git rev-parse --short HEAD"),
        "student": git("git config user.email"),
    }

    if tool == "claude":
        if event == "UserPromptSubmit":
            base["prompt"] = data.get("prompt", "")[:1000]
        elif event in ("PostToolUse", "PostToolUseFailure"):
            err = data.get("tool_error") or data.get("error")
            base.update(tool_call(
                data.get("tool_name"), data.get("tool_input"), data.get("tool_response"),
                error=err.get("message") if isinstance(err, dict) else err,
                tool_use_id=data.get("tool_use_id"),
            ))
        elif event in ("Stop", "SubagentStop"):
            base["response_summary"] = text(data.get("last_assistant_message"), SUMMARY_LIMIT)
            base["stop_reason"] = data.get("stop_reason", "")
        elif event == "SessionStart":
            base["source"] = data.get("source", "")

    elif tool == "gemini":
        if event == "BeforeAgent":
            base["prompt"] = data.get("prompt", "")[:1000]
        elif event == "AfterTool":
            resp = data.get("tool_response")
            err = None
            if isinstance(resp, dict):
                err = resp.get("error")
                resp = resp.get("returnDisplay") or resp.get("llmContent")
            base.update(tool_call(
                data.get("tool_name"), data.get("tool_input"), resp,
                error=err.get("message") if isinstance(err, dict) else err,
            ))
        elif event == "AfterAgent":
            base["response_summary"] = text(data.get("prompt_response"), SUMMARY_LIMIT)

    elif tool == "codex":
        base.update({
            "turn_id": data.get("turn_id", ""),
            "transcript_path": data.get("transcript_path", ""),
        })
        if event == "UserPromptSubmit":
            base["prompt"] = data.get("prompt", "")[:1000]
        elif event == "PostToolUse":
            base.update(tool_call(
                data.get("tool_name"), data.get("tool_input"), data.get("tool_response"),
                tool_use_id=data.get("tool_use_id"),
            ))
        elif event == "Stop":
            base["response_summary"] = text(data.get("last_assistant_message"), SUMMARY_LIMIT)

    elif tool == "cursor":
        if event == "beforeSubmitPrompt":
            base.update({
                "prompt": data.get("prompt", "")[:1000],
                "files_context": data.get("attachments", []),
            })
        elif event in ("postToolUse", "postToolUseFailure"):
            base.update(tool_call(
                data.get("tool_name"), data.get("tool_input"), data.get("tool_output"),
                error=data.get("error_message"),
                tool_use_id=data.get("tool_use_id"),
                duration_ms=data.get("duration"),
            ))
        elif event == "afterAgentResponse":
            base["response_summary"] = text(data.get("text"), SUMMARY_LIMIT)
        elif event == "stop":
            base["stop_reason"] = data.get("status", "")

    elif tool == "copilot":
        base["session_id"] = base["session_id"] or data.get("sessionId", "")
        if event == "userPromptSubmitted":
            base["prompt"] = data.get("prompt", "")[:1000]
        elif event in ("postToolUse", "postToolUseFailure"):
            args = data.get("toolArgs")
            if isinstance(args, str):
                try:
                    args = json.loads(args)
                except json.JSONDecodeError:
                    pass
            result = data.get("toolResult") or {}
            err = data.get("error")
            if not err and result.get("resultType") in ("failure", "denied", "rejected"):
                err = result.get("textResultForLlm") or result.get("resultType")
            base.update(tool_call(
                data.get("toolName"), args, result.get("textResultForLlm"),
                error=err.get("message") if isinstance(err, dict) else err,
            ))

    # Skip only true noise: no prompt AND no tool-specific payload. Every
    # registered lifecycle event (turn/session end) is kept even when empty
    # because the dashboard timeline uses it to close a turn.
    _PAYLOAD_KEYS = ("prompt", "tool_name", "tool_input", "response_summary",
                     "tool_response", "tool_error", "files_context")
    _LIFECYCLE_EVENTS = ("Stop", "SubagentStop", "SessionStart", "SessionEnd",
                         "stop", "sessionEnd", "agentStop")
    has_payload = any(base.get(k) for k in _PAYLOAD_KEYS)
    if not has_payload and event not in _LIFECYCLE_EVENTS:
        return None

    return base


def main():
    # Read stdin as UTF-8 explicitly. On Windows, sys.stdin defaults to the
    # system code page (e.g. cp1252), which corrupts non-Latin1 prompts
    # (Vietnamese, CJK, emoji) into mojibake. The hook payload is always UTF-8.
    raw = sys.stdin.buffer.read().decode("utf-8", errors="replace").strip()
    if not raw:
        sys.exit(0)

    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        sys.exit(0)

    tool = detect_tool(data)
    entry = normalize(data, tool)
    if not entry:
        sys.exit(0)

    log_dir = Path(os.environ.get("AI_LOG_DIR", ".ai-log"))
    log_dir.mkdir(exist_ok=True)
    log_file = log_dir / "session.jsonl"

    with open(log_file, "a", encoding="utf-8") as f:
        f.write(json.dumps(entry, ensure_ascii=False) + "\n")

    # Output valid JSON (required by some tools like Gemini)
    print(json.dumps({"status": "logged"}))


if __name__ == "__main__":
    main()
