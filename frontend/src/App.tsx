import { Routes, Route } from 'react-router-dom';
import Sidebar from '@components/Sidebar/Sidebar';
import ChatPage from '@pages/ChatPage';
import SettingsPage from '@pages/SettingsPage';
import MemoryPage from '@pages/MemoryPage';

export default function App() {
  return (
    <div className="flex h-screen bg-glass text-white">
      <Sidebar />
      <main className="flex-1 overflow-hidden">
        <Routes>
          <Route path="/" element={<ChatPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="/memory" element={<MemoryPage />} />
        </Routes>
      </main>
    </div>
  );
}
