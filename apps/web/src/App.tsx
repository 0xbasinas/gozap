import { lazy, type JSX } from 'react'
import { Route, Routes } from 'react-router'
import { AppLayout } from './components/AppLayout'
import { Layout } from './components/Layout'
import { HomePage } from './pages/HomePage'
import { NotFoundPage } from './pages/NotFoundPage'
import { SignInPage } from './pages/SignInPage'
import { TeamSignInPage } from './pages/TeamSignInPage'

const AccountPage = lazy(() =>
  import('./pages/AccountPage').then((m) => ({ default: m.AccountPage }))
)
const AcceptInvitationPage = lazy(() =>
  import('./pages/AcceptInvitationPage').then((m) => ({ default: m.AcceptInvitationPage }))
)
const AdminPage = lazy(() => import('./pages/AdminPage').then((m) => ({ default: m.AdminPage })))
const TeamPage = lazy(() => import('./pages/TeamPage').then((m) => ({ default: m.TeamPage })))
const TeamsPage = lazy(() => import('./pages/TeamsPage').then((m) => ({ default: m.TeamsPage })))
const AppPage = lazy(() => import('./pages/AppPage').then((m) => ({ default: m.AppPage })))
const CancelDeletionPage = lazy(() =>
  import('./pages/CancelDeletionPage').then((m) => ({ default: m.CancelDeletionPage }))
)
const ConfirmEmailPage = lazy(() =>
  import('./pages/ConfirmEmailPage').then((m) => ({ default: m.ConfirmEmailPage }))
)
const DesktopCallbackPage = lazy(() =>
  import('./pages/DesktopCallbackPage').then((m) => ({ default: m.DesktopCallbackPage }))
)
const DownloadPage = lazy(() =>
  import('./pages/DownloadPage').then((m) => ({ default: m.DownloadPage }))
)
const FeedbackPage = lazy(() =>
  import('./pages/FeedbackPage').then((m) => ({ default: m.FeedbackPage }))
)
const PrivacyPage = lazy(() =>
  import('./pages/PrivacyPage').then((m) => ({ default: m.PrivacyPage }))
)
const ReleasesPage = lazy(() =>
  import('./pages/ReleasesPage').then((m) => ({ default: m.ReleasesPage }))
)
const StatusPage = lazy(() => import('./pages/StatusPage').then((m) => ({ default: m.StatusPage })))
const SubprocessorsPage = lazy(() =>
  import('./pages/SubprocessorsPage').then((m) => ({ default: m.SubprocessorsPage }))
)
const ConsentPage = lazy(() =>
  import('./pages/ConsentPage').then((m) => ({ default: m.ConsentPage }))
)
const DevicePage = lazy(() => import('./pages/DevicePage').then((m) => ({ default: m.DevicePage })))

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
        <Route path="t/:slug/sign-in" element={<TeamSignInPage />} />
        <Route path="consent" element={<ConsentPage />} />
        <Route path="device" element={<DevicePage />} />
        <Route path="accept-invitation/:id" element={<AcceptInvitationPage />} />
        <Route path="auth/desktop" element={<DesktopCallbackPage />} />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
      {/* The web version of the product. Everything under /app is handled client-side. */}
      <Route element={<AppLayout />}>
        <Route path="app/*" element={<AppPage />} />
        <Route path="teams" element={<TeamsPage />} />
        <Route path="teams/:slug" element={<TeamPage />} />
        <Route path="admin" element={<AdminPage />} />
        <Route path="account" element={<AccountPage />} />
        <Route path="account/cancel-deletion" element={<CancelDeletionPage />} />
        <Route path="account/privacy" element={<PrivacyPage />} />
        <Route path="account/confirm-email" element={<ConfirmEmailPage />} />
      </Route>
    </Routes>
  )
}
