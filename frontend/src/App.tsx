import { Routes, Route } from "react-router-dom";
import Layout from "./components/Layout.tsx";
import ProtectedRoute from "./components/ProtectedRoute.tsx";
import { AuthProvider } from "./context/AuthContext.tsx";
import ChallengeDetail from "./pages/ChallengeDetail.tsx";
import Challenges from "./pages/Challenges.tsx";
import CreateChallenge from "./pages/CreateChallenge.tsx";
import Home from "./pages/Home.tsx";
import Login from "./pages/Login.tsx";
import NotFound from "./pages/NotFound.tsx";
import Register from "./pages/Register.tsx";

function App() {
  return (
    <AuthProvider>
      <Routes>
        <Route element={<Layout />}>
          <Route path="/" element={<Home />} />
          <Route path="/login" element={<Login />} />
          <Route path="/register" element={<Register />} />
          <Route path="/challenges" element={<Challenges />} />
          <Route path="/challenges/:id" element={<ChallengeDetail />} />
          <Route element={<ProtectedRoute />}>
            <Route path="/challenges/new" element={<CreateChallenge />} />
          </Route>
          <Route path="*" element={<NotFound />} />
        </Route>
      </Routes>
    </AuthProvider>
  );
}

export default App;