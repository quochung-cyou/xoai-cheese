import type { Lesson } from './lessons';

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

const style = `<style>
html,body{margin:0;min-height:100%;background:#1e2420;color:#e7f0ea;font:14px/1.55 system-ui,sans-serif}
main{padding:17px}h1{font-size:18px;color:#a7f3d0;margin:0 0 12px}h2{font-size:13px;color:#93c5fd;margin:16px 0 6px}
p{margin:0 0 12px}li{margin:0 0 9px}ul{padding-left:20px}small{color:#afc4ba}
article{padding:12px;margin:12px 0;border:1px solid #50705b;border-radius:10px;background:#29352d}
button{cursor:pointer;border:1px solid #80ab92;border-radius:7px;padding:8px 10px;margin:4px 4px 4px 0;color:#e7f0ea;background:#344c3c;text-align:left}
button:hover{background:#46634e}button:disabled{cursor:default;opacity:.8}
button.correct{background:#186a41;border-color:#83dfa9}button.wrong{background:#7e3333;border-color:#f2aaa6}
.feedback{margin-top:10px;color:#b7ebca} [hidden]{display:none!important}
</style>`;

export function noteDocument(lesson: Lesson): string {
  return `<!doctype html><html lang="vi"><head><meta charset="utf-8">${style}</head><body><main>
    <h1>📝 Ghi chú giáo viên: ${escapeHtml(lesson.title)}</h1>
    <p>${escapeHtml(lesson.explanation)}</p><h2>Điểm cần nhớ</h2>
    <ul>${lesson.points.map((p) => `<li>${escapeHtml(p)}</li>`).join('')}</ul>
    <small>Kéo và phóng to mô hình 3D để đối chiếu các cấu trúc khi học.</small>
  </main></body></html>`;
}

export function quizDocument(lesson: Lesson): string {
  const cards = lesson.questions.map((q, i) => `<article data-correct="${q.correct}">
    <strong>Câu ${i + 1}. ${escapeHtml(q.prompt)}</strong>
    <div>${q.choices.map((c, j) => `<button type="button" data-choice="${j}">${escapeHtml(c)}</button>`).join('')}</div>
    <button type="button" class="reveal">Xem đáp án</button>
    <p class="feedback" hidden>Đáp án: ${escapeHtml(q.choices[q.correct] ?? '')}. ${escapeHtml(q.explanation)}</p>
  </article>`).join('');
  // Answers remain in the bundled document, but are not displayed until a
  // learner submits a choice or asks to reveal. The iframe owns its UI state.
  return `<!doctype html><html lang="vi"><head><meta charset="utf-8">${style}</head><body><main>
    <h1>❓ Kiểm tra hiểu bài: ${escapeHtml(lesson.title)}</h1>
    <small>Chọn câu trả lời trước khi xem đáp án. Có thể thử lại khi đặt lại mô hình.</small>
    ${cards}
  </main><script>
    document.querySelectorAll('article').forEach(function(card){
      var correct=Number(card.dataset.correct), feedback=card.querySelector('.feedback');
      var buttons=card.querySelectorAll('[data-choice]');
      function reveal(){
        feedback.hidden=false;
        buttons.forEach(function(b){
          b.disabled=true;
          if(Number(b.dataset.choice)===correct) b.classList.add('correct');
        });
      }
      buttons.forEach(function(b){b.addEventListener('click',function(){
        if(Number(b.dataset.choice)!==correct) b.classList.add('wrong');
        reveal();
      });});
      card.querySelector('.reveal').addEventListener('click',reveal);
    });
  </script></body></html>`;
}
