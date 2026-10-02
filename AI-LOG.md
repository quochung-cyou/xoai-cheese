# AI Hook Template - Ghi log AI cho AI Thực Chiến

Repo mẫu này giúp đội của bạn **tự động ghi lại quá trình làm việc với công cụ AI** (prompt, các lần AI gọi tool, kết quả và lỗi) cho Claude Code, Cursor, Codex, Gemini CLI, GitHub Copilot, Antigravity, và **gửi lên hệ thống theo dõi** của Ban Tổ Chức (BTC) mỗi khi bạn `git push`.

Bạn không cần viết thêm gì: chỉ cần làm đúng 3 bước dưới đây.

## Yêu cầu

- `git`, và **Python 3.10 trở lên** (kiểm tra: `python --version`, hoặc `py -3 --version` trên Windows).
- Trên Windows: cài **Git for Windows** (có sẵn Git Bash) vì các hook chạy bằng bash.
- Repo của đội phải có remote `origin` (tạo repo từ template trên GitHub là đủ).

## 3 bước cài đặt

### Bước 1 - Dùng template này

Trên GitHub, bấm **Use this template** -> **Create a new repository**.
Chọn owner `ai-thuc-chien` và đặt tên repo đúng như BTC hướng dẫn, rồi clone repo mới về máy:

```bash
git clone https://github.com/ai-thuc-chien/<ten-repo-cua-doi>.git
cd <ten-repo-cua-doi>
```

### Bước 2 - Cài hook (chạy một lần sau khi clone)

Linux / macOS / Git Bash:

```bash
bash scripts/setup_hooks.sh
```

Windows PowerShell:

```powershell
powershell -ExecutionPolicy Bypass -File scripts\setup_hooks.ps1
```

Kết quả mong đợi: dòng `[ai-log] Git pre-push hook installed.`

Cài thêm thư viện đọc file `.env` (nếu bỏ qua, file `.env` sẽ không được đọc):

```bash
python -m pip install python-dotenv
```

### Bước 3 - Điền token BTC cấp

```bash
cp .env.example .env        # Windows PowerShell: Copy-Item .env.example .env
```

Mở file `.env` và dán token của đội vào dòng `AI_LOG_API_KEY=` (token bắt đầu bằng `aitc_`, do BTC gửi riêng cho đội):

```
AI_LOG_SERVER=https://live.thucchien.ai/api/ingest
AI_LOG_API_KEY=aitc_...token-cua-doi...
```

**Không commit file `.env`** (đã được `.gitignore` chặn). Không gửi token cho người ngoài đội.

Xong. Từ giờ, mỗi lần bạn gõ prompt hoặc AI chạy một tool, hook ghi vào `.ai-log/session.jsonl`; mỗi lần `git push`, log được gửi lên BTC.

## Những gì được ghi lại

Mỗi sự kiện tạo một dòng trong `.ai-log/session.jsonl`. Các loại sự kiện:

- **prompt** bạn gửi cho AI (cắt tối đa 1000 ký tự);
- **mỗi lần AI gọi tool** (chạy lệnh, đọc/sửa file, tìm kiếm, gọi MCP...): tên tool, **input của tool** (vd lệnh shell, đường dẫn và nội dung file được sửa), **output của tool** (vd kết quả lệnh) và **lỗi** nếu tool thất bại. Output cắt tối đa 4000 ký tự, mỗi trường input tối đa 4000 ký tự;
- **câu trả lời cuối lượt** của AI (tối đa 4000 ký tự) và các sự kiện bắt đầu/kết thúc phiên.

Mỗi dòng còn có: thời gian, tên công cụ AI (`claude`, `cursor`, `codex`, `gemini`, `copilot`, `antigravity`), tên model (nếu công cụ cung cấp), mã phiên, tên repo (lấy từ `origin`), nhánh, mã commit rút gọn, và `student` là giá trị `git config user.email` trên máy bạn.

