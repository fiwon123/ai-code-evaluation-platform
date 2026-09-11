import { Routes, Route } from "react-router-dom";
import Layout from "./components/Layout.tsx";
import ProtectedRoute from "./components/ProtectedRoute.tsx";
import { AuthProvider } from "./context/AuthContext.tsx";
import About from "./pages/About/About.tsx";
import ChallengeDetail from "./pages/ChallengeDetail.tsx";
import Challenges from "./pages/Challenges.tsx";
import Contact from "./pages/Contact/Contact.tsx";
import CreateChallenge from "./pages/CreateChallenge.tsx";
import Demo from "./pages/Demo/Demo.tsx";
import Features from "./pages/Features/Features.tsx";
import Home from "./pages/Home/Home.tsx";
import Login from "./pages/Login.tsx";
import NotFound from "./pages/NotFound.tsx";
import Pricing from "./pages/Pricing/Pricing.tsx";
import Profile from "./pages/Profile/Profile.tsx";
import Register from "./pages/Register.tsx";
import SubmissionDetail from "./pages/SubmissionDetail.tsx";

function App() {
  return (
    <AuthProvider>
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
          <Route path="/challenges/:id" element={<ChallengeDetail />} />
          <Route element={<ProtectedRoute />}>
            <Route path="/challenges/new" element={<CreateChallenge />} />
            <Route path="/submissions/:id" element={<SubmissionDetail />} />
            <Route path="/profile" element={<Profile />} />
          </Route>
          <Route path="*" element={<NotFound />} />
        </Route>
      </Routes>
    </AuthProvider>
  );
}

export default App;