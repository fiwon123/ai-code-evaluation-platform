import { lazy, Suspense } from "react";
import { Routes, Route } from "react-router-dom";
import AdminRoute from "./components/AdminRoute.tsx";
import ErrorBoundary from "./components/ErrorBoundary/ErrorBoundary.tsx";
import Layout from "./components/Layout.tsx";
import ProtectedRoute from "./components/ProtectedRoute.tsx";
import Spinner from "./components/Spinner/Spinner.tsx";
import { ToastProvider } from "./components/Toast/ToastContext.tsx";
import { AuthProvider } from "./context/AuthContext.tsx";
import styles from "./App.module.css";

const About = lazy(() => import("./pages/About/About.tsx"));
const AdminChallenges = lazy(() => import("./pages/Admin/AdminChallenges.tsx"));
const AdminDashboard = lazy(() => import("./pages/Admin/AdminDashboard.tsx"));
const AdminSubmissions = lazy(() => import("./pages/Admin/AdminSubmissions.tsx"));
const AdminUsers = lazy(() => import("./pages/Admin/AdminUsers.tsx"));
const ChallengeDetail = lazy(() => import("./pages/ChallengeDetail.tsx"));
const Challenges = lazy(() => import("./pages/Challenges.tsx"));
const Contact = lazy(() => import("./pages/Contact/Contact.tsx"));
const CreateChallenge = lazy(() => import("./pages/CreateChallenge.tsx"));
const Demo = lazy(() => import("./pages/Demo/Demo.tsx"));
const EditChallenge = lazy(() => import("./pages/EditChallenge.tsx"));
const Features = lazy(() => import("./pages/Features/Features.tsx"));
const Gdpr = lazy(() => import("./pages/Gdpr/Gdpr.tsx"));
const Home = lazy(() => import("./pages/Home/Home.tsx"));
const Login = lazy(() => import("./pages/Login.tsx"));
const NotFound = lazy(() => import("./pages/NotFound.tsx"));
const OAuthCallback = lazy(() => import("./pages/OAuthCallback.tsx"));
const Pricing = lazy(() => import("./pages/Pricing/Pricing.tsx"));
const Privacy = lazy(() => import("./pages/Privacy/Privacy.tsx"));
const Profile = lazy(() => import("./pages/Profile/Profile.tsx"));
const Register = lazy(() => import("./pages/Register.tsx"));
const Security = lazy(() => import("./pages/Security/Security.tsx"));
const SharedResultPage = lazy(() => import("./pages/SharedResultPage.tsx"));
const SubmissionDetail = lazy(() => import("./pages/SubmissionDetail.tsx"));
const Terms = lazy(() => import("./pages/Terms/Terms.tsx"));

function PageFallback() {
  return (
    <div className={styles.fallback} role="status" aria-label="Loading page">
      <Spinner label="Loading page" />
    </div>
  );
}

function App() {
  return (
    <AuthProvider>
      <ToastProvider>
        <ErrorBoundary>
          <Suspense fallback={<PageFallback />}>
            <Routes>
              <Route element={<Layout />}>
                <Route path="/" element={<Home />} />
                <Route path="/features" element={<Features />} />
                <Route path="/pricing" element={<Pricing />} />
                <Route path="/demo" element={<Demo />} />
                <Route path="/about" element={<About />} />
                <Route path="/contact" element={<Contact />} />
                {/* Legal pages — public, no account required, linked from the
                    footer. Each renders the shared LegalShell. */}
                <Route path="/privacy" element={<Privacy />} />
                <Route path="/terms" element={<Terms />} />
                <Route path="/security" element={<Security />} />
                <Route path="/gdpr" element={<Gdpr />} />
                <Route path="/login" element={<Login />} />
                <Route path="/register" element={<Register />} />
                <Route path="/auth/callback" element={<OAuthCallback />} />
                <Route path="/challenges" element={<Challenges />} />
                <Route
                  path="/challenges/:id"
                  element={<ChallengeDetail />}
                />
                {/* Public share-link destination — no account required. */}
                <Route
                  path="/results/:token"
                  element={<SharedResultPage />}
                />
                <Route element={<ProtectedRoute />}>
                  <Route
                    path="/challenges/new"
                    element={<CreateChallenge />}
                  />
                  <Route
                    path="/challenges/:id/edit"
                    element={<EditChallenge />}
                  />
<Route
                  path="/submissions/:id"
                  element={<SubmissionDetail />}
                />
                  <Route path="/profile" element={<Profile />} />
                </Route>
                <Route element={<AdminRoute />}>
                  <Route path="/admin" element={<AdminDashboard />} />
                  <Route path="/admin/users" element={<AdminUsers />} />
                  <Route
                    path="/admin/challenges"
                    element={<AdminChallenges />}
                  />
                  <Route
                    path="/admin/submissions"
                    element={<AdminSubmissions />}
                  />
                </Route>
                <Route path="*" element={<NotFound />} />
              </Route>
            </Routes>
          </Suspense>
        </ErrorBoundary>
      </ToastProvider>
    </AuthProvider>
  );
}

export default App;