import { useCallback, useEffect, useRef, useState, type UIEvent } from 'react';
import { ArrowDown } from 'lucide-react';

import { refineArtifactToCallback } from '../lib/refine';
import type { LLMConfig } from '../lib/settings';
import type { Artifact, ChatMessage, RefineEvent, RefineRun } from '../lib/types';
import { ChatComposer } from './chat/composer';
import { EmptyState, MessageRow } from './chat/messages';
import { applyEvent, newRun } from './chat/reducer';
import { AgentRun } from './chat/trace';

const FLUSH_MS = 50; // giới hạn tần suất: không render lại theo từng token

interface ChatPanelProps {
  getConfig: () => LLMConfig;
  modelLabel: string;
  /** Mở hộp thoại cài đặt mô hình. */
  onOpenSettings: () => void;
  artifacts: Artifact[];
  activeArtifactId: string | null;
  /** Chỉ được bộ chọn dự phòng dùng cho các artifact đã tách rời — việc chọn
   *  mục tiêu thông thường do vùng chọn trên bảng vẽ quyết định. */
  onSelectArtifact: (id: string) => void;
  messages: ChatMessage[];
  onMessagesChange: (messages: ChatMessage[]) => void;
  /** payload done cho artifact — App cập nhật state + bảng vẽ. */
  onArtifactPayload: (artifactId: string, payload: Artifact['payload']) => void;
  /** id các artifact mà phần tử trên bảng vẽ đã bị xóa thủ công. */
  detachedIds: ReadonlySet<string>;
  activeArtifact: Artifact | null;
}

/**
 * Trò chuyện Tinh chỉnh. Chọn một mô phỏng/sơ đồ đã tạo trên bảng vẽ, mô tả
 * thay đổi mong muốn, rồi xem chỉnh sửa hiện ra trực tiếp (suy luận, tường
 * thuật, khác biệt theo từng chỉnh sửa).
 */
