import { useEffect } from 'react';

// The full help documentation is a standalone static page (docs/help/index.html),
// copied into public/help/. Render it full-window so all its navigation works.
export default function Help() {
  useEffect(() => {
    window.location.href = '/help/index.html';
  }, []);

  return (
    <div className="min-h-screen bg-white flex items-center justify-center">
      <p className="text-gray-500">Loading documentation…</p>
    </div>
  );
}
