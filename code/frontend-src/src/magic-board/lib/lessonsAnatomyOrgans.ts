import type { Lesson } from './lessons';

export const anatomyOrgans: Record<string, Lesson> = {
  heart: {
    title: 'Giải phẫu tim', explanation: 'Tim là cơ quan trung tâm của hệ tuần hoàn, co bóp để đưa máu đến phổi và khắp cơ thể.',
    points: ['Tim có hai tâm nhĩ ở trên và hai tâm thất ở dưới. Van tim giữ máu chảy một chiều.', 'Tâm thất phải đưa máu đến phổi; tâm thất trái đưa máu giàu oxy đi toàn thân.'],
    questions: [
      { prompt: 'Tim có bao nhiêu buồng?', choices: ['Hai', 'Bốn', 'Sáu'], correct: 1, explanation: 'Tim có hai tâm nhĩ và hai tâm thất.' },
      { prompt: 'Buồng nào bơm máu đi toàn thân?', choices: ['Tâm nhĩ phải', 'Tâm thất phải', 'Tâm thất trái'], correct: 2, explanation: 'Tâm thất trái đẩy máu giàu oxy vào động mạch chủ.' },
    ],
  },
  brain: {
    title: 'Giải phẫu não', explanation: 'Não là trung tâm xử lý thông tin và điều khiển các hoạt động của cơ thể.',
    points: ['Đại não tham gia suy nghĩ, cảm giác và vận động có ý thức.', 'Tiểu não phối hợp vận động; thân não duy trì nhịp thở và nhịp tim.'],
    questions: [
      { prompt: 'Bộ phận nào phối hợp vận động và giữ thăng bằng?', choices: ['Tiểu não', 'Tâm thất', 'Phế nang'], correct: 0, explanation: 'Tiểu não giúp phối hợp các cử động.' },
      { prompt: 'Bộ phận nào tham gia duy trì nhịp thở?', choices: ['Võng mạc', 'Thân não', 'Xương sọ'], correct: 1, explanation: 'Thân não điều khiển nhiều chức năng sống tự động.' },
    ],
  },
  lungs: {
    title: 'Giải phẫu phổi', explanation: 'Phổi là nơi cơ thể lấy oxy từ không khí và thải khí carbon dioxide.',
    points: ['Không khí đi qua khí quản, phế quản rồi tới các phế nang.', 'Phế nang có thành mỏng, tiếp xúc mao mạch để trao đổi khí với máu.'],
    questions: [
      { prompt: 'Trao đổi khí diễn ra chủ yếu ở đâu?', choices: ['Phế nang', 'Khí quản', 'Cơ hoành'], correct: 0, explanation: 'Oxy và carbon dioxide khuếch tán qua thành phế nang.' },
      { prompt: 'Khí nào được đưa từ phổi vào máu?', choices: ['Carbon dioxide', 'Oxy', 'Nitơ'], correct: 1, explanation: 'Máu nhận oxy ở phế nang.' },
    ],
  },
  kidney: {
    title: 'Giải phẫu thận', explanation: 'Thận lọc máu, tạo nước tiểu và góp phần điều hòa nước cùng muối khoáng.',
    points: ['Đơn vị lọc của thận là nephron.', 'Chất cần thiết được tái hấp thu; chất thải theo nước tiểu đi tới bàng quang.'],
    questions: [
      { prompt: 'Chức năng chính của thận là gì?', choices: ['Trao đổi khí', 'Lọc máu', 'Bơm máu'], correct: 1, explanation: 'Thận lọc máu và loại bỏ chất thải.' },
      { prompt: 'Đơn vị lọc của thận là gì?', choices: ['Phế nang', 'Nephron', 'Nơ-ron'], correct: 1, explanation: 'Mỗi thận chứa rất nhiều nephron.' },
    ],
  },
  liver: {
    title: 'Giải phẫu gan', explanation: 'Gan là cơ quan lớn trong ổ bụng, tham gia chuyển hóa và xử lý nhiều chất trong máu.',
    points: ['Gan tạo mật hỗ trợ tiêu hóa chất béo.', 'Gan dự trữ glycogen và xử lý một số chất có hại.'],
    questions: [
      { prompt: 'Gan tạo ra dịch nào?', choices: ['Mật', 'Nước bọt', 'Dịch vị'], correct: 0, explanation: 'Mật giúp nhũ hóa chất béo.' },
      { prompt: 'Gan dự trữ glucose dưới dạng nào?', choices: ['Glycogen', 'Oxy', 'Canxi'], correct: 0, explanation: 'Glycogen là dạng dự trữ glucose.' },
    ],
  },
  eye: {
    title: 'Giải phẫu mắt', explanation: 'Mắt tiếp nhận ánh sáng và biến thông tin thị giác thành tín hiệu gửi đến não.',
    points: ['Giác mạc và thủy tinh thể hội tụ ánh sáng lên võng mạc.', 'Tế bào nón nhận biết màu; tế bào que nhạy với ánh sáng yếu.'],
    questions: [
      { prompt: 'Ánh sáng cần hội tụ lên bộ phận nào để nhìn rõ?', choices: ['Võng mạc', 'Mống mắt', 'Mí mắt'], correct: 0, explanation: 'Võng mạc chứa tế bào cảm quang.' },
      { prompt: 'Tế bào nào giúp phân biệt màu?', choices: ['Tế bào que', 'Tế bào nón', 'Hồng cầu'], correct: 1, explanation: 'Tế bào nón giúp nhận biết màu sắc.' },
    ],
  },
};