export default function ChatPanel({
  getConfig,
  modelLabel,
  onOpenSettings,
  artifacts,
  activeArtifactId,
  onSelectArtifact,
  messages,
  onMessagesChange,
  onArtifactPayload,
  detachedIds,
  activeArtifact,
}: ChatPanelProps) {
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  // Trạng thái lượt chạy trực tiếp trong một ref — các delta token được đẩy
  // sang React mỗi FLUSH_MS thay vì mỗi token một lần.
  const runRef = useRef<RefineRun | null>(null);
  const [, setTick] = useState(0);
  const flushTimer = useRef<number | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  /** Chỉ bám theo nội dung mới khi người dùng còn neo ở cuối. */
  const stickRef = useRef(true);
  const [atBottom, setAtBottom] = useState(true);

  const scheduleFlush = () => {
    if (flushTimer.current !== null) return;
    flushTimer.current = window.setTimeout(() => {
      flushTimer.current = null;
      setTick((t) => t + 1);
    }, FLUSH_MS);
  };

  // Tự động cuộn sau mỗi lần đẩy — nhưng chỉ khi còn neo ở cuối.
  useEffect(() => {
    const el = scrollRef.current;
    if (el && stickRef.current) el.scrollTo({ top: el.scrollHeight });
  });

  const handleScroll = useCallback((e: UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    const at = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
    stickRef.current = at;
    setAtBottom(at);
  }, []);

  const handleJump = useCallback(() => {
    stickRef.current = true;
    setAtBottom(true);
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: 'smooth',
    });
  }, []);

  // Hủy một lượt chạy đang xử lý nếu bảng điều khiển bị gỡ khỏi giao diện.
  useEffect(
    () => () => {
      abortRef.current?.abort();
      if (flushTimer.current !== null) window.clearTimeout(flushTimer.current);
    },
    [],
  );

  const send = async () => {
    const text = input.trim();
    if (!text || busy) return;
    const artifact = artifacts.find((a) => a.id === activeArtifactId);
    const now = new Date().toISOString();

    if (!artifact) {
      const why = activeArtifactId
        ? `Phần tử đang chọn trỏ tới artifact #${activeArtifactId.slice(
            0,
            6,
          )}, nhưng artifact này không có trong bảng hiện tại — có thể nó đã bị xóa hoặc bị sao chép. Hãy Phân tích lại bản phác thảo.`
        : 'Chưa chọn artifact nào — hãy bấm vào một mô phỏng hoặc sơ đồ đã tạo trên bảng vẽ, hoặc Phân tích bản phác thảo của bạn trước.';
      onMessagesChange([
        ...messages,
        { role: 'user', content: text, at: now, artifact_id: activeArtifactId },
        { role: 'assistant', content: why, at: now },
      ]);
      setInput('');
      return;
    }

    const cfg = getConfig();
    if (!cfg.api_key.trim() || !cfg.model.trim()) {
      onMessagesChange([
        ...messages,
        { role: 'user', content: text, at: now, artifact_id: artifact.id },
        {
          role: 'assistant',
          content:
            'Chưa cấu hình mô hình (model). Hãy mở Cài đặt (nút bên dưới) và điền điểm cuối (endpoint), mô hình (model) cùng khóa API (API key).',
          at: now,
        },
      ]);
      setInput('');
      onOpenSettings();
      return;
    }

    const withUser: ChatMessage[] = [
      ...messages,
      { role: 'user', content: text, at: now, artifact_id: artifact.id },
    ];
    onMessagesChange(withUser);
    setInput('');
    setBusy(true);
    runRef.current = newRun();
    setTick((t) => t + 1);

    const abort = new AbortController();
    abortRef.current = abort;

    const onEvent = (ev: RefineEvent) => {
      if (runRef.current) {
        applyEvent(runRef.current, ev);
        scheduleFlush();
      }
    };

    const outcome = await refineArtifactToCallback(
      cfg,
      artifact,
      text,
      onEvent,
      abort.signal,
    );
    abortRef.current = null;

    // Lưu lại phần suy luận của lượt chạy để các tin nhắn đã hoàn tất vẫn giữ
    // khối 'Đã suy luận trong Ns' sau khi dấu vết trực tiếp biến mất.
    const runMeta = runRef.current;
    const traceMeta =
      runMeta && runMeta.thinking
        ? { thinking: runMeta.thinking, thinking_ms: runMeta.thinkingMs }
        : {};

    if (outcome.payload !== undefined) {
      onArtifactPayload(artifact.id, outcome.payload);
      onMessagesChange([
        ...withUser,
        {
          role: 'assistant',
          content: outcome.message ?? '',
          artifact_id: artifact.id,
          at: new Date().toISOString(),
          ...traceMeta,
        },
      ]);
    } else if (outcome.message !== undefined) {
      // Xong nhưng không có payload — yêu cầu không thể diễn đạt trên
      // artifact này; câu trả lời nằm lại trong khung trò chuyện và bảng vẽ
      // giữ nguyên.
      onMessagesChange([
        ...withUser,
        {
          role: 'assistant',
          content: outcome.message,
          artifact_id: artifact.id,
          at: new Date().toISOString(),
          ...traceMeta,
        },
      ]);
    } else {
      const detail = outcome.aborted
        ? 'Đã dừng tinh chỉnh.'
        : `Tinh chỉnh thất bại: ${outcome.error ?? 'luồng kết thúc mà không có kết quả'}`;
      onMessagesChange([
        ...withUser,
        {
          role: 'assistant',
          content: detail,
          artifact_id: artifact.id,
          at: new Date().toISOString(),
          ...traceMeta,
        },
      ]);
    }
    runRef.current = null;
    setBusy(false);
    setTick((t) => t + 1);
  };

  const stop = () => abortRef.current?.abort();
  const run = runRef.current;

  const pickSuggestion = (s: string) => {
    setInput(s);
    inputRef.current?.focus();
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="relative min-h-0 flex-1">
        <div
          ref={scrollRef}
          onScroll={handleScroll}
          className="mb-scroll h-full overflow-y-auto"
        >
          <div className="flex min-h-full flex-col space-y-6 px-4 py-5">
            {messages.length === 0 && !busy ? (
              <EmptyState onPick={pickSuggestion} />
            ) : (
              messages.map((m, i) => (
                <MessageRow
                  key={i}
                  m={m}
                  artifact={
                    m.artifact_id
                      ? artifacts.find((a) => a.id === m.artifact_id)
                      : undefined
                  }
                  onSelectArtifact={onSelectArtifact}
                />
              ))
            )}
            {run && <AgentRun run={run} />}
          </div>
        </div>
        {!atBottom && (
          <button
            onClick={handleJump}
            className="absolute bottom-3 left-1/2 z-10 flex h-8 w-8 -translate-x-1/2 items-center justify-center rounded-full border border-border bg-card text-muted-foreground shadow-md transition-colors hover:text-foreground"
            title="Tới tin nhắn mới nhất"
          >
            <ArrowDown size={14} />
          </button>
        )}
      </div>
      <ChatComposer
        input={input}
        inputRef={inputRef}
        modelLabel={modelLabel}
        onOpenSettings={onOpenSettings}
        onInput={setInput}
        onSend={() => void send()}
        onStop={stop}
        busy={busy}
        activeArtifact={activeArtifact}
        detached={activeArtifact != null && detachedIds.has(activeArtifact.id)}
      />
    </div>
  );
}
