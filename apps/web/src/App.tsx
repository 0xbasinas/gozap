import type { JSX } from 'react'
import { Route, Routes } from 'react-router'
import { Layout } from './components/Layout'
import { AccountPage } from './pages/AccountPage'
import { AcceptInvitationPage } from './pages/AcceptInvitationPage'
import { AdminPage } from './pages/AdminPage'
import { TeamsPage } from './pages/TeamsPage'
import { AppPage } from './pages/AppPage'
import { CancelDeletionPage } from './pages/CancelDeletionPage'
import { ConfirmEmailPage } from './pages/ConfirmEmailPage'
import { DesktopCallbackPage } from './pages/DesktopCallbackPage'
import { DownloadPage } from './pages/DownloadPage'
import { FeedbackPage } from './pages/FeedbackPage'
import { HomePage } from './pages/HomePage'
import { NotFoundPage } from './pages/NotFoundPage'
import { PrivacyPage } from './pages/PrivacyPage'
import { ReleasesPage } from './pages/ReleasesPage'
import { StatusPage } from './pages/StatusPage'
import { SubprocessorsPage } from './pages/SubprocessorsPage'
import { SignInPage } from './pages/SignInPage'

export function App(): JSX.Element {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<HomePage />} />
        <Route path="download" element={<DownloadPage />} />
        <Route path="releases" element={<ReleasesPage />} />
        <Route path="status" element={<StatusPage />} />
        <Route path="feedback" element={<FeedbackPage />} />
        <Route path="sub-processors" element={<SubprocessorsPage />} />
        <Route path="sign-in" element={<SignInPage />} />
        <Route path="admin" element={<AdminPage />} />
        <Route path="teams" element={<TeamsPage />} />
        <Route path="accept-invitation/:id" element={<AcceptInvitationPage />} />
        <Route path="account" element={<AccountPage />} />
        <Route path="account/cancel-deletion" element={<CancelDeletionPage />} />
        <Route path="account/privacy" element={<PrivacyPage />} />
        <Route path="account/confirm-email" element={<ConfirmEmailPage />} />
        <Route path="auth/desktop" element={<DesktopCallbackPage />} />
        {/* The web version of the product. Everything under /app is handled client-side. */}
        <Route path="app/*" element={<AppPage />} />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  )
}
