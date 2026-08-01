import { Link } from 'react-router-dom';

export default function Landing() {
  return (
    <div className="min-h-screen bg-zinc-950 text-white">
      <div className="max-w-5xl mx-auto px-6 py-16 lg:py-24">
        {/* Logo */}
        <div className="flex items-center justify-center gap-3 mb-16">
          <div className="h-12 w-12 bg-gradient-to-br from-violet-500 to-indigo-600 rounded-xl flex items-center justify-center">
            <span className="text-xl font-bold text-white">W</span>
          </div>
          <span className="text-2xl font-semibold">Woxus</span>
        </div>

        {/* Hero */}
        <div className="text-center space-y-6 mb-16">
          <h1 className="text-4xl lg:text-5xl font-bold tracking-tight">
            Your AI Desktop Assistant
          </h1>
          <p className="text-lg text-zinc-400 max-w-2xl mx-auto">
            Voice conversation, persistent memory, desktop automation, and a prompt
            writer — all running on your machine.
          </p>
          <div className="flex items-center justify-center gap-4 pt-4">
            <Link
              to="/buy"
              className="px-6 py-3 rounded-lg bg-gradient-to-r from-violet-600 to-indigo-600 text-white font-medium hover:from-violet-500 hover:to-indigo-500 transition-all"
            >
              Buy License
            </Link>
            <a
              href="/help/index.html"
              className="px-6 py-3 rounded-lg border border-zinc-700 text-zinc-200 font-medium hover:bg-zinc-800 transition-all"
            >
              Help &amp; Docs
            </a>
          </div>
        </div>

        {/* Feature cards */}
        <div className="grid md:grid-cols-3 gap-6">
          <div className="bg-zinc-900/60 border border-zinc-800 rounded-2xl p-6">
            <div className="text-3xl mb-3">🎤</div>
            <h3 className="font-semibold mb-1">Real-Time Voice</h3>
            <p className="text-sm text-zinc-400">Low-latency conversations with barge-in. Just talk.</p>
          </div>
          <div className="bg-zinc-900/60 border border-zinc-800 rounded-2xl p-6">
            <div className="text-3xl mb-3">🧠</div>
            <h3 className="font-semibold mb-1">Persistent Memory</h3>
            <p className="text-sm text-zinc-400">Woxus remembers facts about you across sessions.</p>
          </div>
          <div className="bg-zinc-900/60 border border-zinc-800 rounded-2xl p-6">
            <div className="text-3xl mb-3">✍️</div>
            <h3 className="font-semibold mb-1">Prompt Writer</h3>
            <p className="text-sm text-zinc-400">Dictate an intent and Woxus pastes a prompt at your cursor.</p>
          </div>
        </div>

        {/* CTA */}
        <div className="text-center mt-16 space-y-4">
          <Link
            to="/buy"
            className="inline-block px-8 py-3 rounded-lg bg-gradient-to-r from-violet-600 to-indigo-600 text-white font-medium hover:from-violet-500 hover:to-indigo-500 transition-all"
          >
            Get Started
          </Link>
          <p className="text-xs text-zinc-500">Free trial available · One-time license · macOS, Windows, Linux</p>
        </div>
      </div>
    </div>
  );
}
