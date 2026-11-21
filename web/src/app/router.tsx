import { createHashRouter } from 'react-router-dom';
import { AppShell } from './AppShell';
import { HomePage } from '../pages/HomePage';
import { LevelPage } from '../pages/LevelPage';
import { PlaygroundPage } from '../pages/PlaygroundPage';
import { WikiPage } from '../pages/WikiPage';

/**
 * 使用 HashRouter 同时完美兼容 GitHub/Gitee Pages 静态子路径部署与 regzero-bridge 本地托管，
 * 无需额外服务端 SPA fallback 规则。
 */
export const router = createHashRouter([
  {
    path: '/',
    element: <AppShell />,
    children: [
      { index: true, element: <HomePage /> },
      { path: 'level/:id', element: <LevelPage /> },
      { path: 'playground', element: <PlaygroundPage /> },
      { path: 'wiki/:topic', element: <WikiPage /> },
      { path: 'wiki', element: <WikiPage /> },
    ],
  },
]);
