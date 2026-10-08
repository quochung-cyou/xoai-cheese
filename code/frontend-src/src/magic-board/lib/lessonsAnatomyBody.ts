import type { Lesson } from './lessons';

export const anatomyBody: Record<string, Lesson> = {
  '': {
    title: 'Cơ thể người', explanation: 'Các hệ cơ quan phối hợp để duy trì sự sống: hệ xương nâng đỡ, hệ cơ tạo vận động, hệ tuần hoàn vận chuyển chất và hệ hô hấp trao đổi khí.',
    points: ['Quan sát vị trí tương đối của các cơ quan trong lồng ngực và ổ bụng.', 'Dùng bộ lọc để xem từng hệ cơ quan rồi kết hợp chúng trở lại.'],
    questions: [
      { prompt: 'Hệ nào vận chuyển oxy đến các mô?', choices: ['Tuần hoàn', 'Xương', 'Tiêu hóa'], correct: 0, explanation: 'Máu lưu thông trong hệ tuần hoàn mang oxy đến các mô.' },
      { prompt: 'Hệ nào nâng đỡ cơ thể?', choices: ['Hệ xương', 'Hệ hô hấp', 'Hệ tiết niệu'], correct: 0, explanation: 'Bộ xương tạo khung nâng đỡ cơ thể.' },
    ],
  },
  skeleton: {
    title: 'Bộ xương', explanation: 'Bộ xương tạo khung nâng đỡ, bảo vệ nội tạng và kết hợp với cơ để vận động.',
    points: ['Hộp sọ bảo vệ não; lồng ngực bảo vệ tim và phổi.', 'Xương đùi là xương dài nhất; các khớp nối xương cho phép cử động.'],
    questions: [
      { prompt: 'Hộp sọ bảo vệ cơ quan nào?', choices: ['Não', 'Tim', 'Phổi'], correct: 0, explanation: 'Hộp sọ bao quanh và bảo vệ não.' },
      { prompt: 'Xương nào dài nhất cơ thể?', choices: ['Xương đùi', 'Xương sườn', 'Xương ngón tay'], correct: 0, explanation: 'Xương đùi là xương dài nhất.' },
    ],
  },
  skull: {
    title: 'Hộp sọ', explanation: 'Hộp sọ gồm các xương sọ bảo vệ não và các xương mặt tạo khung cho mắt, mũi và hàm.',
    points: ['Nhiều xương sọ nối với nhau bằng khớp gần như bất động.', 'Xương hàm dưới cử động được để nhai và nói.'],
    questions: [
      { prompt: 'Vai trò quan trọng nhất của hộp sọ là gì?', choices: ['Bảo vệ não', 'Lọc máu', 'Trao đổi khí'], correct: 0, explanation: 'Hộp sọ che chở mô não rất nhạy cảm.' },
      { prompt: 'Xương nào của sọ cử động khi nhai?', choices: ['Xương hàm dưới', 'Xương trán', 'Xương đỉnh'], correct: 0, explanation: 'Hàm dưới cử động nhờ khớp thái dương hàm.' },
    ],
  },
  muscles: {
    title: 'Hệ cơ', explanation: 'Các cơ co và giãn tạo chuyển động, duy trì tư thế và sinh nhiệt.',
    points: ['Cơ vân gắn với xương giúp vận động có ý thức.', 'Cơ tim co bóp liên tục; cơ trơn hoạt động ở nhiều cơ quan nội tạng.'],
    questions: [
      { prompt: 'Loại cơ nào gắn với xương để cử động?', choices: ['Cơ vân', 'Cơ tim', 'Cơ trơn'], correct: 0, explanation: 'Cơ vân còn được gọi là cơ xương.' },
      { prompt: 'Cơ nào bơm máu?', choices: ['Cơ tim', 'Cơ vân', 'Cơ bắp tay'], correct: 0, explanation: 'Tim có mô cơ chuyên biệt để co bóp.' },
    ],
  },
  spine: {
    title: 'Cột sống', explanation: 'Cột sống là trục nâng đỡ thân người và tạo ống xương bảo vệ tủy sống.',
    points: ['Các đốt sống xếp thành đoạn cổ, ngực, thắt lưng, cùng và cụt.', 'Đĩa đệm nằm giữa nhiều đốt sống, giúp giảm chấn động.'],
    questions: [
      { prompt: 'Cột sống bảo vệ bộ phận nào?', choices: ['Tủy sống', 'Gan', 'Phổi'], correct: 0, explanation: 'Tủy sống nằm trong ống sống.' },
      { prompt: 'Đĩa đệm có vai trò gì?', choices: ['Giảm chấn động', 'Tạo máu', 'Trao đổi khí'], correct: 0, explanation: 'Đĩa đệm có tính đàn hồi giữa các đốt sống.' },
    ],
  },
  hand: {
    title: 'Bàn tay', explanation: 'Bàn tay gồm nhiều xương nhỏ và khớp, giúp cầm nắm và thực hiện các thao tác tinh tế.',
    points: ['Ngón cái có thể đối diện với các ngón khác để cầm vật.', 'Gân truyền lực từ cơ tới xương ngón tay.'],
    questions: [
      { prompt: 'Đặc điểm nào giúp bàn tay cầm nắm chính xác?', choices: ['Ngón cái đối diện các ngón khác', 'Có ít khớp', 'Không có gân'], correct: 0, explanation: 'Khả năng đối ngón của ngón cái tăng độ linh hoạt.' },
      { prompt: 'Gân nối bộ phận nào với xương?', choices: ['Cơ', 'Da', 'Mạch máu'], correct: 0, explanation: 'Gân truyền lực co của cơ sang xương.' },
    ],
  },
  foot: {
    title: 'Bàn chân', explanation: 'Bàn chân nâng đỡ trọng lượng cơ thể và giúp giữ thăng bằng khi đứng, đi hoặc chạy.',
    points: ['Các xương bàn chân tạo thành vòm giúp phân tán lực.', 'Các ngón chân góp phần giữ thăng bằng và đẩy cơ thể về phía trước.'],
    questions: [
      { prompt: 'Vòm bàn chân giúp gì khi đi lại?', choices: ['Phân tán lực', 'Bơm máu', 'Tiêu hóa'], correct: 0, explanation: 'Vòm chân hoạt động như kết cấu đàn hồi giảm chấn.' },
      { prompt: 'Bàn chân góp phần giữ gì khi đứng?', choices: ['Thăng bằng', 'Thân nhiệt', 'Huyết áp'], correct: 0, explanation: 'Bàn chân tạo mặt đỡ cho cơ thể.' },
    ],
  },
};