Sau khi gửi thành công, file log được chuyển sang `.ai-log/archive/YYYY-MM-DD.jsonl` (chỉ nằm trên máy bạn, không bị commit).

Dùng công cụ AI **không có hook** (ChatGPT web, Gemini web, Claude.ai...)? Ghi tay bằng:

```bash
bash scripts/_pyrun.sh scripts/log_manual.py --tool chatgpt --prompt "Mô tả việc đã hỏi"
```

## Kiểm tra hệ thống hoạt động

1. Gõ một prompt bất kỳ trong công cụ AI của bạn, rồi xem `.ai-log/session.jsonl` có thêm dòng mới.
2. Gửi thử log ngay, không cần push:

```bash
python scripts/submit_log.py
```

Kết quả và ý nghĩa:

| Thông báo | Ý nghĩa |
|---|---|
| `[ai-log] Submitted N entries → 202` | Thành công. N dòng đã lên bảng xếp hạng. |
| `[ai-log] No logs to submit.` | Chưa có dòng log nào để gửi. |
| `[ai-log] AI_LOG_SERVER not set — skipping submission.` | Chưa đọc được `.env` (xem phần xử lý sự cố). |
| `[ai-log] Submit failed: ... — logs kept locally.` | Gửi lỗi; log vẫn được giữ và sẽ thử lại ở lần push sau. |

Gửi lại cùng một dòng log là an toàn: hệ thống tự loại bản trùng.

## Lưu ý về quyền riêng tư

Log được gửi nguyên văn lên hệ thống của BTC và **BTC xem được đầy đủ**: prompt, lệnh AI đã chạy, nội dung file AI đọc/sửa, output lệnh và câu trả lời của AI. Không có bước lọc hay che thông tin nhạy cảm. Hãy:

- không đưa mật khẩu, API key, thông tin cá nhân hay dữ liệu nhạy cảm vào prompt;
- không để AI đọc, in ra hay sửa file chứa bí mật (`.env`, file key...), và không chạy lệnh in bí mật ra màn hình khi đang dùng AI;
- lưu ý trường `student` là email cấu hình trong git; nếu không muốn lộ email cá nhân, đặt một địa chỉ khác cho repo này: `git config user.email "ten-doi@example.com"`;
- không sửa hay xoá file trong `.ai-log/` bằng tay.

## Xử lý sự cố

- **`AI_LOG_SERVER not set`**: chưa cài `python-dotenv` (`python -m pip install python-dotenv`), hoặc file `.env` không nằm ở thư mục gốc repo, hoặc chưa tạo `.env` từ `.env.example`.
- **`Submit failed: HTTP Error 401`**: token sai hoặc thiếu. Kiểm tra `AI_LOG_API_KEY` trong `.env` (không có dấu cách/ngoặc thừa). Nếu vẫn lỗi, nhờ BTC cấp lại token.
- **Không thấy dòng log mới sau khi gõ prompt hoặc khi AI chạy tool**:
  - repo chưa có remote `origin` (`git remote -v` phải có dòng `origin`); hook bỏ qua mọi sự kiện nếu không có `origin`;
  - Python thấp hơn 3.10 (`python --version`);
  - Claude Code, Cursor, Gemini CLI, Antigravity có thể hỏi có tin tưởng hook của workspace không: hãy đồng ý;
  - dùng công cụ không có hook: ghi tay bằng `log_manual.py` như trên.
- **Push không gửi log**: hook `pre-push` chưa được cài; chạy lại Bước 2. Hook không bao giờ chặn `git push` ngay cả khi gửi lỗi.
- **Lỗi `bash\r: command not found` trên Windows**: file `.sh` bị đổi sang CRLF; chạy `git config core.autocrlf input` rồi clone lại repo (repo đã có `.gitattributes` ép LF).
- **Gửi lại log cũ**: log đã gửi nằm ở `.ai-log/archive/`; hệ thống loại trùng nên có thể chép lại vào `.ai-log/session.jsonl` và chạy lại `python scripts/submit_log.py`.

Cần hỗ trợ thêm: liên hệ BTC.
