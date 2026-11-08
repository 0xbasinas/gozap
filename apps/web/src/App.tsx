import type { JSX } from 'react'
import { Route, Routes } from 'react-router'
import { Layout } from './components/Layout'
import { AccountPage } from './pages/AccountPage'
import { AppPage } from './pages/AppPage'
import { DesktopCallbackPage } from './pages/DesktopCallbackPage'
import { DownloadPage } from './pages/DownloadPage'
import { HomePage } from './pages/HomePage'
import { NotFoundPage } from './pages/NotFoundPage'
import { SignInPage } from './pages/SignInPage'

export function App(): JSX.Element {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<HomePage />} />
        <Route path="download" element={<DownloadPage />} />
        <Route path="sign-in" element={<SignInPage />} />
        <Route path="account" element={<AccountPage />} />
        <Route path="auth/desktop" element={<DesktopCallbackPage />} />
        {/* The web version of the product. Everything under /app is handled client-side. */}
        <Route path="app/*" element={<AppPage />} />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  )
}
