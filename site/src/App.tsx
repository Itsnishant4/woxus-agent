import { Routes, Route } from 'react-router-dom';
import Landing from './pages/Landing';
import Buy from './pages/Buy';
import Help from './pages/Help';

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Landing />} />
      <Route path="/buy" element={<Buy />} />
      <Route path="/buy/:plan" element={<Buy />} />
      <Route path="/help" element={<Help />} />
      <Route path="*" element={<Landing />} />
    </Routes>
  );
}
