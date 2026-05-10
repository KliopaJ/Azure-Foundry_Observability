import { Zap } from 'lucide-react'

export default function LoginPage({ onLogin }: { onLogin: () => void }) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-950">
      <div className="text-center">
        <div className="w-14 h-14 rounded-2xl bg-blue-600 flex items-center justify-center mx-auto mb-6">
          <Zap size={28} className="text-white" />
        </div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white mb-2">
          Foundry Observability
        </h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mb-8">
          Sign in with your Azure account to continue.
          <br />
          <span className="text-xs">Your Azure RBAC permissions apply automatically.</span>
        </p>
        <button
          onClick={onLogin}
          className="px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-lg transition-colors text-sm"
        >
          Sign in with Microsoft
        </button>
      </div>
    </div>
  )
}
