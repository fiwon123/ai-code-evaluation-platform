import { lazy, Suspense } from "react";
import { Routes, Route } from "react-router-dom";
import ErrorBoundary from "./components/ErrorBoundary/ErrorBoundary.tsx";
import Layout from "./components/Layout.tsx";
import ProtectedRoute from "./components/ProtectedRoute.tsx";
import Spinner from "./components/Spinner/Spinner.tsx";
import { ToastProvider } from "./components/Toast/ToastContext.tsx";
import { AuthProvider } from "./context/AuthContext.tsx";
import styles from "./App.module.css";

const About = lazy(() => import("./pages/About/About.tsx"));
const ChallengeDetail = lazy(() => import("./pages/ChallengeDetail.tsx"));
const Challenges = lazy(() => import("./pages/Challenges.tsx"));
const Contact = lazy(() => import("./pages/Contact/Contact.tsx"));
const CreateChallenge = lazy(() => import("./pages/CreateChallenge.tsx"));
const Demo = lazy(() => import("./pages/Demo/Demo.tsx"));
const EditChallenge = lazy(() => import("./pages/EditChallenge.tsx"));
const Features = lazy(() => import("./pages/Features/Features.tsx"));
const Home = lazy(() => import("./pages/Home/Home.tsx"));
const Login = lazy(() => import("./pages/Login.tsx"));
const NotFound = lazy(() => import("./pages/NotFound.tsx"));
const Pricing = lazy(() => import("./pages/Pricing/Pricing.tsx"));
const Profile = lazy(() => import("./pages/Profile/Profile.tsx"));
const Register = lazy(() => import("./pages/Register.tsx"));
const SubmissionDetail = lazy(() => import("./pages/SubmissionDetail.tsx"));

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
                <Route path="/login" element={<Login />} />
                <Route path="/register" element={<Register />} />
                <Route path="/challenges" element={<Challenges />} />
                <Route
                  path="/challenges/:id"
                  element={<ChallengeDetail />}
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