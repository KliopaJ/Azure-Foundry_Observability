import { useMsal } from '@azure/msal-react'
import { Moon, Sun, LogOut, Menu, X, DollarSign, ShoppingBag } from 'lucide-react'
import { Link, useLocation } from 'react-router-dom'
import { useState } from 'react'
import { useApp } from '../context/AppContext'

export default function TopBar() {
  const { instance, accounts } = useMsal()
  const { theme, toggleTheme } = useApp()
  const loc = useLocation()
  const [mobileNavOpen, setMobileNavOpen] = useState(false)
  const user = accounts[0]
  const initials =
    user?.name
      ?.split(' ')
      .map(p => p[0])
      .join('')
      .slice(0, 2)
      .toUpperCase() ?? '??'

  const navLinks = [
    { to: '/dashboard', label: 'Dashboard' },
    { to: '/settings', label: 'Settings' },
    { to: '/forecast', label: 'Forecast' },
    { to: '/quotas', label: 'Quotas' },
    { to: '/about', label: 'About' },
  ]

  return (
    <>
      <header className="sticky top-0 z-50 h-14 border-b border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 grid grid-cols-[auto_1fr_auto] items-center px-3 sm:px-6 gap-3">
        {/* Left: brand */}
        <div className="flex items-center gap-2 flex-shrink-0">
          <img src="/icon-microsoft-foundry.png" alt="Foundry" className="w-7 h-7" />
          <span className="font-semibold text-gray-900 dark:text-white text-sm whitespace-nowrap hidden md:block">
            Foundry Observability
          </span>
        </div>

        {/* Center: desktop nav */}
        <nav className="hidden sm:flex items-center justify-center gap-1">
          {navLinks.map(({ to, label }) => (
            <Link
              key={to}
              to={to}
              className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                loc.pathname.startsWith(to)
                  ? 'bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400'
                  : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-gray-800'
              }`}
            >
              {label}
            </Link>
          ))}
        </nav>

        {/* Right: theme + pricing + marketplace + user + hamburger */}
        <div className="flex items-center gap-1 sm:gap-2 justify-end">
          <a
            href="https://ai.azure.com/catalog/models"
            target="_blank"
            rel="noopener noreferrer"
            title="Azure AI Foundry model catalog"
            className="p-2 rounded-lg text-gray-500 hover:text-violet-600 dark:text-gray-400 dark:hover:text-violet-400 hover:bg-violet-50 dark:hover:bg-violet-900/20 transition-colors"
          >
            <ShoppingBag size={16} />
          </a>
          <a
            href="https://azure.microsoft.com/en-us/pricing/details/ai-foundry-models/microsoft/"
            target="_blank"
            rel="noopener noreferrer"
            title="Azure OpenAI / Foundry model pricing"
            className="p-2 rounded-lg text-gray-500 hover:text-emerald-600 dark:text-gray-400 dark:hover:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-900/20 transition-colors"
          >
            <DollarSign size={16} />
          </a>
          <button
            onClick={toggleTheme}
            className="p-2 rounded-lg text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
            title="Toggle theme"
          >
            {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
          </button>

          <div className="flex items-center gap-2 pl-2 sm:pl-3 border-l border-gray-200 dark:border-gray-700">
            <span className="text-sm font-medium text-gray-900 dark:text-white hidden lg:block">
              {user?.name ?? 'User'}
            </span>
            <div
              className="w-8 h-8 rounded-full bg-blue-600 text-white text-xs font-bold flex items-center justify-center flex-shrink-0 cursor-default"
              title={user?.username ?? ''}
            >
              {initials}
            </div>
            <button
              onClick={() => instance.logoutPopup()}
              title="Sign out"
              className="p-1.5 rounded-lg text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors hidden sm:block"
            >
              <LogOut size={15} />
            </button>
          </div>

          {/* Mobile hamburger */}
          <button
            onClick={() => setMobileNavOpen(o => !o)}
            className="sm:hidden p-2 rounded-lg text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
            aria-label="Toggle navigation"
          >
            {mobileNavOpen ? <X size={18} /> : <Menu size={18} />}
          </button>
        </div>
      </header>

      {/* Mobile nav drawer */}
      {mobileNavOpen && (
        <div className="sm:hidden sticky top-14 z-40 bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-800 px-3 py-2 flex flex-col gap-1">
          {navLinks.map(({ to, label }) => (
            <Link
              key={to}
              to={to}
              onClick={() => setMobileNavOpen(false)}
              className={`px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                loc.pathname.startsWith(to)
                  ? 'bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400'
                  : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-gray-800'
              }`}
            >
              {label}
            </Link>
          ))}
          <button
            onClick={() => { instance.logoutPopup(); setMobileNavOpen(false) }}
            className="flex items-center gap-2 px-3 py-2 rounded-md text-sm font-medium text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
          >
            <LogOut size={14} /> Sign out
          </button>
        </div>
      )}
    </>
  )
}
