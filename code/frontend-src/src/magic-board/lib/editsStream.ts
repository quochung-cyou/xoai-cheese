/**
 * Bộ quét tăng dần cho giao kèo luồng tinh chỉnh — bản chuyển từ
 * `app/edits_stream.py` của backend ai4edu.
 *
 * Mô hình phát ra văn bản thuần: phần kể xen kẽ với các khối dấu mốc
 * (<<<<<<< SEARCH / ======= / >>>>>>> REPLACE, hoặc <<<<<<< REWRITE /
 * >>>>>>> END). Bộ quét này biến luồng token thành các sự kiện vòng đời theo
 * từng khối ngay khi mỗi dòng dấu mốc đến.
 *
 * Đây là một máy trạng thái theo dòng, KHÔNG phải bộ đếm dấu ngoặc: một khối cần
 * tìm chỉ được coi là hoàn tất khi dòng dấu mốc của nó đến.
 */

const SEARCH = '<<<<<<< SEARCH';
const REPLACE = '>>>>>>> REPLACE';
const SPLIT = '=======';
const REWRITE = '<<<<<<< REWRITE';
const END = '>>>>>>> END';

export type ScanEvent =
  | { type: 'narration'; delta: string }
  | { type: 'edit-start'; index: number }
  | { type: 'edit-search'; index: number; search: string }
  | { type: 'edit-end'; index: number; search: string; replace: string }
  | { type: 'rewrite-start' }
  | { type: 'rewrite-progress'; lines: number }
  | { type: 'rewrite-end'; code: string };

type State = 'text' | 'search' | 'replace' | 'rewrite';

const isMarker = (line: string): boolean => {
  const s = line.trim();
  return (
    s === SEARCH || s === REPLACE || s === SPLIT || s === REWRITE || s === END ||
    s.startsWith('```')
  );
};

export class EditStreamScanner {
  private state: State = 'text';
  private buf = '';
  private blockLines: string[] = [];
  private searchText = '';
  private index = 0;
  private rewriteLines = 0;

  /** Tiêu thụ một delta kết quả; trả về các sự kiện quét đã hoàn tất tới giờ. */
  feed(text: string): ScanEvent[] {
    this.buf += text;
    const events: ScanEvent[] = [];

    // Chỉ xử lý những dòng chắc chắn đã hoàn tất. Phần đuôi còn đang mở được giữ
    // lại cho tới khi ký tự xuống dòng của nó đến: phát nó sớm sẽ hoặc làm rò rỉ
    // tiền tố dấu mốc (`<`, ```) vào phần kể, hoặc nếu dòng đã xong đó hóa ra là
    // dấu mốc thì sẽ lặp lại phần văn xuôi mà bên gọi đã nhận được. Kết quả của
    // mô hình bị ngắt dòng rất nhiều, nên phần kể vẫn chảy với nhịp tự nhiên.
    const parts = this.buf.split('\n');
    const tail = parts.pop() ?? '';
    for (const line of parts) events.push(...this.line(line));
    this.buf = tail;
    return events;
  }

  /** Kết thúc luồng: phát mọi văn bản còn sót lại như phần kể. Các khối chưa
   *  hoàn tất KHÔNG được phát ra — bên gọi coi một lượt không có khối nào đóng
   *  là phản hồi sai định dạng. */
  flush(): ScanEvent[] {
    const events: ScanEvent[] = [];
    if (this.state === 'text' && this.buf.trim()) {
      events.push({ type: 'narration', delta: this.buf });
    }
    this.buf = '';
    return events;
  }

  private line(line: string): ScanEvent[] {
    const s = line.trim();

    if (this.state === 'text') {
      if (s === SEARCH) {
        this.state = 'search';
        this.blockLines = [];
        this.index += 1;
        return [{ type: 'edit-start', index: this.index }];
      }
      if (s === REWRITE) {
        this.state = 'rewrite';
        this.blockLines = [];
        this.rewriteLines = 0;
        return [{ type: 'rewrite-start' }];
      }
      if (isMarker(line)) return []; // dấu mốc lạc / hàng rào mã — bỏ đi
      return [{ type: 'narration', delta: line + '\n' }];
    }

    if (this.state === 'search') {
      if (s === SPLIT) {
        this.state = 'replace';
        this.searchText = this.blockLines.join('\n');
        this.blockLines = [];
        return [{ type: 'edit-search', index: this.index, search: this.searchText }];
      }
      this.blockLines.push(line);
      return [];
    }

    if (this.state === 'replace') {
      if (s === REPLACE) {
        this.state = 'text';
        const replace = this.blockLines.join('\n');
        this.blockLines = [];
        return [
          {
            type: 'edit-end',
            index: this.index,
            search: this.searchText,
            replace,
          },
        ];
      }
      this.blockLines.push(line);
      return [];
    }

    // viết lại toàn bộ
    if (s === END) {
      this.state = 'text';
      const code = this.blockLines.join('\n');
      this.blockLines = [];
      return [{ type: 'rewrite-end', code }];
    }
    this.blockLines.push(line);
    this.rewriteLines += 1;
    return [{ type: 'rewrite-progress', lines: this.rewriteLines }];
  }
}
