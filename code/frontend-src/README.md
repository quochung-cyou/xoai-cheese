# frontend-src

Frontend của đội Xoài Cheese (AITC 2026) — React + Vite + TypeScript + Tailwind CSS v4 + shadcn/ui.

## Stack

| Thành phần | Phiên bản |
|---|---|
| Vite | 8.3.x |
| React / React DOM | 19.2.x |
| TypeScript | 6.0.x |
| Tailwind CSS | 4.x (`@tailwindcss/vite`) |
| shadcn/ui (CLI) | 4.21.x — style `base-nova` |
| Base UI | `@base-ui/react` |
| Font | Geist Variable (`@fontsource-variable/geist`) |
| Icon | lucide-react |
| Lint | oxlint |

Ghi chú về shadcn: preset `nova` (style `base-nova`) dùng **Base UI** thay cho Radix. Nếu muốn dùng Radix thì
tạo dự án mới với `npx shadcn@latest init --base radix`, hoặc chạy `npx shadcn@latest migrate radix`.

## Lệnh

```bash
npm install                     # cài phụ thuộc
npm run dev                     # dev server (mặc định http://localhost:5173)
npm run build                   # tsc -b && vite build
npm run preview                 # xem bản build
npm run lint                    # oxlint
npx shadcn@latest add dialog    # thêm component shadcn
```

## Cấu trúc

```
src/
├─ components/ui/   # component shadcn (button, card, ...)
├─ lib/utils.ts     # cn() — gộp class Tailwind
├─ App.tsx
├─ index.css        # Tailwind v4 + theme token shadcn (sáng/tối)
└─ main.tsx
components.json     # cấu hình shadcn CLI (alias @/…)
vite.config.ts      # plugin react + tailwind, alias @ -> ./src
```

## Alias & theme

- `@/*` trỏ vào `src/*`, khai báo ở `tsconfig.json`, `tsconfig.app.json` và `vite.config.ts`.
  Không dùng `baseUrl` vì TypeScript 6.0 đã deprecate (tsconfig dùng `paths` tương đối).
- Theme nằm trong `src/index.css`: biến CSS ở `:root` và `.dark`, map sang utility Tailwind bằng `@theme inline`.
  Bật dark mode bằng cách thêm class `dark` lên `<html>`.

## Lưu ý khi chạy trong DSH sandbox

- `npm` bị chặn dưới dạng `.ps1` do Execution Policy → dùng `npm.cmd`.
- Cache của npm/pnpm nằm ngoài workspace nên bị sandbox từ chối ghi; đặt cache trong repo:
  `$env:npm_config_cache = "<repo>\.npm-cache"`.
- CLI shadcn (`init`, `add`) tự gọi `npm install`; lệnh con này bị sandbox chặn (`spawn EPERM`).
  Cách xử lý: cài phụ thuộc bằng tay rồi chạy `npx shadcn@latest add <component>` (bước ghi file vẫn chạy tốt).
- `vite build` cần quyền rộng hơn sandbox (Vite spawn tiến trình con và nạp native binding của Tailwind).
  Trên máy bình thường lệnh chạy không cần lưu ý này.

## Ghi chú template gốc (create-vite)

This template provides a minimal setup to get React working in Vite with HMR and some Oxlint rules.

Two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Oxc](https://oxc.rs)
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/)

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

If you are developing a production application, we recommend enabling type-aware lint rules by installing `oxlint-tsgolint` and editing `.oxlintrc.json`. See the [Oxlint rules documentation](https://oxc.rs/docs/guide/usage/linter/rules) for the full list of rules and categories.
