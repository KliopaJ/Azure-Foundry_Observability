import { Outlet } from 'react-router-dom'
import TopBar from './TopBar'
import ContextBar from './ContextBar'
import { Github, Linkedin } from 'lucide-react'

export default function Layout() {
  return (
    <div className="min-h-screen flex flex-col bg-gray-50 dark:bg-gray-950">
      <TopBar />
      <ContextBar />
      <main className="flex-1 p-3 sm:p-4 md:p-6 xl:p-8 w-full">
        <Outlet />
      </main>
      <footer className="border-t border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 px-4 sm:px-6 py-3">
        <div className="flex flex-col sm:flex-row items-center justify-between gap-2 text-xs text-gray-400">
          <span>© {new Date().getFullYear()} Ben Dali. All rights reserved.</span>
          <div className="flex items-center gap-4">
            <a
              href="https://www.linkedin.com/in/bendali/"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1.5 hover:text-blue-600 dark:hover:text-blue-400 transition-colors"
            >
              <Linkedin size={13} />
              LinkedIn
            </a>
            <a
              href="https://github.com/benarch/Azure-AI_models_observability"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1.5 hover:text-gray-900 dark:hover:text-white transition-colors"
            >
              <Github size={13} />
              GitHub
            </a>
          </div>
        </div>
      </footer>
    </div>
  )
}
