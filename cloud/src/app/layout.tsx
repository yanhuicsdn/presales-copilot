import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: '售前智问分身 · PreSales Copilot 云端控制台',
  description: '基于 Next.js + Mastra 的售前沟通分身 Agent 云端控制台与 macOS 客户端联调中心',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body className="bg-slate-950 text-slate-100 antialiased selection:bg-indigo-500/30">
        {children}
      </body>
    </html>
  );
}
